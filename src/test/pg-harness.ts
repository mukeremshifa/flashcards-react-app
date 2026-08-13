import { readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';

/**
 * Runs the real supabase/migrations against an in-process Postgres (PGlite), so
 * schema and RLS regressions are caught without Docker or a cloud project.
 *
 * What is faithful: the migration SQL itself, every constraint, and RLS policy
 * evaluation against a non-superuser `authenticated` role.
 *
 * What is stubbed: Supabase's `auth` schema. Only `auth.users` and `auth.uid()`
 * exist here, and `auth.uid()` reads the same `request.jwt.claim.sub` GUC that
 * Supabase's real implementation reads. That means these tests prove the policies
 * are correct, not that Supabase issues the JWT claim we expect — the latter is
 * covered once P0b applies the migrations to a real project.
 */

const here = dirname(fileURLToPath(import.meta.url));
const migrationsDir = join(here, '..', '..', 'supabase', 'migrations');

function migrationFiles(): string[] {
  return readdirSync(migrationsDir)
    .filter(name => name.endsWith('.sql'))
    .sort(); // timestamp-prefixed, so lexical order is apply order
}

const AUTH_STUB = `
  create schema if not exists auth;

  create table auth.users (
    id uuid primary key default gen_random_uuid(),
    email text unique,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now()
  );

  -- Mirrors Supabase's auth.uid(): reads the JWT subject from a session setting.
  create or replace function auth.uid() returns uuid
  language sql stable
  as $fn$
    select nullif(
      coalesce(
        current_setting('request.jwt.claim.sub', true),
        current_setting('request.jwt.claims', true)::jsonb ->> 'sub'
      ),
      ''
    )::uuid
  $fn$;

  -- Supabase's two request roles. anon exists here so that migrations adjusting
  -- its privileges are actually exercised rather than silently skipped.
  create role anon;
  create role authenticated;
  grant usage on schema public, auth to anon, authenticated;

  -- Supabase applies this to every project, and it is the reason a migration has
  -- to revoke from anon explicitly: without it here, such a revoke would be a
  -- no-op locally and the test asserting it would pass no matter what.
  alter default privileges in schema public grant all on functions to anon, authenticated;
`;

export type TestDb = Awaited<ReturnType<typeof createTestDb>>;

export async function createTestDb() {
  const db = await PGlite.create();

  await db.exec(AUTH_STUB);

  for (const file of migrationFiles()) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await db.exec(sql);
    } catch (error) {
      throw new Error(`migration ${file} failed: ${(error as Error).message}`);
    }
  }

  // Supabase grants these to `authenticated` by default; RLS is what actually
  // restricts rows. Granting table-wide privileges here makes the test setup
  // match production, where a permissive grant + strict policy is the model.
  await db.exec(`
    grant select, insert, update, delete on all tables in schema public to authenticated;
    grant usage, select on all sequences in schema public to authenticated;
  `);

  return {
    raw: db,

    /** Create an auth user (as superuser) and return its id. */
    async createUser(email: string): Promise<string> {
      await db.exec('reset role');
      const result = await db.query<{ id: string }>(
        'insert into auth.users (email) values ($1) returning id',
        [email],
      );
      const id = result.rows[0]?.id;
      if (!id) throw new Error(`failed to create user ${email}`);
      return id;
    },

    /**
     * Become `userId` for subsequent queries: a non-superuser role (so RLS is
     * enforced) with the JWT subject set. Superusers bypass RLS entirely, which
     * is why `set role` is not optional here.
     */
    async actAs(userId: string): Promise<void> {
      await db.exec('reset role');
      await db.query('select set_config($1, $2, false)', [
        'request.jwt.claim.sub',
        userId,
      ]);
      await db.exec('set role authenticated');
    },

    /** Become a signed-out visitor: the `anon` role, with no JWT subject. */
    async actAsAnon(): Promise<void> {
      await db.exec('reset role');
      await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', '']);
      await db.exec('set role anon');
    },

    /** Drop back to superuser for fixture setup. */
    async actAsAdmin(): Promise<void> {
      await db.exec('reset role');
      await db.query('select set_config($1, $2, false)', ['request.jwt.claim.sub', '']);
    },

    async close(): Promise<void> {
      await db.close();
    },
  };
}
