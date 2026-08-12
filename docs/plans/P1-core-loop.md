# P1 — Core loop, no LLM

Build the app that would still be worth using if the LLM never got added: accounts, decks,
cards of all three kinds by hand, and FSRS practice with a trustworthy schedule.

**Reference:** SPEC.md §4.2, §4.3, §5, §6, §8.3, §8.4.

**Done when:** a deck built by hand schedules correctly across a simulated week, every
review is logged, and undo restores the exact prior scheduling state.

## Preconditions

```bash
npm test && npm run typecheck && npm run build   # all green before starting
```

- P0 complete (it is).
- **Tasks 1–4 need no live database** — the PGlite harness runs migrations locally.
- **Tasks 5+ need P0b done** (linked Supabase project, typed client, `.env.local`).
  If P0b is still blocked, do tasks 1–4, run the tests, and stop there rather than
  stubbing auth.

## Out of scope — do not build these here

- Anything touching an LLM: no Edge Function, no `generations` writes, no
  `/create/text` behaviour. P2 owns all of it.
- The progress dashboard (heatmap, retention, streaks). P3. A `/progress` placeholder is
  fine; a half-built chart is not.
- FSRS parameter optimisation. Needs ~1000 reviews to mean anything; post-v1.
- Deck sharing, deck export/import, PDF or file upload.
- Deployment. P4.
- Card media (images, audio). Not in v1 at all.

## Tasks

Ordered so `npm run dev` works after every one.

### 1. FSRS wrapper — `src/lib/fsrs.ts`

Wrap `ts-fsrs` rather than calling it from components, so scheduling policy lives in one
file and stays testable without React.

Export:

- `scheduler(params?)` — builds the `ts-fsrs` instance. Enable **fuzz** (cards created
  together must not clump forever) and pass `profiles.fsrs_params` when present.
- `previewSchedule(card, now)` → the four outcomes, so the rating buttons can show
  "Good → 4d" before the user commits.
- `applyGrade(card, grade, now)` → `{ next, log }` where `next` is exactly the scheduling
  columns to write and `log` is exactly the `reviews` row to insert.

Constraints:

- Map `ts-fsrs` `State`/`Rating` enums to the DB enum strings and the 1–4 integers in one
  place. A mismatch here silently corrupts schedules, so it gets a dedicated test.
- Pure functions. No Supabase import in this file.
- Day boundary is **04:00 in the user's timezone** (SPEC §6). Put that helper in
  `src/lib/day.ts` — P3's heatmap and streak logic must use the same one, and two
  implementations of "what day is it" will disagree.

### 2. `review_card` RPC — new migration

`supabase/migrations/<ts>_review_card.sql`. This is the atomicity guard from SPEC §6: one
statement inserts the log row and reschedules the card, or neither happens.

```sql
create function public.review_card(
  p_card_id uuid,
  p_rating smallint,
  p_duration_ms int,
  p_expected_updated_at timestamptz,
  p_next jsonb
) returns public.cards
language plpgsql
security invoker            -- RLS must apply; do NOT use security definer
set search_path = public
as $$ … $$;
```

Behaviour:

1. `select … from cards where id = p_card_id for update` — lock the row.
2. If not found → raise (RLS already hid other users' rows, so "not found" covers both).
3. If `updated_at <> p_expected_updated_at` → raise a distinguishable error. This is the
   stale-rating guard: two tabs open, both showing the same card.
4. Insert the `reviews` row from the card's **current** values (`state_before`,
   `stability_before`, `difficulty_before`, `elapsed_days`, `scheduled_days`).
5. Update the card from `p_next`; `reps = reps + 1`, and `lapses = lapses + 1` only when
   `p_rating = 1`.
6. Return the updated row.

Validate `p_next` keys explicitly and raise on anything unexpected — it arrives from the
client, and RLS does not check payload shape.

