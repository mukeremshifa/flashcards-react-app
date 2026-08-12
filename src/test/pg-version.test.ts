// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import pgVersion from '../../supabase/pg-version.json';

/**
 * Guards the one way this test suite can lie to you: if PGlite runs a different
 * Postgres major than the Supabase project, migrations can pass here and fail on
 * `db push` (or, worse, pass in both places while behaving differently).
 *
 * Known mapping, measured rather than assumed:
 *   PGlite 0.4.x -> PG 17.5
 *   PGlite 0.5.x -> PG 18.3
 *
 * If this test fails, do not "fix" it by editing the expected major. Either pin
 * PGlite back to the line matching production, or upgrade the Supabase project
 * first and then update supabase/pg-version.json.
 */
describe('postgres version alignment', () => {
  it(`runs Postgres ${pgVersion.expectedMajor} to match the Supabase project`, async () => {
    const db = await PGlite.create();
    try {
      const result = await db.query<{ server_version: string }>('show server_version');
      const reported = result.rows[0]?.server_version ?? '';
      const major = Number.parseInt(reported.split('.')[0] ?? '', 10);

      expect(
        major,
        `PGlite reports PG ${reported}, but supabase/pg-version.json expects major ` +
          `${pgVersion.expectedMajor}. Run "npm run db:pg-version" to see what the ` +
          `Supabase project is actually running before changing anything.`,
      ).toBe(pgVersion.expectedMajor);
    } finally {
      await db.close();
    }
  });
});
