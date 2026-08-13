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

- P1 complete (it is). 157 tests, 11 files.
- The database matches the repository: P1's migration is pushed and
  `src/types/database.ts` is generated from it. If P2 adds a migration, apply it the same
  way — `npm run db:push` then `npm run db:types`, per CLAUDE.md — rather than leaving the
  types to be written by hand.
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

---

## What happened (2026-08-12)

### The model, and the numbers it was chosen by

**`llama-3.3-70b-versatile`**, set as the `GENERATION_MODEL` function secret. Free-tier
limits read from `console.groq.com/docs/rate-limits` on **2026-08-12**:

| Model                     | RPM | RPD | TPM | TPD  |
| ------------------------- | --- | --- | --- | ---- |
| `llama-3.3-70b-versatile` | 30  | 1K  | 12K | 100K |
| `openai/gpt-oss-120b`     | 30  | 1K  | 8K  | 200K |
| `qwen/qwen3.6-27b`        | 30  | 1K  | 8K  | 200K |

Limits are per **API key**, not per user. The obvious pick looked like `gpt-oss-120b`: it
is the only free-tier family with strict `json_schema` structured output. Two numbers
decided against it.

1. **8,000 TPM cannot hold one maximum request.** SPEC §7.5 allows 20,000 characters of
   input ≈ 5,000 tokens; plus the system prompt and a 4,096-token answer that is ~10,000
   tokens — over the ceiling before a second user exists. 12,000 TPM holds it with room.
2. **`gpt-oss` is a reasoning model.** Its reasoning tokens are emitted before any card
   text and count against the same budget, which is precisely the wrong shape for "first
   card visible in under five seconds" (SPEC §10). A non-reasoning model starts writing
   the first card immediately.

The `json_schema` support turned out not to be a loss: JSON modes constrain output to a
**single object**, which is the opposite of the one-card-per-line contract in §7.3.
`response_format` is left unset and per-line Zod is the guarantee, as §7.2 allowed.

Recorded in SPEC §7.2 and §12 with the same date, because the roster moves and the
arithmetic below depends on these figures.

### The tuning constants, and the arithmetic

In `src/lib/quota.ts`, written next to the numbers themselves:

- **`maxInputChars` = 28,000.** 28,000 ÷ 4 chars/token ≈ 7,000 input tokens, plus 4,096
  output tokens ≈ 11,100 — about 92% of the 12,000 TPM ceiling, so one worst-case
  generation a minute. It applies to the **assembled prompt**, system message included,
  which is what makes it a different ceiling from `GENERATION_LIMITS.maxChars` (20,000
  characters of pasted text). The system prompt is ~3,000 characters, so a request that
  passes the first check cannot then die at the second — a test asserts the two do not
  invert.
- **Monthly quota = 30 per user**, as SPEC §7.5. Free tier, so this is a fair-share limit
  on a shared key rather than a bill.
- **Burst = 3 per 60s, 1 concurrent.** A `running` row older than 5 minutes stops
  counting: the provider call is capped at 60s, so anything older is a crashed worker, and
  without the window one lost worker would lock a user out permanently.
- **4 chars/token is for display only.** Groq has no token-counting endpoint; the UI says
  "an estimate, not a measurement" in as many words.

**Which rows spend an allowance** needed deciding, and is the least obvious call here. The
rule: _a row counts when it produced cards, or while it is still running._ A refusal spent
nothing — and if refusals counted, the first one would make every later request refuse too,
permanently. A provider 429 that returned nothing spent nothing either. A disconnect that
left 12 drafts behind **does** count, or disconnecting would be a way to get free cards.
One predicate, `countsTowardQuota`, and one PostgREST filter built from it,
`quotaCountFilter`, so the client's "23 left" and the server's refusal are the same query.

### The prompt

`supabase/functions/_shared/prompts/cards.ts`, version string **`cards.v1`**, written to
`generations.prompt_version` on every row including refusals. Going forward: any change
that could move output quality — a rule's wording, the order of the rules, the output
contract — bumps the version in the same commit; comment typos do not. The source text is
delimited, and the instruction to emit JSON is repeated _after_ it, so a prompt-injection
attempt inside the pasted text is arguing with something that gets said again underneath
it.

### The shared-schema import: it worked, with one catch

`supabase/functions/_shared/schemas.ts` is `export * from '../../../src/lib/schemas.ts'`,
verified with `deno check` before anything else was written, exactly as this plan
instructed. It works — and the same bridge now carries five more modules (`ndjson`, `sse`,
`quota`, `generate`, `fsrs`), so the Edge Function runs the code `npm test` tests rather
than a Deno-flavoured copy of it.

