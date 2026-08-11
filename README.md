# Flashcards + LLM

Generate flashcards from your notes with an LLM, then review them with real spaced
repetition (FSRS) and progress tracking derived from an append-only review log.

**Current state: P0 complete.** The scaffold, schema, and RLS policies exist and are
tested; the app itself is route placeholders. See [docs/SPEC.md](docs/SPEC.md) for the
full specification and [docs/plans/](docs/plans/) for per-phase execution plans.

## Stack

React 19 · TypeScript · Vite · Tailwind v4 + shadcn/ui · TanStack Query · Zod ·
react-router 7 · Supabase (Postgres + Auth + RLS + Edge Functions) · ts-fsrs · Vitest

## Getting started

```bash
npm install
cp .env.example .env.local     # then fill in your Supabase URL + anon key
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

## Database

Migrations are plain SQL in `supabase/migrations`, applied in filename order:

- `…_init_schema.sql` — enums, `profiles`, `decks`, `cards`, `reviews`, `generations`
- `…_rls.sql` — row level security; one owner-only policy set per table

Two structural decisions worth knowing before you change anything:

1. **Content varies by card kind; scheduling state does not.** `cards.payload` is JSONB
   validated by Zod at the app boundary; the FSRS columns beside it are typed and never
   read `payload`. The scheduler therefore stays kind-agnostic.
2. **`reviews` is append-only by policy, not convention.** It has SELECT and INSERT
   policies and no others, so no update or delete is possible for anyone. It is the
   source of truth for scheduling, undo, and every progress metric.

## Secrets

Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` are client-side. The anon key is
not a secret — the RLS policies are the security boundary. The generation provider key
is set as an Edge Function secret and never reaches the browser.
