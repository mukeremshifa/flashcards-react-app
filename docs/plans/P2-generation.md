# P2 — Generation

Make the flagship flow real: paste text, watch cards stream in, keep the good ones. P1
built the thing that keeps cards worth having; this phase builds the thing that produces
them, and the review gate is what stops the two from fighting.

**Reference:** SPEC.md §4.1, §5.5, §7 (all of it), §8.2, §10.

**Done when:** pasting a passage produces 20 cards, the first visible in under five
seconds, and accepting them puts them in the `new` queue where P1's practice loop picks
them up unchanged.

## Preconditions

```bash
npm test && npm run typecheck && npm run lint && npm run build   # all green before starting
```

- P1 complete (it is). 156 tests, 11 files.
- **The P1 migration must be pushed before task 4.** `supabase db push` applies
  `20260812093000_review_card.sql`, then `npm run db:types` replaces the hand-written
  additions in `src/types/database.ts` and the note at the top of that file can go. Tasks
  1–3 do not need it.
- Supabase CLI linked (P0b did this: project `cnlnsaamiujselyuowzx`, eu-west-1, PG 17.6).
- A Groq account on the free tier. The key is set with
  `supabase secrets set GROQ_API_KEY=…` and must never appear in `.env.local`,
  `.env.example`, or any committed file — `src/lib/env-schema.ts` will not stop you here,
  because Edge Function secrets never pass through it.

## Out of scope — do not build these here

- The progress dashboard. P3 owns the heatmap, streaks, retention, and the due forecast.
  `/progress` keeps its placeholder.
- Documents, file upload, PDF, chunking. Post-v1, explicitly (SPEC §11).
- FSRS parameter optimisation. Still post-v1, still needs ~1,000 reviews.
- Deployment. P4.
- Touching the scheduler. If generation needs a change in `src/lib/fsrs.ts` or
  `review_card`, something has gone wrong — generated cards enter the queue as ordinary
  `new` cards and nothing downstream should know where they came from.
- Redefining a card shape. `CardPayload` in `src/lib/schemas.ts` is the only definition,
  and the Edge Function imports it rather than restating it.

## What already exists, and should be used rather than rebuilt

Worth reading before starting; most of P2's UI is assembly.

| Thing                                                            | Where                               | Note                                                           |
| ---------------------------------------------------------------- | ----------------------------------- | -------------------------------------------------------------- |
| `CardPayload`, `GenerateRequest`, `GeneratedCard`, `StreamEvent` | `src/lib/schemas.ts`                | Already written in P0 for exactly this phase                   |
| `splitClozeGroups`, `countClozeGroups`                           | `src/lib/schemas.ts`                | The multi-group split the model will trigger constantly        |
| `CardEditor`, and its `onSubmit(payloads[])` contract            | `src/features/cards/CardEditor.tsx` | Already returns an array; the review gate needs the same shape |
| `CardFront` / `CardBack` / `BrokenCard`                          | `src/features/cards/CardFace.tsx`   | Renders any payload as text; `BrokenCard` is the invalid case  |
| `useCreateCards`, `useDecks`, query keys                         | `src/lib/queries.ts`                | Deck/card writes and cache invalidation                        |
| `EmptyState`, `ConfirmDialog`, `Select`, `Badge`                 | `src/components/`                   | Do not write a second confirm dialog                           |
| `newCardScheduling(now)`                                         | `src/lib/fsrs.ts`                   | The scheduling columns a fresh card needs                      |

## Tasks

Ordered so `npm run dev` works after every one.

### 1. Shared Edge Function code — `supabase/functions/_shared/`

Deno, so it cannot import from `src/` by path. Two options, and the choice matters:

- `schemas.ts` re-exports the client's definitions via a relative import
  (`../../../src/lib/schemas.ts`). Deno can read it; zod is imported by npm specifier.
- Or the shared file is duplicated, and it drifts. Do not do this.