Also add `undo_last_review(p_card_id uuid)`: read the newest `reviews` row for the card,
restore the `*_before` values onto the card, and **leave the review row in place**. The log
is append-only by policy (§5.7) so it cannot be deleted anyway; a rating that was undone is
real history and matters to the optimiser later. Add `undone_at timestamptz` to `reviews`
in this same migration so P3's retention math can exclude undone reviews.

### 3. Query layer — `src/lib/queries.ts`

TanStack Query hooks, thin over `supabase-js`. Query keys as SPEC §8.3:
`['decks']`, `['deck', id]`, `['queue', deckId ?? 'all']`, `['profile']`.

- `useDecks`, `useDeck`, `useCreateDeck`, `useUpdateDeck`, `useDeleteDeck`
- `useCards(deckId)`, `useCreateCard`, `useUpdateCard`, `useDeleteCards`
- `usePracticeQueue(deckId?)` — see task 6 for the query itself
- `useReviewCard` — calls the RPC, optimistic
- `useProfile`, `useUpdateProfile`

Every mutation validates with `CardPayload` / the deck schema **before** the network call,
so bad data fails fast and locally.

### 4. Card rendering + editing — `src/features/cards/`

- `CardFront` / `CardBack` — a discriminated switch on `kind`. Render text only; the
  ESLint rule in `eslint.config.js` blocks `dangerouslySetInnerHTML` and should stay that
  way.
- `ClozeText` — uses `parseCloze` from `src/lib/schemas.ts`. Blanks render as a masked
  span with `aria-label="blank"` (SPEC §8.4), never bare underscores.
- `McqOptions` — radio group; reveals correctness after selection.
- `CardEditor` — react-hook-form + `zodResolver(CardPayload)`, one sub-form per kind.
  Handles a kind switch without losing already-typed content where fields overlap.

Cloze editor detail: run `splitClozeGroups` on save. Pasting a two-group note must create
two cards, not throw a validation error at the user (the schema rejects multi-group by
design — the editor is where the split happens).

### 5. Auth — `src/features/auth/`

Requires P0b.

- `AuthProvider` — wraps `supabase.auth`, exposes `{ session, user, loading }`, subscribes
  to `onAuthStateChange` and unsubscribes on unmount.
- `LoginPage` / `SignupPage` — email + password. Show Supabase's error text; do not
  paper over "email not confirmed".
- `ProtectedRoute` — redirects to `/login` preserving the attempted path. Renders nothing
  (not a redirect) while `loading`, or every refresh flashes the login page.
- Wire into `src/app/routes.tsx`: wrap the `AppLayout` route element.

### 6. Practice — `src/features/practice/`

The queue query, in SQL terms:

