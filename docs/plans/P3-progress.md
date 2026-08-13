# P3 — Progress

Turn the review log into the picture of a habit: a year of activity, a streak worth
keeping, retention that says whether the schedule is working, and a forecast of what
tomorrow costs. Nothing invented — every number on this page is derived from `reviews`
and `cards`, or it does not go on the page (SPEC §13 (4)).

**Reference:** SPEC.md §4.4, §5.4, §6, §8.1, §8.2, §10.

**Done when:** `/progress` reflects a real review history, the streak survives a session
that crosses midnight and a session in another timezone, and every figure can be traced to
rows in the log.

## Preconditions

```bash
npm test && npm run typecheck && npm run lint && npm run build   # all green before starting
```

- P2 complete. 251 tests across 17 files.
- P2 left one thing to the owner, and it does **not** block P3: the Groq key and
  `npm run fn:deploy`. Generation being unconfigured has no effect on this phase — P3 reads
  the review log, and hand-written cards produce the same rows generated ones do.
- The database matches the repository. P3 adds a migration; apply it the same way, per
  CLAUDE.md: `npm run db:push`, then `npm run db:types`, then commit the regenerated file.

## Out of scope — do not build these here

- FSRS parameter optimisation. Still post-v1: it needs ~1,000 reviews before it means
  anything, and this phase is what will eventually tell you when you have them.
- Anything about generation. P2 owns `/create/*`; if a progress number needs a change in
  the Edge Function, the number is wrong.
- Deployment, code-splitting the bundle, error boundaries, the demo seed account. P4.
- Per-deck analytics pages. `/progress` is account-wide in v1; a deck-scoped variant is a
  post-v1 nicety, not a phase.
- Changing the review log's shape. `reviews` is append-only by policy (SPEC §5.4) and it
  already carries every column these metrics need. If a metric seems to need a new column,
  re-read §5.4 first — `state_before`, `due_before`, and `undone_at` are there precisely
  for this phase.
- Goals, XP, badges, "you're on fire". SPEC §4.4 says real data only, and a streak is
  already the one honest motivator in the product.

## What already exists, and should be used rather than rebuilt

| Thing                                                                | Where                         | Note                                                                                                                |
| -------------------------------------------------------------------- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| `studyDayKey`, `startOfStudyDay`, `addStudyDays`, `studyDaysBetween` | `src/lib/day.ts`              | The 04:00 boundary. **Use these.** A second answer to "what day is it" is the bug this phase is most likely to ship |
| `resolveTimeZone`, `detectTimeZone`, `isValidTimeZone`               | `src/lib/day.ts`              | The zone comes from `profiles.timezone`, never from the browser at read time                                        |
| `reviews.undone_at`                                                  | migration `…_review_card.sql` | An undone rating stays in the log and must be excluded from every metric                                            |
| `reviews.state_before` / `state_after`                               | §5.4                          | Retention "split by card state" means grouping on `state_before`                                                    |
| `useProfile`, `queryKeys`, `unwrap`                                  | `src/lib/queries.ts`          | Follow the existing hook shape; keys under `['stats', …]` per SPEC §8.3                                             |
| `EmptyState`, `Skeleton`, `Card`, `Badge`                            | `src/components/`             | The empty state matters more here than anywhere: a new account has no history                                       |
| `formatInterval`, `formatDate`, `plural`                             | `src/lib/format.ts`           | Display only; never let a formatter decide a number                                                                 |
| `createTestDb`, `seedCard`, `reviewCard`, `undoLastReview`           | `src/test/`                   | A seeded month of reviews is a fixture, not a mock                                                                  |
| `PagePlaceholder`                                                    | `src/components/`             | Delete its `/progress` usage when the real page lands                                                               |

## Tasks

Ordered so `npm run dev` works after every one.

### 1. The metrics, as pure functions — `src/lib/progress.ts`

No Supabase import, no React, no clock that is not passed in. Everything here takes rows
and returns numbers, so the awkward cases — a streak across a DST change, a month with one
review in it — are unit tests rather than something you can only see by studying for a
week.

Export at least:

- `streaks(dayKeys: string[], today: string)` → `{ current, longest }`. A day counts with
  ≥1 review (SPEC §4.4). Today not yet reviewed must **not** break the current streak;
  yesterday not reviewed does.
- `retention(rows, window)` → percentage graded ≥ Hard, plus the denominator. Split by
  `state_before`, because a 95% on new cards and a 95% on mature ones mean opposite things.
- `stateDistribution(cards)` → new / learning / review / relearning.
- `forecast(cards, from, days)` → due counts per study day, bucketed with `studyDayKey`.
- `heatmapGrid(counts, today, weeks)` → the 53×7 grid the CSS heatmap renders, with the
  empty leading cells the first week needs.

