# P4 — Ship

Make it something a stranger can sign up to and get value from, on a URL, without you in
the room. Everything the product does already works; what is missing is the last mile —
the app is one 828 kB bundle, an exception anywhere blanks the screen, `/create/text`
still answers "not configured on this project yet", and nobody outside this machine can
reach any of it.

**Reference:** SPEC.md §8.2, §10, §11, §12 (3), §13.

**Done when:** a signed-out visitor can reach the deployed URL, create an account,
generate a deck, practise it, and see `/progress` fill in — and a deliberately broken
render shows a recovery card rather than a white page.

## Preconditions

```bash
npm run typecheck && npm run lint && npm test && npm run build   # all green before starting
```

- P3 complete. **299 tests across 19 files.** Five migrations applied; the database
  matches the repository and `src/types/database.ts` was regenerated from it.
- **P4 adds no migration.** If a task here seems to need one, it is the wrong task —
  every table, policy and function v1 needs already exists.
- Current build, measured 2026-08-12:

  | Chunk                | Raw       | Gzip      |
  | -------------------- | --------- | --------- |
  | `index-*.js`         | 827.88 kB | 243.28 kB |
  | `ForecastChart-*.js` | 383.62 kB | 111.90 kB |
  | `ProgressPage-*.js`  | 13.43 kB  | 4.32 kB   |
  | `index-*.css`        | 37.17 kB  | 7.21 kB   |

  P3 split Recharts out; the main bundle is still 65% over Vite's 500 kB warning line.
  **Code-splitting here is real work, not a tidy-up.**

- One item is outstanding from P2 and blocks two tasks below: `GROQ_API_KEY` and
  `GENERATION_MODEL` are not set as function secrets, and `npm run fn:deploy` has never
  run. Generation is therefore unconfigured in production, and the demo account cannot be
  seeded with generated cards until it is.

## Out of scope — do not build these here

- Anything on the post-v1 list: documents/PDF ingest, FSRS parameter optimisation, PWA and
  offline, shared decks, generated quiz mode, notes. SPEC §11 is the boundary.
- Per-deck analytics. `/progress` is account-wide in v1 (settled at P3).
- New tables, columns, policies or functions. See preconditions.
- Redesign. The product's look is settled; P4 changes what happens when things go wrong,
  not what things look like when they go right.
- Analytics, telemetry, error reporting SaaS. A third-party script on a page that renders
  untrusted LLM output is a decision with a security argument attached, and it is not one
  this phase needs to make. Error boundaries log to the console; that is enough for v1.
- Custom domains, CDN tuning, multi-region. Vercel's default domain ships v1.

## What already exists, and should be used rather than rebuilt

| Thing                                    | Where                                | Note                                                                                    |
| ---------------------------------------- | ------------------------------------ | --------------------------------------------------------------------------------------- |
| The `React.lazy` + `Suspense` pattern    | `src/app/routes.tsx`                 | `/progress` is already split this way; the other routes copy it exactly                 |
| `PagePlaceholder`                        | `src/components/PagePlaceholder.tsx` | One usage left — the 404. Replace it, then **delete the component**                     |
| `EmptyState`                             | `src/components/EmptyState.tsx`      | The 404 and the error card are both empty states with a way out                         |
| `ClientEnv` and its `sb_secret_` refusal | `src/lib/env-schema.ts`              | Already tested. The deploy must not need a new env var beyond the two it validates      |
| `.env.example`                           | repo root                            | The list of what Vercel needs. Keep the two files saying the same thing                 |
| `npm run fn:deploy`, `npm run fn:check`  | `package.json`                       | `--use-api` is deliberate: no Docker on this machine                                    |
| `npm run db:pg-version`                  | `scripts/check-pg-version.mjs`       | Run it against production once more before calling the deploy done                      |
| `seedDeck`, `seedCard`, `seedReview`     | `src/test/fixtures.ts`               | The demo seeder wants the same shapes; it does **not** get to invent its own insert SQL |
| `useGenerateCards`                       | `src/features/generate/`             | The demo seeder should drive the real pipeline, not a parallel one                      |

## Tasks

Ordered so `npm run dev` works after every one, and so nothing that needs the owner's
credentials blocks anything that does not.

### 1. Error boundaries — `src/app/ErrorBoundary.tsx`

Today an exception in any component unmounts the tree and leaves a white page. That is the
single worst failure the deployed app can have, because it is indistinguishable from the
site being down.

