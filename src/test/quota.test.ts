// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pg-harness';
import {
  countsTowardQuota,
  GENERATION_QUOTA,
  monthWindow,
  staleRunningBefore,
} from '@/lib/quota';

/**
 * Quota, against a real Postgres.
 *
 * `src/lib/quota.test.ts` covers the arithmetic. What is only provable here is
 * that the rows the arithmetic reads can actually exist and can actually be
 * written: that a refused generation is insertable under RLS by the user it
 * refused, and that counting "this month's generations" from the table agrees
 * with `countsTowardQuota` row for row. A quota that cannot be audited after the
 * fact is not a quota (SPEC §5.5).
 */

let db: TestDb;
let user: string;

const NOW = new Date('2026-08-12T10:00:00.000Z');

/** The same predicate as `quotaCountFilter`, in SQL. */
const COUNT_SQL = `
  select count(*)::int as count
  from generations
  where created_at >= $1 and created_at < $2
    and (cards_returned > 0 or (status = 'running' and created_at >= $3))
`;

async function countThisMonth(now: Date): Promise<number> {
  const month = monthWindow(now);
  const result = await db.raw.query<{ count: number }>(COUNT_SQL, [
    month.start.toISOString(),
    month.end.toISOString(),
    staleRunningBefore(now).toISOString(),
  ]);
  return result.rows[0]?.count ?? 0;
}

type Row = {
  status: string;
  cards_returned?: number;
  created_at?: string;
  deck_id?: string | null;
  error?: string | null;
};

async function insertGeneration(row: Row): Promise<void> {
  await db.raw.query(
    `insert into generations
       (user_id, deck_id, source, model, prompt_version, input_chars, cards_requested,
        cards_returned, status, error, created_at)
     values ($1, $2, 'text', 'test-model', 'cards.v1', 2000, 20, $3, $4, $5, $6)`,
    [
      user,
      row.deck_id ?? null,
      row.cards_returned ?? 0,
      row.status,
      row.error ?? null,
      row.created_at ?? NOW.toISOString(),
    ],
  );
}

beforeAll(async () => {
  db = await createTestDb();
  user = await db.createUser('quota@example.com');
  await db.actAs(user);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('a refused generation', () => {
  it('is written by the user it was refused for', async () => {
    // The Edge Function runs as the caller, so the refusal row is inserted under
    // the same policy as everything else. If RLS rejected it, refusals would go
    // unrecorded and the quota could never be explained to the person it hit.
    await insertGeneration({ status: 'refused', error: 'quota_exceeded' });

    const rows = await db.raw.query<{ status: string; error: string }>(
      "select status, error from generations where status = 'refused'",
    );
    expect(rows.rows).toEqual([{ status: 'refused', error: 'quota_exceeded' }]);
  });

  it('does not itself consume an allowance', async () => {
    // Otherwise the first refusal makes every later request refuse too, and the
    // user is locked out of the feature until the month turns over.
    expect(await countThisMonth(NOW)).toBe(0);
  });

  it('carries no deck, which is what marks it as never dispatched', async () => {
    const rows = await db.raw.query<{ deck_id: string | null }>(
      "select deck_id from generations where status = 'refused'",
    );
    expect(rows.rows[0]?.deck_id).toBeNull();
  });
});

describe('counting the month', () => {
  it('agrees with the shared predicate, row for row', async () => {
    const abandoned = new Date(
      NOW.getTime() - (GENERATION_QUOTA.staleRunningMinutes + 1) * 60_000,
    ).toISOString();
    const lastMonth = new Date('2026-07-31T23:59:59.000Z').toISOString();

    const rows: Row[] = [
      { status: 'succeeded', cards_returned: 20 },
      { status: 'succeeded', cards_returned: 3 },
      { status: 'failed', cards_returned: 0, error: 'provider_429' },
      { status: 'failed', cards_returned: 11, error: 'client_disconnected' },
      { status: 'running', cards_returned: 0 },
      { status: 'running', cards_returned: 0, created_at: abandoned },
      { status: 'succeeded', cards_returned: 20, created_at: lastMonth },
    ];
    for (const row of rows) await insertGeneration(row);

    const month = monthWindow(NOW);
    const expected = rows.filter(row => {
      const createdAt = row.created_at ?? NOW.toISOString();
      const inThisMonth =
        createdAt >= month.start.toISOString() && createdAt < month.end.toISOString();
      return (
        inThisMonth &&
        countsTowardQuota(
          {
            status: row.status,
            cards_returned: row.cards_returned ?? 0,
            created_at: createdAt,
          },
          NOW,
        )
      );
    });
    // succeeded ×2, the disconnect that still produced cards, and the live
    // running row — not the 429, not the crashed worker, not last month's.
    expect(expected).toHaveLength(4);

    // The refusal from the previous describe block is still in the table, which
    // is the point: it exists, and it still does not count.
    expect(await countThisMonth(NOW)).toBe(expected.length);
  });

  it('leaves last month out of this month', async () => {
    const july = await countThisMonth(new Date('2026-07-15T00:00:00.000Z'));
    expect(july).toBe(1);
  });
});