Rules:

- Undone reviews are excluded **before** anything counts them. Take rows already filtered,
  and make the filter impossible to forget by naming the input type for it.
- Percentages return `null`, not `0` or `NaN`, when the denominator is zero. "No data yet"
  and "0% retention" are different sentences and the UI must be able to tell them apart.

### 2. Aggregate in Postgres — new migration

A year of reviews is up to ~70,000 rows for a serious user. Fetching them to count them is
the wrong shape, and SPEC §10's performance budget is not going to survive it.

`supabase/migrations/<ts>_progress_stats.sql`, following P1's conventions exactly:

```sql
create function public.review_day_counts(p_timezone text, p_from timestamptz)
returns table (
  day date, reviews int, again int, hard int, good int, easy int, introduced int
)
language sql stable
security invoker          -- RLS must apply; do NOT use security definer
set search_path = public
as $$ … $$;
```

- Day bucketing is `(reviewed_at at time zone p_timezone - interval '4 hours')::date`.
  That is a transcription of `studyDayKey`, and task 7 asserts they agree — including
  across a DST transition, which is the case where a hand-rolled version quietly disagrees.
- `where undone_at is null`, always.
- `introduced` counts `state_before = 'new'`, which is what the daily-new cap already
  counts in P1's queue.
- **Revoke EXECUTE from `anon` in the same migration.** Supabase's default privileges grant
  it automatically to every new function; P1 learned this the expensive way and
  `…_revoke_anon_rpc.sql` is the precedent to copy.

A second function for the forecast is optional: `cards` is small enough to bucket on the
client, and one fewer function is one fewer thing to revoke. Decide, and write down which.

Then, per CLAUDE.md: `npx supabase db push --linked --dry-run` first and read what it
lists, then `npm run db:push`, then `npm run db:types`, and commit the regenerated types.

### 3. Queries — `src/lib/queries.ts`

- `useReviewHistory(days)` → the RPC above, keyed `['stats', 'history', days]`.
- `useDueForecast(days)` and `useCardStates()` — plain selects over `cards`; `head: true`
  counts where only a number is needed.
- `useRetention(window)` → reviews since the window start, columns `rating`,
  `state_before`, `reviewed_at` only.

All of them wait for `useProfile` the way `usePracticeQueue` does: the timezone decides
every bucket, and guessing UTC produces a heatmap that is subtly wrong for most of the
world. `staleTime` around a minute — this is a dashboard, not a session.

### 4. The heatmap — `src/features/progress/Heatmap.tsx`

A CSS grid, not a chart library (SPEC §8.1). 53 columns × 7 rows, one cell per study day,
five intensity buckets from the day's review count.

- Each cell is a `<button>` or has a `title`/`aria-label` giving the date and the count —
  a wall of coloured squares with no text is not accessible to anyone who cannot see it.
- Colour must not be the only signal (§8.4 in spirit): the label carries the number.
- Respect the theme's tokens; do not hardcode green.

### 5. The rest of the page — `src/features/progress/`

- `StreakCard` — current and longest, with the honest empty state on day one.
- `RetentionCard` — 7 / 30 / 90 windows, split by card state, with denominators visible.
  A 100% on four reviews should look like what it is.
- `ForecastChart` — next 30 days, stacked bar, Recharts.
- `StateDistribution` — new / learning / review / relearning, and mean stability and
  difficulty with their trend (SPEC §4.4).
- `ProgressPage` — assembly, and the one place that decides what a signed-in account with
  no reviews sees. Point that empty state at practice, not at a chart.

**Recharts is not installed yet.** `npm i recharts`, and import the chart with
`React.lazy` — the bundle is already 797 kB and Recharts is not small. That lazy boundary
is also the first piece of the code-splitting story P4 inherits.

### 6. Wire it in

Replace the `/progress` placeholder in `src/app/routes.tsx`. On `DashboardPage`, swap
whatever is generic for the real streak — it is the number that brings someone back
tomorrow, and it now exists.

### 7. Tests

| Test                                                                 | Failure it catches                                                  |
| -------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `progress.test.ts` — streak across a DST boundary                    | A streak that breaks itself on the last Sunday in October           |
| `progress.test.ts` — a session at 01:00 counts to the previous day   | The 04:00 boundary silently reverting to midnight                   |
| `progress.test.ts` — retention with a zero denominator               | "0% retention" shown to someone who has reviewed nothing            |
| `progress.test.ts` — undone ratings excluded                         | Undo inflating retention, which is exactly backwards                |
| `progress.test.ts` — heatmap grid alignment for a 53-week year       | A grid that puts the wrong count on the wrong day, invisibly        |
| `stats.test.ts` (PGlite) — SQL buckets equal `studyDayKey`           | Two implementations of "what day is it" disagreeing at the boundary |
| `stats.test.ts` (PGlite) — the RPC is closed to `anon`               | The default-privileges grant P1 was bitten by                       |
| `stats.test.ts` (PGlite) — a seeded month aggregates to known counts | An aggregate that is wrong in a way no unit test can see            |

