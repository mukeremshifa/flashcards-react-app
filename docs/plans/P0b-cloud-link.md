# P0b — Link the Supabase cloud project ✅ complete

**Completed 2026-08-12.** Kept as the environment record rather than deleted — a future
rebuild should not have to rediscover any of this.

## Project

|          |                                                                               |
| -------- | ----------------------------------------------------------------------------- |
| Name     | `flashcards-react-app`                                                        |
| Ref      | `cnlnsaamiujselyuowzx`                                                        |
| Region   | `eu-west-1`                                                                   |
| Postgres | 17.6 (`postgres_engine: 17`)                                                  |
| Key mode | **Modern** — `sb_publishable_…` / `sb_secret_…`, not legacy anon/service_role |

## What was done

1. `supabase link --project-ref cnlnsaamiujselyuowzx` — no database password needed; the
   CLI provisions a temporary login role over the Management API.
2. `supabase db push --include-all` — both migrations applied.
3. `supabase gen types typescript --linked > src/types/database.ts` — 456 lines.
4. `src/lib/supabase.ts` switched to `createClient<Database>(…)`.
5. `.env.local` written with the project URL and publishable key (gitignored).
6. Verified live: all five tables readable-but-empty anonymously (RLS returning `[]`, not
   401 and not data), and an anonymous insert into `decks` rejected with Postgres `42501`
   _new row violates row-level security policy_.

## Gotchas worth remembering

- **The first `db push` timed out** connecting to `aws-1-eu-west-1.pooler.supabase.com:5432`
  with `LegacyDbConnectError`. A plain retry worked. Raw TCP to both 5432 and 6543 on the
  pooler is open from this machine, so it was the freshly-created login role not having
  propagated, not a firewall. Retry before debugging networking.
- **`db.<ref>.supabase.co:5432` is unreachable** from here — that host is IPv6-only on the
  free tier. Use the pooler (which is what the CLI does by default). Do not "fix" this by
  hunting for a direct connection string.
- **Docker warnings during `db push` are cosmetic.** `failed to cache migrations catalog:
… Docker Desktop is a prerequisite` only affects a local catalog cache. The migrations
  still applied; the schema was verified independently over REST.
- **`/rest/v1/` root returns 401 even with a valid publishable key.** That endpoint exposes
  schema introspection, which the `anon` role is not granted. It is not an auth failure —
  test a real table path instead, where a missing table gives `PGRST205` and a present one
  gives `[]`.
- **Postgres version differs between test and production:** PGlite runs 18, the project
  runs 17.6. Nothing in the current migrations is 18-only, but avoid 18-specific syntax, or
  the tests will pass locally and `db push` will fail.

## Key handling

`supabase projects api-keys --project-ref <ref>` lists all four keys. The CLI prints the
publishable key in full and **redacts the secret key**, which is the right default — v1
never uses a secret key.

- Publishable key → `.env.local` as `VITE_SUPABASE_PUBLISHABLE_KEY`. Safe in the browser;
  grants nothing by itself.
- Secret key → not used, not stored, not needed. `src/lib/env-schema.ts` rejects any client
  key beginning `sb_secret_`, and `src/lib/env-schema.test.ts` asserts that rejection.

## Left for P1

The `auth.users` → `profiles` trigger has **not** been exercised against the real `auth`
schema, because that needs a real signup. The PGlite harness proves the trigger fires
against a stubbed `auth.users`, which is not the same thing. First P1 auth task: sign up a
user and confirm exactly one `profiles` row appears with timezone `UTC`. If it does not,
check that `handle_new_user` is `security definer` and that the trigger exists on
`auth.users`.