- A class component (React still has no hook for this) exposing `{ fallback, children }`.
- Two placements: one inside `AppLayout` around `<Outlet />`, so a broken page keeps the
  nav and the user can leave; one in `providers.tsx` around everything, so a failure in the
  layout itself still renders something.
- The fallback is an `EmptyState`: what happened, a **Try again** button that resets the
  boundary, and a link to `/dashboard`. `console.error` the error — no reporting service.
- Reset on route change, or a user who navigates away stays stuck on the fallback.

Do not wrap individual cards on `/progress` in their own boundaries. A metric that throws
is a bug to fix, not a hole to paper over.

### 2. The 404, and the end of `PagePlaceholder`

`src/app/routes.tsx` still renders `PagePlaceholder title="Page not found" phase="P4"` for
`*`, which tells a stranger about a phase plan they cannot read. Replace it with a real
not-found page, then delete `src/components/PagePlaceholder.tsx` — with the `/progress`
usage gone in P3, this is its last caller, and a scaffold left in the tree gets used again.

### 3. `/auth/callback` — the route SPEC §8.2 lists and the app does not have

Supabase email confirmation and password-recovery links land on a redirect URL. There is no
`/auth/callback` route, so today they land on the 404 the previous task just wrote.

- Add the route: exchange the code in the URL for a session, then redirect to `/dashboard`
  on success or `/login` with a message on failure.
- It must be a `PublicOnlyRoute`-style page — an unauthenticated visitor is exactly who
  arrives here.
- Verify against the real project. This is the one part of auth the PGlite harness cannot
  test, because it stubs only `auth.users` (see `src/test/pg-harness.ts`).

### 4. Code-split the routes — `src/app/routes.tsx`

The target is the bundle a signed-out visitor downloads to see the login form. Right now
that is all of it: `ts-fsrs`, the card editor, the generation pipeline, every Radix
primitive in the app.

Lazy-load, using the `/progress` boundary as the template:

- `CreateFromTextPage` and `ReviewGatePage` — the generation pipeline and its schemas.
- `DeckDetailPage` — `CardEditor` and the Radix dialog work.
- `PracticePage` — `ts-fsrs` and the rating UI.
- `SettingsPage`.

Keep `DashboardPage` and the auth pages eager: they are the first screen in both states,
and a spinner there is worse than the bytes.

Measure after each one (`npm run build` prints the table). Two things to watch:

- A shared import defeats the split. `DashboardPage` imports `streaks` from
  `src/lib/progress.ts`, which is why that module is in the main chunk and should stay
  there — but check nothing else has quietly done the same with a heavy module.
- `radix-ui` is imported as the meta-package (`import { AlertDialog } from 'radix-ui'`).
  Confirm it tree-shakes; if it does not, importing `@radix-ui/react-alert-dialog`
  directly is the fix, and it is a mechanical change across `src/components/ui/`.

**Success is a number, not a feeling:** the eager bundle under 400 kB raw. Record what it
actually reaches, and if it does not reach it, record why rather than deleting the target.

### 5. Deploy the frontend — `vercel.json`

- SPA fallback. `BrowserRouter` means a hard refresh on `/decks/abc` is a request Vercel
  must rewrite to `/index.html`, or every deep link 404s. This is the single most common
  way a working SPA ships broken.