### 8. Write the P4 plan

`docs/plans/P4-ship.md`, authored against the code that then exists, and update the board
in `docs/plans/README.md`. Notes for whoever writes it: the bundle is over Vite's 500 kB
warning line and P3 will have added Recharts, so code-splitting is real work, not a
tidy-up. The Edge Function deploy (`npm run fn:deploy`, `--use-api`) and its two secrets
belong in the deployment checklist. And a demo seed account needs generated cards, which
means the Groq key has to be configured before the demo can be seeded.

## Acceptance criteria

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass.
- A month of seeded reviews produces a heatmap whose totals equal the row count in
  `reviews` where `undone_at is null`.
- Undoing a review lowers today's heatmap count by one.
- A review logged at 01:00 counts towards the previous study day, in the user's timezone
  and not the browser's.
- Retention splits by card state and shows its denominators.
- The forecast's day 0 equals what `/practice` would serve right now.
- A new account sees an empty state that suggests practising, not an empty chart.
- The `/progress` route is code-split: the main bundle does not grow by the size of
  Recharts.

## Decisions recorded — closed 2026-08-12

**Migration filename.** `supabase/migrations/20260812210000_progress_stats.sql`, appended
to the list in the root `README.md`. Pushed with `npm run db:push` after the dry run
listed it and nothing else; `src/types/database.ts` regenerated and committed.

**The forecast is computed on the client.** `cards` is small next to `reviews`, and the
query only fetches active, non-new cards whose `due` falls inside the 30-day horizon —
a bounded set that does not grow with study history the way the review log does. One
fewer SQL function is also one fewer thing to remember to revoke from `anon`, which is
the mistake `…_revoke_anon_rpc.sql` exists to remember. So the phase added exactly one
function, `review_day_counts`, and the heatmap is the only thing aggregated in Postgres.

**Heatmap intensity is a percentile of the user's own history.** Level 0 is a day with
nothing on it. Levels 1–4 divide the range up to the 90th percentile of the user's active
days into four bands, with the top band open-ended (`intensityThresholds`). Fixed counts
were rejected: fifteen reviews a day and three hundred reviews a day are both normal, and
a fixed scale gives one user a uniformly pale year and the other a uniformly dark one. The
90th percentile rather than the maximum, so one 400-card cram session does not flatten the
other 364 days. The legend states the four thresholds, so the scale is never a mystery.

**What the DST tests caught.** Nothing in `day.ts` — P1 built that carefully and it held.
What they did catch is the shape of the SQL. Bucketing as
`(reviewed_at at time zone tz - interval '4 hours')::date` is correct because the
subtraction happens on a `timestamp without time zone`, which has no DST of its own; the
obvious-looking alternative of subtracting four hours from the `timestamptz` _before_
converting is wrong by an hour on the two days a year the clocks move, and by nothing at
all on the other 363, which is exactly how it would have shipped. `stats.test.ts` samples
96 instants at 79-minute steps across four transitions in three zones and compares every
bucket against `studyDayKey`.

Two smaller things worth carrying forward:

- **An unknown timezone falls back to UTC in SQL, not an error.** `resolveTimeZone` already
  makes that choice in the client, and a profile can hold whatever a past version wrote. A
  wrong-but-working heatmap beats a page that 500s.
- **`useRetention` fetches one 90-day window, not three.** 7 / 30 / 90 are nested, so the
  card slices the same rows rather than asking the server the same question three times.

## Where P3 deviated from this plan

- `heatmapGrid(counts, today, days)` takes a **day** count (365), not a week count. 365 days
  is 52 weeks and one day, so the window starts mid-week whatever today is and the grid is
  53 columns either way — which is what produces the leading padding this plan asked for. A
  `weeks` parameter would have had to mean "53 weeks ending today", and that window always
  starts on a week boundary, so there would be no leading cells to pad.
- `useCardStates` is **not** gated on `useProfile`. Nothing it returns is bucketed by day,
  so there is no timezone to get wrong, and waiting on a query it does not use would only
  make the page slower. The three hooks that do bucket by day are all gated.
- `useRetention` selects two columns beyond the three this plan listed —
  `stability_after` and `difficulty_after` — because SPEC §4.4 also asks for mean stability
  and difficulty _and their trend_, and the trend cannot come from the card table alone.