Two things had to change for it:

1. **Deno requires the `.ts` extension** on a relative import. `src/lib/sse.ts`,
   `generate.ts` and `fsrs.ts` now write `./schemas.ts` rather than `./schemas`, and
   `tsconfig.app.json` sets `allowImportingTsExtensions: true` (legal because the project
   is `noEmit`; Vite and Vitest resolve both forms). The alternative — an import map keyed
   on resolved file URLs — depends on the CLI passing that map through at deploy time,
   which is a worse thing to bet on than a compiler flag.
2. **Deployment must use `--use-api`.** That is the documented path for bundling a function
   which imports files from outside `supabase/`, as this one does by design. It is baked
   into `npm run fn:deploy`, and `supabase/config.toml` now names the function's entrypoint
   and import map explicitly rather than relying on discovery.

`npm run fn:check` runs `deno check` over the function. It is the only typechecker that
sees this code, since `tsc` and ESLint both exclude `supabase/functions`.

### Deviations from the plan, and why

- **The pure modules live in `src/lib/`, not in `_shared/`.** `ndjson.test.ts`,
  `quota.test.ts` and `generate.test.ts` are named in this plan's test table, and Vitest
  only collects `src/**`. Putting the line reader, the SSE codec, the quota policy and the
  per-line ingest rule under `src/lib` and bridging them into Deno is what makes those
  tests test the deployed code. `_shared/` keeps what only makes sense server-side: the
  streaming `Response`, the counting queries, the prompt, CORS.
- **`_shared/http.ts` exists** (CORS preflight, and the error response for failures that
  happen before the stream starts). The browser calls the function cross-origin; without it
  every request fails as a CORS error that says nothing about the request.
- **Quota state is not on the `meta` frame.** SPEC §7.5 (6) asked for it on the response;
  instead `useQuotaUsage` counts the same rows with the same filter, which puts the figure
  in front of the user _before_ submitting — where it does more good — and leaves
  `StreamEvent` untouched. SPEC §7.5 (6) now says so.
- **No org-wide spend ceiling.** `GENERATION_ENABLED` is implemented; on a free tier there
  is no spend to cap, and the shared resource actually worth protecting is the rate limit.
  SPEC updated.
- **`StagingList` is one component for both halves of the flow.** During generation it
  shows arriving cards plus skeleton rows; at the gate the same rows grow accept / edit /
  reject. Two components would be two renderings of a generated card that could disagree.
- **No migration.** P2 needed no schema change: `generations`, `deck_status`,
  `card_status = 'draft'` and `cards.source_excerpt` were all built in P0 for this phase.
  The migration list in the root `README.md` is therefore unchanged.

### What is **not** verified, and what the owner has to do

The end-to-end criterion — _paste 2,000 characters, 20 cards, first card under five
seconds_ — **has not been run**, because it cannot be from here: `npx supabase secrets
list` returns an empty list, so there is no Groq key on the project, and the function has
not been deployed. Everything up to that boundary is verified (schemas, line reader,
ingest, quota, RLS, the gate's interactions, and a Deno typecheck of the function itself);
everything past it is three commands, also in the README under **Generation**:

```bash
npx supabase secrets set GROQ_API_KEY=gsk_...
npx supabase secrets set GENERATION_MODEL=llama-3.3-70b-versatile
npm run fn:deploy
```

Until then `/create/text` renders, validates, and answers "not configured on this project
yet" — not a stack trace. First things to check on a real run: the first card's latency,
and whether the model holds the one-object-per-line contract well enough that `warn` frames
stay rare. If line adherence disappoints, SPEC §7.3 already names the fallback — batch mode
with a `{"cards":[…]}` object — and `src/lib/generate.ts` is where it would land.

### Measurements

- **251 tests green across 17 files** (`npm test`), up from 157 across 11. New:
  `ndjson.test.ts`, `sse.test.ts`, `generate.test.ts`, `quota.test.ts` (pure) and
  `src/test/quota.test.ts` (against PGlite), `StagingList.test.tsx`, plus real-and-
  adversarial model output appended to `schemas.test.ts` and draft isolation appended to
  `rls.test.ts`.
- `npm run typecheck`, `npm run lint` (0 errors; the same 4 pre-existing fast-refresh
  warnings), `npm run build` and `npm run fn:check` all pass.
- `git grep -i groq` finds only the _name_ of the secret — in documentation and in
  `Deno.env.get('GROQ_API_KEY')`. No key value anywhere.
- The bundle is 797 kB (234 kB gzipped), one kilobyte more than P1: the generation UI is
  assembly of components that already existed. Code-splitting stays a P4 concern.
