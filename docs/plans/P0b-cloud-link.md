# P0b — Link the Supabase cloud project

**Status:** blocked on credentials. Everything here needs a real Supabase project, which
needs a human to click through a signup.

**Why this is a separate phase:** there is no Docker on this machine, so `supabase start`
(the local stack) cannot run. The schema is nonetheless _verified_ — `npm test` executes
the real migration files against PGlite — so the only thing missing is a live database to
point the app at.

**`npm run dev` works right now without credentials** — but only because nothing imports
`src/lib/supabase.ts` yet, so the env validation in `src/lib/env.ts` never runs. The first
P1 task that touches the database makes `.env.local` mandatory, and the failure will be a
clear thrown message at startup rather than a mystery 401. Do not "fix" that throw by
making the env optional; the loud failure is the feature.

## What the owner needs to do

1. Create a free project at <https://supabase.com/dashboard> (any region near you).
2. From **Settings → API**, copy the Project URL and the `anon` public key.
3. From **Settings → General**, copy the Project ref (the `abcdefgh…` slug).
4. Paste the two API values into `.env.local`:

   ```bash
   cp .env.example .env.local
   # then fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
   ```

5. Hand over the **project ref** (not a password) so the CLI can link, or run the link
   step yourself:

   ```bash
   npx supabase login          # opens a browser
   npx supabase link --project-ref <your-project-ref>
   ```

The anon key is safe to share and safe to ship to the browser — RLS is the security
boundary, not the key. Do **not** paste the `service_role` key anywhere; v1 never uses it.

## Tasks

1. **Apply the migrations.**

   ```bash
   npm run db:push
   ```

   Expect two migrations to apply cleanly. They have already been executed against
   Postgres 18 via PGlite, so a failure here means an environment difference (extensions,
   the real `auth` schema), not bad SQL — read the error rather than editing the migration
   blind.

2. **Verify the trigger against the real `auth` schema.** The PGlite harness stubs
   `auth.users`, so this is the one thing local tests cannot prove. Sign up a throwaway
   user in the dashboard (**Authentication → Users → Add user**) and confirm a matching
   `profiles` row appears. If it does not, `handle_new_user` is not firing — check that the
   trigger exists on `auth.users` and that the function is `security definer`.

3. **Generate types.**

   ```bash
   npm run db:types
   ```

   Writes `src/types/database.ts`.

4. **Type the client.** In `src/lib/supabase.ts`, replace the untyped `createClient(...)`
   with `createClient<Database>(...)` and delete the `TODO(P0b)` comment. Run
   `npm run typecheck` — it should still pass, because nothing consumes the client yet.

5. **Confirm the browser can reach it.** `npm run dev`, open the app, check the console for
   no startup env error and no failed request on load.

## Acceptance criteria

- `npm run db:push` applies both migrations to the linked project.
- Adding a user in the dashboard creates exactly one `profiles` row, timezone `UTC`.
- `src/types/database.ts` exists and includes `decks`, `cards`, `reviews`, `generations`,
  `profiles`.
- `npm run typecheck` and `npm test` both pass with the typed client in place.
- `.env.local` is present and **not** tracked by git (`git status` must not list it).

## Decisions to record

- Note the Supabase region and project ref in this file once linked, so a future
  environment rebuild does not have to guess.