Take the first. Verify with `deno check` before writing anything else, because discovering
it does not work after the streaming code is written is an expensive way to find out.

Also here:

- `sse.ts` — frame an event stream. One `data: {json}\n\n` per card, plus a comment
  heartbeat every 15s so intermediaries do not close an idle connection.
- `quota.ts` — count this month's `generations` rows for the caller and decide. Quota is
  derived from the table (SPEC §5.5), never from a counter column.
- `prompts/cards.ts` — the system prompt, versioned. Store the version string on the
  `generations` row (`prompt_version` already exists) so a prompt change is auditable
  against the cards it produced.

### 2. Pick the model — and write down what you picked

**This is a research task, not a guess.** SPEC §12 leaves it deliberately open because
Groq's free-tier roster and its rate limits move. Do this against Groq's live console and
docs on the day:

1. List the models available on the free tier.
2. Pick the strongest instruction-follower that supports JSON-mode output.
3. Read the actual requests/min and tokens/min limits for it.
4. Set `GENERATION_MODEL` as a function secret. **No model name in the source.**
5. Record in this file: the model, its limits, and the date checked.

Steps 3 and 5 exist because `MAX_INPUT_CHARS` and the rate limiter in task 6 are tuned
against those numbers, and an untraceable tuning constant is worse than a wrong one.

### 3. The Edge Function — `supabase/functions/generate-cards/index.ts`

The pipeline is drawn in SPEC §7.1. In order: authenticate the JWT → validate with
`GenerateRequest` → quota and rate-limit check → char-budget check → insert
`decks(status='generating')` and `generations(status='running')` → call Groq with
`stream: true` → per card, validate with `CardPayload`, insert as `status='draft'`, emit an
SSE frame → finalise the `generations` row.

Points that are easy to get wrong:

- **Call Supabase with the caller's JWT**, never the service key (SPEC §5.7, §10). RLS then
  applies to the generated inserts, and `user_id` comes from the token rather than the
  request body.
- **Parse NDJSON incrementally.** The model emits one card per line; buffer partial lines
  across chunks. Waiting for the whole response before parsing throws away the entire point
  of streaming and the under-5s first card.
- **A card that fails `CardPayload` is dropped, not fatal.** Emit a `warn` frame and keep
  going. One malformed line must not cost the user the other nineteen cards.
- **Split multi-group clozes at ingest** with `splitClozeGroups`, before validation. The
  model will produce them; the schema rejects them by design. This is the same seam
  `src/features/cards/card-draft.ts` implements on the client — reuse the function, not the
  logic.
- **Every exit updates the `generations` row**, including the ones that throw. A row stuck
  on `running` is indistinguishable from a crash, and SPEC §10 asks for a reason on every
  failure.
- `AbortSignal.timeout(60_000)` on the provider call, and honour the client disconnecting.

### 4. Streaming client — `src/features/generate/`

- `useGenerateCards` — a hook over `fetch` with the session JWT, reading the SSE body and
  validating each frame with `StreamEvent`. **Not** TanStack Query: this is a long-lived
  stream, not a cacheable read. Session-local state, same rule as `PracticeSession`
  (SPEC §8.3).
- `CreateFromTextPage` (`/create/text`) — the paste form. Character count, an approximate
  token figure, remaining quota, card count 3–50, kind checkboxes, deck title. Validate
  with `GenerateRequest` before sending; the function enforces the real limits regardless.
- `StagingList` — cards appear as they arrive, with skeleton rows for the ones still coming.
  Reuse `CardFront`/`CardBack`.
- Cancel must actually abort the request and leave the drafts in place.

### 5. Review gate — `/create/review/:deckId`

The highest-leverage feature in the product (SPEC §4.1) and the cheapest to build, so build
it properly:

- Accept, edit, or reject each card; bulk accept-all; keyboard `A`/`R`/`E` bound to the
  container, the same pattern as `PracticeSession`.
