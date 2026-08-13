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

## Decisions recorded at the close of P4 (2026-08-13)

### The bundle: 781.31 kB raw / 230.94 kB gzip, and why not 400 kB

Split behind `React.lazy`: `DeckDetailPage`, `CreateFromTextPage`, `ReviewGatePage`,
`PracticePage`, `SettingsPage`, and `/progress` as before. Eager: the auth pages,
`DashboardPage`, `DecksPage`, the 404 and `/auth/callback`.

| Chunk                | Before (P3) | After (P4)         |
| -------------------- | ----------- | ------------------ |
| `index-*.js` (eager) | 827.88 kB   | 781.31 kB          |
| gzip                 | 243.28 kB   | 230.94 kB          |
| `ForecastChart-*.js` | 383.62 kB   | 383.63 kB          |
| eight route chunks   | —           | 0.99–13.44 kB each |

**The target was not reached, and it was not reachable.** Splitting every route moved
46.6 kB, because the pages are small and the weight is vendor code the _eager_ pages need
too. Measured by building with one chunk per npm package and reading what the entry
preloads:

| Package                                                                                                   | Raw      |
| --------------------------------------------------------------------------------------------------------- | -------- |
| `@supabase/*` (auth 102 + realtime 33 + phoenix 26 + storage 22 + postgrest 16 + client 11 + functions 3) | 213.8 kB |
| `react-dom`                                                                                               | 172.5 kB |
| `zod`                                                                                                     | 70.9 kB  |
| application code                                                                                          | 62.0 kB  |
| `@tanstack/query-core`                                                                                    | 38.7 kB  |
| `react-router`                                                                                            | 37.9 kB  |
| `sonner`                                                                                                  | 34.9 kB  |
| `tailwind-merge`                                                                                          | 27.1 kB  |
| `react-hook-form`                                                                                         | 26.5 kB  |
| `ts-fsrs`                                                                                                 | 21.6 kB  |
| `lucide-react`                                                                                            | 15.5 kB  |
| `radix-ui` (10 primitives)                                                                                | ~30 kB   |

The login screen needs `react-dom`, the Supabase client (to answer "is there a session?"
before anything renders), `zod` + `react-hook-form` (the form), `react-router`, and
`tailwind-merge`. That is a **~700 kB floor before a line of application code**, so 400 kB
raw was never available; it was set without measuring the vendor floor. The honest number
to watch is the gzip figure — 231 kB — and the honest lever is the dependency set, not the
route table.

Two specifics for whoever tries again:

- **`radix-ui` tree-shakes.** The meta-package import (`import { AlertDialog } from
'radix-ui'`) pulls only the ten primitives actually used; there are no chunks for
  accordion, tooltip, popover and the rest. Importing `@radix-ui/react-*` per package
  would change nothing. Do not do that refactor.
- **`ts-fsrs` is eager and should not be**, but not because of the routes. `src/lib/queries.ts`
  is one module imported by both eager and lazy pages, so everything it reaches — including
  `fsrs.ts` — lands in the eager chunk. The fix is a `queries/` directory with a barrel;
  it is worth ~22 kB of 781 kB, which is why it is in [POST-V1.md](POST-V1.md) (item 4)
  rather than done here.

### The E2E test was not written

Playwright is not a dependency, and the happy path it would cover — signup → generation →
review gate → practice — cannot currently run: generation is unconfigured on the project
(task 6, below) and there is no deployed URL. Adding a browser runner now would produce a
test that fails for reasons unrelated to the code, which is worse than not having it.
§10 marks it optional; this is the "say so, and say why" it asks for.

What replaced it, in the sense of catching the same class of failure: `routes.test.tsx`
asserts that every lazily imported page still resolves and still exports the component the
route names — reading the specifiers out of `routes.tsx` itself, so a rename cannot pass by
happening in two places at once.

### The demo account

`scripts/seed-demo.mjs`, run as `npm run demo:seed` (add `-- --reset` to rebuild). Four
decks — Photosynthesis, Postgres indexes, the Roman Republic, spaced repetition — generated
through the real Edge Function, accepted at the gate, then ~60 days of review history
replayed through `applyGrade`.

- **It signs in as the demo user with the publishable key and stays inside RLS.** No secret
  key, no `service_role`: every row it writes is a row the app could have written.
- **Credentials live in the owner's password manager**, and in `DEMO_EMAIL` /
  `DEMO_PASSWORD` in the shell when the script runs. Deliberately _not_ in `.env.example`,
  which is the contract for what Vercel needs.
- **Reset** is `npm run demo:seed -- --reset`, which deletes the account's decks (cascading
  to cards and reviews) and rebuilds. Without the flag the script refuses to touch an
  account that already has decks — a seeder that wipes whatever it is pointed at by default
  is one mistyped `DEMO_EMAIL` away from being a bad afternoon.
- The script is importable without running (`replayCard` is exported), and the replay was
  verified offline against the schema's constraints: 43 cards, 252 reviews, every studied
  day covered, a 21-day current streak, an 88.9% pass rate, and no violation of
  `cards_state_consistency`, the `stability > 0` / `difficulty 1..10` checks, or the
  `not null` columns on `reviews`.
