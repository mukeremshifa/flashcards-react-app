# Flashcards + LLM

Generate flashcards from your notes with an LLM, then review them with real spaced
repetition (FSRS) and progress tracking derived from an append-only review log.

**Current state: P2 complete.** Accounts, decks, cards of all three kinds, FSRS practice
with undo, and generation: paste text and cards stream in over SSE, are written as drafts,
and pass through a review gate before they enter a deck. `/progress` is still a
placeholder (P3). See [docs/SPEC.md](docs/SPEC.md) for the full specification and
[docs/plans/](docs/plans/) for per-phase execution plans.

One step is the owner's and is not done: the Edge Function needs a Groq key and a
deploy — see [Generation](#generation) below.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 + shadcn/ui · TanStack Query · Zod ·
react-router 7 · Supabase (Postgres + Auth + RLS + Edge Functions) · ts-fsrs · Vitest

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase URL + publishable key
npm run dev
```

The app throws a clear startup error if the environment variables are missing, rather
than failing later as an opaque 401.

## Scripts

| Script              | What it does                                                          |
| ------------------- | --------------------------------------------------------------------- |
| `npm run dev`       | Vite dev server                                                       |
| `npm run build`     | Typecheck (`tsc -b`) then production build                            |
| `npm run typecheck` | Types only                                                            |
| `npm run lint`      | ESLint                                                                |
| `npm test`          | Vitest — unit tests plus RLS/schema tests against in-process Postgres |
| `npm run db:push`   | Apply `supabase/migrations` to the linked project                     |
| `npm run db:types`  | Regenerate `src/types/database.ts` from the linked project            |
| `npm run fn:check`  | Typecheck the Edge Function with Deno (what `tsc` cannot see)         |
| `npm run fn:deploy` | Deploy `generate-cards` to the linked project                         |

## Tests without Docker

`npm test` runs the real files in `supabase/migrations` against
[PGlite](https://github.com/electric-sql/pglite) — Postgres compiled to WASM, in
process. That means schema constraints and every RLS policy are verified on every test
run with no container and no cloud project. The harness
([src/test/pg-harness.ts](src/test/pg-harness.ts)) stubs only Supabase's `auth` schema:
`auth.users` and an `auth.uid()` that reads the same JWT-subject setting the real one
does.

Because superusers bypass RLS, the harness switches to a non-superuser `authenticated`
role before asserting anything — otherwise the tests would pass no matter what the
policies said.

## Postgres versions must match

The Supabase project runs **Postgres 17**; `npm test` runs the migrations on PGlite, which
must therefore also be Postgres 17. If they drift, a migration can pass locally and fail on
`db push`.

- `supabase/pg-version.json` records the expected major — the single source of truth.
- `src/test/pg-version.test.ts` fails the suite if PGlite reports a different major.
- `npm run db:pg-version` compares that number against the live project.

The mapping, measured rather than assumed: **PGlite 0.4.x ships PG 17.5, PGlite 0.5.x ships
PG 18.3.** So `@electric-sql/pglite` is pinned to `^0.4.6` on purpose. Do not accept a
Dependabot bump to 0.5.x without upgrading the Supabase project first — the guard test will
catch it, and the fix is to align, never to edit the expected number.

## Database

Migrations are plain SQL in `supabase/migrations`, applied in filename order:

- `…_init_schema.sql` — enums, `profiles`, `decks`, `cards`, `reviews`, `generations`
- `…_rls.sql` — row level security; one owner-only policy set per table
- `…_review_card.sql` — the `review_card` and `undo_last_review` functions,
  `cards.learning_steps`, and the pre-review snapshot columns on `reviews`
- `…_revoke_anon_rpc.sql` — takes EXECUTE on those two functions away from `anon`,
  which Supabase's default privileges grant automatically to every new function

Two structural decisions worth knowing before you change anything:

1. **Content varies by card kind; scheduling state does not.** `cards.payload` is JSONB
   validated by Zod at the app boundary; the FSRS columns beside it are typed and never
   read `payload`. The scheduler therefore stays kind-agnostic.
2. **`reviews` is append-only by policy, not convention.** It has no DELETE policy at
   all, and the one UPDATE policy is narrowed by a trigger to a single column —
   `undone_at`, the tombstone that undo sets. Nothing else about a logged review can be
   changed by anyone, including its owner. It is the source of truth for scheduling,
   undo, and every progress metric.
3. **A rating is one RPC, never two writes from the browser.** `review_card` locks the
   card, appends the log row, and reschedules the card in one transaction, and refuses
   the write if the card moved since the client loaded it. Half of a rating is worse
   than none, because it corrupts a schedule silently.

## Generation

`supabase/functions/generate-cards` is the only Edge Function. It authenticates the
caller's JWT, checks quota, streams NDJSON from Groq, validates each line with the _same_
Zod schemas the browser uses, writes each card as a `draft` row, and re-emits it as an SSE
frame. The pipeline is SPEC §7; the client half is `src/features/generate/`.

**Shared code, not copied code.** `supabase/functions/_shared/*.ts` re-exports
`src/lib/schemas.ts`, `ndjson.ts`, `sse.ts`, `quota.ts`, `generate.ts` and `fsrs.ts` by
relative path. Deno needs the `.ts` extension on those imports, which is why
`tsconfig.app.json` sets `allowImportingTsExtensions` — Vite resolves both forms, Deno only
one. `npm test` therefore covers the parser and the policy the _function_ runs, not a
sibling of it.

To bring it up on a fresh project:

```bash
npx supabase secrets set GROQ_API_KEY=gsk_...            # from console.groq.com
npx supabase secrets set GENERATION_MODEL=llama-3.3-70b-versatile
npm run fn:check                                          # Deno typecheck
npm run fn:deploy                                         # deploys with --use-api
```

`--use-api` is not optional: it is the supported way to bundle a function that imports
files from outside `supabase/`, which this one does by design. Without the secrets the
function answers 503 with a readable message rather than failing obscurely, and
`GENERATION_ENABLED=false` turns the feature off without a deploy.

## Keys and secrets

This project uses Supabase's **modern key system** — `sb_publishable_…` and
`sb_secret_…` — not the legacy `anon` / `service_role` JWTs, which Supabase deprecates at
the end of 2026.

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are client-side. The
publishable key is meant to be public: it grants nothing on its own, because requests run
as the `anon` or `authenticated` Postgres role and RLS decides what they can see.

The **secret key is never used anywhere in v1.** It maps to `service_role`, which holds
`BYPASSRLS`, so a single copy of it in a client bundle would expose every user's data to
anyone who reads the shipped JavaScript. `src/lib/env-schema.ts` refuses to start the app
if it finds one, and that refusal is covered by tests.

The generation provider key is likewise not a client value — it is set as an Edge Function
secret (`supabase secrets set GROQ_API_KEY=…`) and never reaches the browser. The Edge
Function builds its Supabase client from the publishable key plus the caller's
`Authorization` header, and refuses to start if it is handed a secret key, for the same
reason the browser does.
