# Project rules

Read this before doing anything in this repo.

## Git — hard constraints

**Work on `dev`. Commit to `dev`. Nothing else.**

| Action                                      | Who               |
| ------------------------------------------- | ----------------- |
| Commit to `dev`                             | ✅ Claude         |
| Create a topic branch off `dev` when asked  | ✅ Claude         |
| `git merge` (any direction)                 | ❌ **Owner only** |
| `git push` (any remote, any branch)         | ❌ **Owner only** |
| Anything touching `main`                    | ❌ **Owner only** |
| `git rebase`, force-push, history rewriting | ❌ **Owner only** |
| Opening PRs                                 | ❌ **Owner only** |

This is not a preference to weigh against convenience — it is a standing constraint for
every session in this project. If a task seems to need a merge or a push, **stop and say
so** rather than doing it. Commit the work to `dev` and describe what remains.

Do not offer to merge or push. Do not ask "shall I merge this?". The owner does that.

**`supabase db push` is not a git push and is not covered by any of the above.** See below.

## Documentation

- `docs/SPEC.md` — what the product is, and why each decision was made. The source of
  truth for scope. Update it when a decision changes; do not let code and spec drift.
- `docs/plans/` — one execution plan per phase. `docs/plans/README.md` holds the board and
  the convention. Only the next phase gets a detailed plan; the last task of every plan is
  to write the next one.

Respect the phase boundaries. If something belongs to a later phase, it goes in that
phase's plan, not into the current commit — even when it would take five minutes now.

## Database

- Migrations are plain SQL in `supabase/migrations`, applied in filename order. Never edit
  a migration that has been pushed; add a new one.
- **`npm run db:push` is allowed, and expected, when a plan's work needs it.** A phase that
  writes a migration is not finished while the schema only exists on disk: the types cannot
  be regenerated, so `src/types/database.ts` has to be hand-written, and every later session
  inherits that drift. Applying it is part of the work, not a deployment.

  Push it, then immediately `npm run db:types` and commit the regenerated file. Check the
  result: Postgres cannot express argument nullability, so a function parameter that accepts
  null is generated as non-null — cast at the call site and say why, rather than inventing a
  value. Run `npm run db:pg-version` afterwards if anything about the environment changed.

  What is still the owner's alone: `git push`, `git merge`, PRs, anything touching `main` or
  a remote. Those are about the shared repository. The database is this project's own
  schema, and `npm test` has already verified the migration against PGlite before it goes.

  Two things to do first, every time: `npx supabase db push --linked --dry-run` and read
  what it lists — if it names a migration you did not write, stop and ask. And never push a
  migration whose tests have not run.
- Destructive database operations are **not** covered by that. `supabase db reset`, dropping
  a table, deleting rows in the live project: ask first, every time.
- `npm test` runs those migrations against PGlite (Postgres in WASM), so schema and RLS
  changes are verifiable with no Docker and no cloud round-trip.
- **Postgres majors must match between tests and production.** `supabase/pg-version.json`
  records the expected major; `src/test/pg-version.test.ts` enforces it, and
  `npm run db:pg-version` compares it against the live project. PGlite 0.4.x ships PG 17,
  0.5.x ships PG 18 — bumping across that line silently breaks the guarantee that a
  passing test means a working migration.
- RLS is the entire security boundary. Every table gets an owner-only policy set plus
  `force row level security`. A new table without RLS is a bug, not a TODO.

## Keys

- Modern Supabase key mode only: `sb_publishable_…` client-side, never `sb_secret_…`.
  The legacy `anon` / `service_role` JWTs are not used.
- The secret key maps to `service_role` (`BYPASSRLS`) and must never appear in client env,
  the repo, or a build. `src/lib/env-schema.ts` refuses to boot if it finds one; that
  refusal is tested. Do not weaken it.
- Provider API keys (e.g. Groq) live only as Edge Function secrets.

## Code

- TypeScript, strict, with `noUncheckedIndexedAccess`.
- Card content is untrusted LLM output: render it as text. `dangerouslySetInnerHTML` is
  blocked by an ESLint rule — do not disable it.
- One Zod definition per concept, in `src/lib/schemas.ts`, shared by client and Edge
  Function. Do not redefine a card shape anywhere else.
- Before saying work is done: `npm run typecheck && npm run lint && npm test && npm run build`.
