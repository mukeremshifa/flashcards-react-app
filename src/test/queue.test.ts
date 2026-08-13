// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pg-harness';
import { seedCard, seedDeck } from './fixtures';
import { startOfStudyDay } from '@/lib/day';

/**
 * The queue as the database sees it.
 *
 * src/lib/queue.test.ts covers the interleaving policy; this file covers the
 * three reads that feed it — that the due stream and the new stream do not
 * overlap, that "introduced today" counts the right rows, and that the whole
 * thing stays fast on a deck big enough to matter (SPEC §10: under 300ms).
 */

const QUEUE_FETCH_LIMIT = 400;
const DECK_SIZE = 2_000;

let db: TestDb;
let alice: string;
let bob: string;
let deck: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.createUser('alice@example.com');
  bob = await db.createUser('bob@example.com');
  deck = await seedDeck(db, alice, 'Big deck');

  await db.actAs(alice);
  // 2,000 cards: 400 unseen, 400 overdue reviews, 1,200 scheduled ahead. The
  // mix matters — an all-due deck would let any plan look fast.
  await db.raw.query(
    `insert into cards (
       user_id, deck_id, kind, payload, status, fsrs_state,
       stability, difficulty, due, last_review, reps, scheduled_days, elapsed_days
     )
     select
       $1, $2, 'basic',
       jsonb_build_object('kind', 'basic', 'front', 'Front ' || i, 'back', 'Back ' || i),
       'active',
       (case when i % 5 = 0 then 'new' else 'review' end)::public.fsrs_state,
       (case when i % 5 = 0 then null else 10.0 end),
       (case when i % 5 = 0 then null else 5.0 end),
       (case
          when i % 5 = 0 then now()
          when i % 5 = 1 then now() - make_interval(mins => i % 500)
          else now() + make_interval(days => (i % 30) + 1)
        end),
       (case when i % 5 = 0 then null else now() - make_interval(days => 10) end),
       (case when i % 5 = 0 then 0 else 3 end),
       (case when i % 5 = 0 then 0 else 10 end),
       (case when i % 5 = 0 then 0 else 10 end)
     from generate_series(1, ${DECK_SIZE}) as i`,
    [alice, deck],
  );

  await db.actAsAdmin();
  await db.raw.exec('analyze public.cards; analyze public.reviews;');
}, 120_000);

afterAll(async () => {
  await db?.close();
});

/** The due-review read from usePracticeQueue, verbatim in SQL terms. */
const DUE_QUERY = `
  select id from public.cards
  where status = 'active' and fsrs_state <> 'new' and due <= now()
  order by due asc
  limit ${QUEUE_FETCH_LIMIT}`;

const NEW_QUERY = `
  select id from public.cards
  where status = 'active' and fsrs_state = 'new'
  order by created_at asc
  limit 20`;

describe('the two streams', () => {
  it('does not serve a new card as a due review', async () => {
    // A new card's `due` is its creation time, so it satisfies `due <= now()`.
    // Without the fsrs_state filter it would appear in both streams — shown
    // twice, and slipping past the daily cap on the way.
    await db.actAs(alice);
    const due = await db.raw.query<{ id: string }>(DUE_QUERY);
    const fresh = await db.raw.query<{ id: string }>(NEW_QUERY);

    const freshIds = new Set(fresh.rows.map(row => row.id));
    expect(due.rows.some(row => freshIds.has(row.id))).toBe(false);
    expect(fresh.rows).toHaveLength(20);
  });

  it('returns due reviews oldest first', async () => {
    await db.actAs(alice);
    const rows = await db.raw.query<{ due: string }>(`
      select due::text as due from public.cards
      where status = 'active' and fsrs_state <> 'new' and due <= now()
      order by due asc limit 50`);
    const times = rows.rows.map(row => new Date(row.due).getTime());
    expect(times).toEqual([...times].sort((a, b) => a - b));
  });

  it('leaves suspended cards out of both streams', async () => {
    const suspended = await seedCard(db, alice, deck, {
      status: 'suspended',
      front: 'suspended card',
    });
    await db.actAs(alice);

    const due = await db.raw.query<{ id: string }>(DUE_QUERY);
    const fresh = await db.raw.query<{ id: string }>(NEW_QUERY);
    expect([...due.rows, ...fresh.rows].some(row => row.id === suspended)).toBe(false);
  });

  it("shows Bob none of Alice's queue", async () => {
    await db.actAs(bob);
    const due = await db.raw.query(DUE_QUERY);
    const fresh = await db.raw.query(NEW_QUERY);
    expect(due.rows).toEqual([]);
    expect(fresh.rows).toEqual([]);
  });
});