- Two bugs that check caught, both worth knowing about if this is ever rewritten: day
  bucketing must be **calendar days**, not elapsed 24-hour periods (otherwise evening
  reviews fall a bucket early and land on days the demo user is supposed to have skipped),
  and session times drawn at random within an evening must be **clamped monotonic**, or a
  card's log goes backwards.

### Configuration a future session would otherwise rediscover

- **The Vercel SPA rewrite is not optional and fails deceptively.** `vercel.json` rewrites
  `/(.*)` to `/index.html`. Without it, `BrowserRouter` deep links 404 on hard refresh and
  on pasted links but work perfectly while clicking around — which reads as a routing bug
  in the app and is not one.
- **Cache headers:** `assets/*` immutable for a year (content-hashed), `index.html`
  `must-revalidate` (it names the current hashes). Getting that backwards pins visitors to
  a stale build.
- **Supabase Auth URL configuration is a third place to change on deploy.** Site URL and
  Redirect URLs must include `https://<domain>/auth/callback`, or the callback route this
  phase added never receives anything in production.
- **`/auth/callback` handles both flows.** The client's `flowType` is unset, so it is
  implicit: tokens arrive in the URL fragment and supabase-js has already consumed and
  stripped them by the time React mounts, which is why the page asks `getSession()` rather
  than parsing anything. The `?code=` (PKCE) branch is there so that turning PKCE on later
  is a one-line client change rather than a silent breakage. Errors arrive as
  `error` / `error_description` in either the query or the fragment, and are handed to
  `/login` through router state.
- **Only two variables reach Vercel.** `VITE_SUPABASE_URL` and
  `VITE_SUPABASE_PUBLISHABLE_KEY`, matching `.env.example`. `GROQ_API_KEY` is a Supabase
  function secret and belongs nowhere near the frontend project.

---

## What is done, and what is the owner's

Done in this phase, on `dev`:

- **1** `src/app/ErrorBoundary.tsx` — a class boundary with a `Try again` recovery card,
  placed inside `AppLayout` around `<Outlet />` and again in `providers.tsx` around
  everything. Resets on navigation.
- **2** `src/app/NotFoundPage.tsx`, and `src/components/PagePlaceholder.tsx` deleted.
- **3** `src/features/auth/AuthCallbackPage.tsx` and the `/auth/callback` route; failures
  land on `/login` with the reason shown.
- **4** Route code-splitting, measured above.
- **5** `vercel.json` (the config half).
- **7** `scripts/seed-demo.mjs` + `npm run demo:seed`, replay verified offline.
- **8** The README, rewritten as the product and the deploy runbook.
- **10** `ErrorBoundary.test.tsx` (4) and `routes.test.tsx` (2) — 305 tests, 21 files.
- **11** `docs/plans/POST-V1.md`, and the board in `docs/plans/README.md`.

**Owner-only, and still outstanding.** These are the ones that need credentials, and the
phase is not shippable without them:

- ~~**Task 6 — configure and deploy the Edge Function.**~~ **Done 2026-08-12, confirmed
  against the live project 2026-08-14.** `GROQ_API_KEY` and `GENERATION_MODEL` are set as
  function secrets, and `generate-cards` is deployed and `ACTIVE` (version 1,
  `verify_jwt: true`). This list said otherwise for two days because the work happened in the
  dashboard and the CLI, where no commit records it. **Task 7 is therefore unblocked.**
- **Task 5 (the account half) — connect the repository to Vercel** and set the two
  environment variables. The config file is committed; the account is not something a
  session can hold.

  **Blocked on a `git push` first.** As of 2026-08-14 local `dev` is 16 commits ahead of both
  `origin/dev` and `origin/main`, and `origin/dev` is still at P0 — so everything from the
  core loop to the landing page exists only on the owner's machine. Vercel builds from GitHub;
  connecting it before that push deploys the scaffold and looks like a broken product.

  The domain is settled: `synapsedeck.mukeremshifa.com`, DNS on Cloudflare, and the subdomain
  record must be **DNS-only (grey cloud)**. Proxying Cloudflare in front of Vercel stacks two
  CDNs and interferes with certificate issuance.

- **Supabase Auth URL configuration** — Site URL and Redirect URLs, per the section above.
- **Task 3's live verification.** `/auth/callback` is written and cannot be tested by the
  PGlite harness, which stubs only `auth.users`. Confirm a real signup email lands signed
  in.
- **Task 7 — run `npm run demo:seed`** once the function is deployed, and put the
  credentials in the README slot and the password manager.
- **Task 9 — the §10 budget on the deployed app.** Nothing here was measurable without a
  deployed URL and a seeded account: queue fetch p95, rating → next card, time to first
  card, and `/progress` over a real history. The seeder prints time-to-first-card for each
  deck as it runs, which is the §13 (1) number; the other three want the browser's
  performance panel against the real project. Record them here.
- **A screenshot for the README**, once there is a URL to take one from.