- Edit opens `CardEditor` with the draft loaded. It already handles a kind switch and the
  cloze split.
- Accept flips `status` `draft` → `active` and sets the deck to `active`. The cards are
  already rows, so this is an update, not an insert.
- Reject deletes the row.
- Record `cards_accepted` on the `generations` row when the gate is finished. SPEC §13 (2)
  measures success as "fewer than 20% rejected", and that number has to come from
  somewhere.
- Resumable: `/decks` shows a deck left in `draft` with a way back into its gate. A refresh
  mid-generation must not burn a generation (SPEC §4.1).

### 6. Quota and rate limiting — SPEC §7.5

Both counted from `generations`. Per-user monthly generation cap and a short-window request
limiter, tuned to the free-tier numbers recorded in task 2. Refusals come back as a
`StreamEvent` of type `error` with code `quota_exceeded` or `rate_limited` — the client
already has those codes in its schema and must show them as a plain sentence, not a toast
that vanishes.

### 7. Wire it in

Replace the P2 placeholders in `src/app/routes.tsx` (`create/text`, `create/review/:deckId`).
The Create nav item already exists in `AppLayout`. Add quota usage to `/settings`, beside
the existing practice settings.

### 8. Write the P3 plan

`docs/plans/P3-progress.md`, authored against the code that then exists, and update the
board in `docs/plans/README.md`. Note for whoever writes it: `src/lib/day.ts` already has
the 04:00 study-day helpers — `studyDayKey`, `startOfStudyDay`, `addStudyDays`,
`studyDaysBetween` — and P3's heatmap and streaks must use them rather than growing a
second answer to "what day is it". `reviews.undone_at` exists so retention can exclude
undone ratings.

## Acceptance criteria

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
- Paste ~2,000 characters → 20 cards stream in → first card visible in under 5 seconds.
- A card the model malforms is skipped with a warning; the rest still arrive.
- A note with two deletion groups arrives as two cards.
- Refreshing mid-stream leaves a resumable draft deck and does not consume a second
  generation.
- Accepting cards puts them in the practice queue as `new`, and P1's loop schedules them
  with no change to `src/lib/fsrs.ts` or `review_card`.
- Rejecting a card removes it; `cards_accepted` reflects reality afterwards.
- Exceeding the quota refuses with a readable message and writes a `generations` row with
  `status = 'refused'`.
- The Groq key appears nowhere in `git grep -i groq` except as the name of a secret.
- A second user cannot see the first user's drafts (extend `src/test/rls.test.ts`).

## Tests to write

| Test                                                         | Failure it catches                                           |
| ------------------------------------------------------------ | ------------------------------------------------------------ |
| `ndjson.test.ts` — lines split across chunk boundaries       | The classic streaming parser bug; silently drops cards       |
| `ndjson.test.ts` — a malformed line mid-stream               | One bad card killing the whole generation                    |
| `schemas.test.ts` — real Groq output, and adversarial output | A payload the model produces that the schema rejects         |
| `generate.test.ts` — multi-group cloze from the model        | Ingest throwing where the client would have split            |
| `quota.test.ts` — the boundary, at and over the cap          | An off-by-one that either blocks a paying use or lets it run |
| `quota.test.ts` — refused generations still write their row  | Quota that cannot be audited after the fact                  |
| `rls.test.ts` — user B cannot read user A's drafts           | A breach, not a bug                                          |
| `StagingList.test.tsx` — accept, reject, edit                | A review gate that loses the edit it just made               |

## Decisions to record

Write these back into this file as the phase closes:

- The Groq model chosen, its free-tier rate limits, and the date they were read.
- The final `MAX_INPUT_CHARS` and monthly quota, and the arithmetic behind them.
- The prompt version string, and how the prompt is versioned going forward.
- Whether the shared-schema import from `src/lib/schemas.ts` into Deno worked, and what was
  done instead if it did not.
- Any new migration filename, appended to the list in the root `README.md`.