- Cache headers: `assets/*` are content-hashed and immutable; `index.html` must not be.
- Environment variables in the Vercel project: `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, matching `.env.example` exactly. **Nothing else.**
  `src/lib/env-schema.ts` refuses to boot on an `sb_secret_` value and that refusal is
  tested — do not work around it if a build fails, read what it says.

**Owner-only:** connecting the repository to Vercel, and setting those variables. The
config file belongs in the commit; the account does not.

### 6. Configure and deploy the Edge Function — **owner-only**

Carried over from P2, and now blocking:

```bash
npx supabase secrets set GROQ_API_KEY=... GENERATION_MODEL=llama-3.3-70b-versatile
npm run fn:check      # Deno typecheck; tsc and ESLint both exclude supabase/functions
npm run fn:deploy     # --use-api, because there is no Docker here
```

Then set Supabase Auth's Site URL and Redirect URLs to the Vercel domain, or task 3's
callback never receives anything in production.

Verify by generating a real deck through the deployed app and reading the `generations`
row: `status = 'succeeded'`, a model, a token count. §13 (1) is measured here — first card
visible in under 5 seconds.

### 7. The demo seed account — `scripts/seed-demo.mjs`

A stranger who signs up sees an empty app, and the product's argument does not survive an
empty app. The demo account is what a first visit can be pointed at.

- Needs task 6 done first: the decks must contain **generated** cards, because that is what
  the product is, and hand-written stand-ins would misrepresent it.
- Three or four decks on different subjects; a review history seeded across the last
  ~60 days so `/progress` shows a real heatmap, a streak, and a retention split rather
  than four empty cards.
- Insert through the same shapes `src/test/fixtures.ts` uses — particularly `seedReview`,
  which already knows that `reviewed_at` has to be _placed_ rather than accumulated, and
  that the pre-review snapshot columns are not optional.
- The reviews must be internally consistent: a card's `fsrs_state` and `stability` have to
  be what its logged ratings would actually have produced. Replay them through
  `applyGrade` rather than writing plausible-looking numbers, or `/progress` shows a
  retention figure the schedule contradicts.
- Credentials in the README, and a note that the account is periodically reset.

### 8. README — the runbook

The README currently explains the repository. P4 makes it explain the product and the
deploy: what it is and a screenshot; local setup; the deploy procedure end to end,
including the two Supabase secrets and the Vercel variables; the demo account; and what to
do when generation says "not configured".

Keep the database and Postgres-pinning sections — they are the parts a future session most
needs, and the pg-version guard is easy to misread as noise.

### 9. Verify the §10 budget on the deployed app

Not on localhost. Against the real project, with real latency:

- Practice queue fetch under 300 ms p95.
- Rating → next card under 100 ms perceived. It is optimistic, so this measures the UI.
- Time-to-first-card in generation under 5 s.
- `/progress` on a seeded year of reviews. `review_day_counts` is the one query written
  specifically for this budget; confirm it earns its migration.

Record the numbers. A budget nobody measured is a comment.

### 10. Tests

| Test                                                              | Failure it catches                                                 |
| ----------------------------------------------------------------- | ------------------------------------------------------------------ |
| `ErrorBoundary.test.tsx` — a throwing child renders the fallback  | The boundary that is never exercised until production              |
| `ErrorBoundary.test.tsx` — **Try again** re-renders the child     | A fallback with no way out, which is a white page with extra steps |
| `routes.test.tsx` — an unknown path renders the 404, not a crash  | A `*` route that silently stops matching after a lazy refactor     |
| `routes.test.tsx` — every lazy route resolves behind its Suspense | An import path typo in a chunk nobody loads until a user clicks it |
| One E2E happy path (Playwright, optional per §10)                 | The seam between signup, generation, the review gate, and practice |

The E2E is genuinely optional. If it is skipped, say so and say why, rather than leaving
its absence to be discovered.

### 11. Close v1 — `docs/plans/POST-V1.md`

The last task of every plan is to write the next one. There is no P5: what follows v1 is a
backlog, not a phase. Write it as one — SPEC §11's post-v1 row, expanded with what P1–P4
learned about each item, and each entry saying what would have to be true before it is
worth starting. Then update the board in `docs/plans/README.md`.

The one worth writing carefully: **FSRS parameter optimisation**. It needs ~1,000 reviews
before it means anything, and `/progress` is now the thing that can tell you when you have
them. `reviews` has carried the full pre-review snapshot since P1 precisely so this is
possible without a migration.

## Acceptance criteria

- `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` all pass, and
  `npm run fn:check` passes for the function.
- The deployed URL serves the app; a hard refresh on `/decks/:id` loads the deck, not a 404.
- A component that throws renders the recovery card, with the nav still usable.
- An unknown path renders the 404 page, and `src/components/PagePlaceholder.tsx` no longer
  exists.
- A confirmation email's link lands on `/auth/callback` and ends up signed in.
- The eager bundle is under 400 kB raw, or the reason it is not is written down.
- Generation works in production end to end, and the `generations` row says `succeeded`.
- The demo account exists, and its `/progress` shows a heatmap, a streak, and a retention
  split from a real seeded history.
- `npm run db:pg-version` still agrees with `supabase/pg-version.json`.

## Decisions to record

Write these back into this file as the phase closes:

- The eager bundle size actually reached, which routes were split, and whether `radix-ui`
  needed to be imported per-package.
- The measured §10 numbers, from the deployed app.
- Whether the E2E test was written, and if not, why not.
- What the demo account is, how it is reset, and where its credentials live.
- Anything about the Vercel or Supabase configuration that a future session would have to
  rediscover — the SPA rewrite rule especially, because it fails in a way that looks like
  a routing bug in the app.