- Due reviews: `status = 'active' and due <= now()`, order by `due`.
- New cards: `status = 'active' and fsrs_state = 'new'`, capped at
  `profiles.daily_new_limit` minus new cards already introduced today (count
  `reviews` where `state_before = 'new'` and `reviewed_at >= ` today's 04:00 boundary).
- Interleave: due reviews first, new cards spread through. **Reviews are never starved by
  new cards** (SPEC §6).

UI:

- `PracticeSession` — owns `currentIndex` and `revealed` in local state, not Query
  (SPEC §8.3).
- Rating is **optimistic**: advance immediately, roll back and toast on failure. Practice
  that waits on a round-trip per card is practice nobody does.
- Keyboard: `Space` reveal, `1`–`4` rate, `E` edit, `U` undo. Bind on the container with a
  visible focus ring; do not bind to `document` (it fights the editor's inputs).
- The flip is a `<button aria-expanded>` (SPEC §8.4), not a div.
- Session summary on exhaustion: count, rating split, next due time.

### 7. Deck management — `src/features/decks/`

- `DecksPage` — cards-count and due-count per deck, search, create, delete-with-confirm.
- `DeckDetailPage` — card table, kind filter, inline edit via `CardEditor`, bulk select +
  delete, manual add, suspend/unsuspend.
- `DashboardPage` — due-today count, quick-practice button, recent decks. Keep it thin;
  the interesting numbers arrive in P3.

### 8. Settings — `src/features/settings/`

`daily_new_limit`, `timezone` (from `Intl.supportedValuesOf('timeZone')`), display name.
Timezone matters more than it looks: it defines every day boundary in the app.

### 9. Empty states

Every list needs one: no decks, no cards in a deck, nothing due. "Nothing due — next card
in 4 hours" is the single highest-value empty state in an SRS app, because it is the
state a healthy user sees most often.

### 10. Write the P2 plan

`docs/plans/P2-generation.md`, authored against the code that now exists, and update the
board in `docs/plans/README.md`.

## Acceptance criteria

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
- Sign up → create deck → add one card of each kind by hand → practice → rate → the card's
  `due` moves and a `reviews` row exists.
- Rating the same card in two tabs: the second rating fails with the stale-state error
  rather than double-logging.
- Undo restores `stability`, `difficulty`, `due`, `fsrs_state`, and `reps` to their exact
  prior values.
- A simulated week (test, not by hand) shows intervals growing on Good/Easy and collapsing
  on Again, with `lapses` incrementing only on Again.
- New cards per day never exceed `daily_new_limit`; due reviews are never dropped to make
  room for new ones.
- Full keyboard path through a practice session with no mouse.
- Practice queue fetch under 300ms against a deck of 2,000 cards (SPEC §10). Seed a deck
  that size in the harness and measure — the partial index exists for this.

## Tests to write

Extend the PGlite harness; it already runs migrations, so RPC tests need no cloud project.

| Test                                                            | Failure it catches                                           |
| --------------------------------------------------------------- | ------------------------------------------------------------ |
| `fsrs.test.ts` — each grade from each of the 4 states           | Enum/rating mapping drift between `ts-fsrs` and the DB       |
| `fsrs.test.ts` — simulated 7-day sequence                       | Intervals that look plausible per-step but diverge over time |
| `review_card.test.ts` — happy path                              | Log row and card update disagreeing                          |
| `review_card.test.ts` — stale `p_expected_updated_at`           | Double-rating from two tabs                                  |
| `review_card.test.ts` — another user's card id                  | RPC bypassing RLS (would be a breach, not a bug)             |
| `review_card.test.ts` — `lapses` only on rating 1               | Silent lapse-count corruption                                |
| `undo.test.ts` — restores exact prior state                     | Undo that "looks right" but loses stability                  |
| `queue.test.ts` — new-card cap honoured                         | Cap that leaks and floods the user                           |
| `queue.test.ts` — due reviews not starved by new cards          | The most common SRS scheduling bug                           |
| `day.test.ts` — 04:00 boundary across timezones and a DST shift | Streaks breaking for anyone outside UTC                      |
| `CardEditor.test.tsx` — multi-group cloze paste splits          | A validation error shown to the user instead of two cards    |

## Decisions recorded

Executed 2026-08-12. Everything below is what was actually chosen, not what was planned.

### Scheduler

- **`ts-fsrs` 5.4.1**, pinned by `package-lock.json`. FSRS behaviour changes between
  versions and a schedule is a long-lived artifact, so a major bump is a decision, not a
  chore.
- **Default parameters throughout**: default weights `w`, `request_retention` 0.90,
  `maximum_interval` 36500, default learning steps `[1m, 10m]` and relearning steps `[10m]`.
  Nothing was tuned. `profiles.fsrs_params` is still null for every user and is passed
  through `scheduler()` when it is not, so the post-v1 optimiser needs no code change here.
- **Fuzz: on.** ts-fsrs seeds it from the card rather than a global RNG, so two cards with
  the same interval scatter while one card asked twice answers the same. That determinism
  is load-bearing: it is what lets a rating button promise "Good → 4d" and then honour it.
- **Short-term learning steps: on** (the library default), which forced a schema addition —
  see below.

### Schema additions beyond the plan

Three, all in `supabase/migrations/20260812093000_review_card.sql`, all because the plan's
acceptance criteria could not otherwise be met:

1. **`cards.learning_steps`.** ts-fsrs reads the step index off the card. Without a column
   for it, every learning card restarts at step 0 on each review, so a card rated Good
   repeatedly loops on the 10-minute step and never graduates — a wrong schedule that looks
   entirely normal in the UI. The alternative, `enable_short_term: false`, was rejected
   because it retires the `learning` and `relearning` states altogether, and SPEC §4.4
   reports a distribution across all four.
2. **`reviews.due_before`, `last_review_before`, `elapsed_days_before`,
   `learning_steps_before`.** "Undo restores the exact prior scheduling state" is not
   satisfiable from the columns §5.4 originally listed — `due` in particular is
   unrecoverable, and deriving the others from the preceding log row breaks as soon as a
   review in the middle has been undone. Explicit columns, one exact answer.
3. **`reviews.undone_at`**, as the plan specified — plus the mechanism to set it, which the
   plan did not anticipate: §5.7 gives `reviews` no UPDATE policy at all, so a tombstone was
   impossible. Rather than make `undo_last_review` `security definer` (which would hand undo
   a way past RLS for every other column too), the table got a narrow UPDATE policy and a
   trigger that permits `undone_at` and nothing else, once. Both functions stayed
   `security invoker`. `src/test/rls.test.ts` was updated to assert the new shape.

### Error codes

`review_card` and `undo_last_review` raise `PT404` (not yours / not found — RLS makes those
the same thing) and `PT409` (the card moved since the client loaded it). PostgREST maps a
`PTxxx` SQLSTATE onto that HTTP status, so `isStaleCardError` in `src/lib/queries.ts` can
tell a two-tab conflict from a real failure and say so instead of showing a stack trace.

### Deviations worth knowing

- **`elapsed_days` on the log comes from `p_next`**, not from the card's current row as the
  plan's step 4 says. The card's stored `elapsed_days` is the elapsed time of its _previous_
  review; the number an optimiser needs is the one the scheduler actually saw. Every other
  `*_before` field is read from the locked row.
- **Lapses count every `Again`**, per the plan, which differs from ts-fsrs's own rule
  (it counts one only from the `review` state). `lapses` is a display counter and is not an
  input to the FSRS model, so the simpler rule costs nothing — what matters is that it is
  applied in exactly one place, `review_card`.
- **The queue policy is a pure function**, `src/lib/queue.ts`, so "the cap holds" and
  "reviews are never starved" are testable without a database. The SQL stayed a plain fetch.
- **`decks.new_cards_per_day` is unread.** The cap is `profiles.daily_new_limit` only, as
  the plan specified; SPEC §5.2 now says so.

### Migration

`supabase/migrations/20260812093000_review_card.sql`, appended to the list in the root
`README.md`. **It has not been pushed** — pushing is the owner's call. Until it is:

- `src/types/database.ts` carries the new columns and functions **by hand**, with a note at
  the top saying so. Re-run `npm run db:types` after `npm run db:push` and the note goes.
- `npm test` already runs this migration against PGlite, so it is verified, just not live.

### Measurements

- 156 tests green across 11 files (`npm test`), plus `typecheck`, `lint` (0 errors, 4
  fast-refresh warnings), and `build`.
- The queue fetch over a seeded 2,000-card deck stays under the SPEC §10 300ms budget in
  PGlite — Postgres in WebAssembly, so the pessimistic case — and `explain` confirms it uses
  the partial index rather than scanning. Both assertions live in `src/test/queue.test.ts`.
- The production bundle is 796 kB (234 kB gzipped), over Vite's 500 kB warning line. Not
  addressed here: code-splitting is a shipping concern and belongs to P4.