describe('counting today’s introductions', () => {
  const countIntroduced = async (since: Date) => {
    const result = await db.raw.query<{ count: string }>(
      `select count(*)::text as count from public.reviews
       where state_before = 'new' and undone_at is null and reviewed_at >= $1`,
      [since.toISOString()],
    );
    return Number(result.rows[0]!.count);
  };

  it('counts only new-card introductions inside the study day', async () => {
    await db.actAs(alice);
    const card = await seedCard(db, alice, deck, { front: 'counted card' });
    await db.actAs(alice);
    const dayStart = startOfStudyDay(new Date(), 'UTC');

    const before = await countIntroduced(dayStart);

    // An introduction: state_before = 'new'.
    await db.raw.query(
      `insert into public.reviews (user_id, card_id, rating, state_before, elapsed_days,
                                   scheduled_days, due_before, state_after, stability_after,
                                   difficulty_after)
       values ($1, $2, 3, 'new', 0, 0, now(), 'learning', 1.2, 5.0)`,
      [alice, card],
    );
    expect(await countIntroduced(dayStart)).toBe(before + 1);

    // A repeat review of an already-known card is not an introduction.
    await db.raw.query(
      `insert into public.reviews (user_id, card_id, rating, state_before, elapsed_days,
                                   scheduled_days, due_before, state_after, stability_after,
                                   difficulty_after)
       values ($1, $2, 3, 'review', 3, 3, now(), 'review', 9.0, 5.0)`,
      [alice, card],
    );
    expect(await countIntroduced(dayStart)).toBe(before + 1);
  });

  it('stops counting an introduction that was undone', async () => {
    // Undoing the first rating of a new card should hand the slot back — the
    // user has not actually started learning it.
    await db.actAs(alice);
    const card = await seedCard(db, alice, deck, { front: 'undone card' });
    await db.actAs(alice);
    const dayStart = startOfStudyDay(new Date(), 'UTC');
    const before = await countIntroduced(dayStart);

    const inserted = await db.raw.query<{ id: string }>(
      `insert into public.reviews (user_id, card_id, rating, state_before, elapsed_days,
                                   scheduled_days, due_before, state_after, stability_after,
                                   difficulty_after)
       values ($1, $2, 1, 'new', 0, 0, now(), 'learning', 0.5, 7.0)
       returning id`,
      [alice, card],
    );
    expect(await countIntroduced(dayStart)).toBe(before + 1);

    await db.raw.query('update public.reviews set undone_at = now() where id = $1', [
      inserted.rows[0]!.id,
    ]);
    expect(await countIntroduced(dayStart)).toBe(before);
  });

  it('ignores reviews from before the 04:00 boundary', async () => {
    await db.actAs(alice);
    const card = await seedCard(db, alice, deck, { front: 'yesterday card' });
    await db.actAs(alice);
    const dayStart = startOfStudyDay(new Date(), 'UTC');
    const before = await countIntroduced(dayStart);

    await db.raw.query(
      `insert into public.reviews (user_id, card_id, rating, reviewed_at, state_before,
                                   elapsed_days, scheduled_days, due_before, state_after,
                                   stability_after, difficulty_after)
       values ($1, $2, 3, $3::timestamptz - interval '1 second', 'new', 0, 0, now(),
               'learning', 1.2, 5.0)`,
      [alice, card, dayStart.toISOString()],
    );
    expect(await countIntroduced(dayStart)).toBe(before);
  });
});

describe('performance on a real-sized deck', () => {
  it('uses the partial index rather than scanning the table', async () => {
    // The timing assertion below is the one that can wobble on a busy machine;
    // this one cannot. If the plan degrades to a sequential scan, the budget is
    // gone whatever the clock says today.
    await db.actAs(alice);
    const plan = await db.raw.query<{ 'QUERY PLAN': string }>(
      `explain (costs off) ${DUE_QUERY}`,
    );
    const text = plan.rows.map(row => row['QUERY PLAN']).join('\n');
    expect(text).toMatch(/cards_(queue|deck_due)_idx/);
    expect(text).not.toMatch(/Seq Scan on cards/);
  });

  it(`answers the whole queue fetch under 300ms across ${DECK_SIZE} cards`, async () => {
    await db.actAs(alice);
    const dayStart = startOfStudyDay(new Date(), 'UTC');

    // Warm the caches the way a second page load would.
    await Promise.all([db.raw.query(DUE_QUERY), db.raw.query(NEW_QUERY)]);

    const started = performance.now();
    await Promise.all([
      db.raw.query(DUE_QUERY),
      db.raw.query(NEW_QUERY),
      db.raw.query(
        `select count(*) from public.reviews
         where state_before = 'new' and undone_at is null and reviewed_at >= $1`,
        [dayStart.toISOString()],
      ),
    ]);
    const elapsed = performance.now() - started;

    // PGlite is Postgres compiled to WebAssembly — slower than the real server
    // this budget is written for, so passing here is the pessimistic case.
    expect(elapsed).toBeLessThan(300);
  });
});
