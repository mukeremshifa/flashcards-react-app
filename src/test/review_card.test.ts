// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pg-harness';
import { readCard, reviewCard, schedulingOf, seedCard, seedDeck } from './fixtures';
import { applyGrade } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';

/**
 * SPEC §6: one rating is one transaction. These tests are about the failures a
 * partial write causes — a review logged but never applied, a card rescheduled
 * twice from two tabs — none of which are visible in the UI when they happen.
 */

let db: TestDb;
let alice: string;
let bob: string;
let aliceDeck: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.createUser('alice@example.com');
  bob = await db.createUser('bob@example.com');
  aliceDeck = await seedDeck(db, alice);
}, 60_000);

afterAll(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.actAs(alice);
});

/** Grade a card through the wrapper the app uses, then through the RPC. */
async function rate(cardId: string, grade: Grade, now = new Date()) {
  const before = await readCard(db, cardId);
  const { next, log } = applyGrade(schedulingOf(before), grade, now, {
    durationMs: 2400,
  });
  const after = await reviewCard(db, {
    cardId,
    rating: grade,
    durationMs: 2400,
    expectedUpdatedAt: before.updated_at,
    next,
  });
  return { before, after, next, log };
}

describe('happy path', () => {
  it('writes the log row and the card update, and they agree', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const { before, after, next } = await rate(cardId, Grade.Good);

    // The card carries exactly what the scheduler decided.
    expect(after.fsrs_state).toBe(next.fsrs_state);
    expect(after.stability).toBeCloseTo(next.stability, 10);
    expect(after.difficulty).toBeCloseTo(next.difficulty, 10);
    expect(new Date(after.due).toISOString()).toBe(next.due);
    expect(after.scheduled_days).toBe(next.scheduled_days);
    expect(after.elapsed_days).toBe(next.elapsed_days);
    expect(after.learning_steps).toBe(next.learning_steps);
    expect(after.reps).toBe(1);
    expect(after.lapses).toBe(0);

    const log = await db.raw.query<{
      rating: number;
      duration_ms: number;
      state_before: string;
      stability_before: number | null;
      difficulty_before: number | null;
      due_before: string;
      last_review_before: string | null;
      elapsed_days: number;
      elapsed_days_before: number;
      scheduled_days: number;
      learning_steps_before: number;
      state_after: string;
      stability_after: number;
      difficulty_after: number;
      undone_at: string | null;
    }>(
      `select rating, duration_ms, state_before, stability_before, difficulty_before,
              due_before::text as due_before, last_review_before::text as last_review_before,
              elapsed_days, elapsed_days_before, scheduled_days, learning_steps_before,
              state_after, stability_after, difficulty_after, undone_at
       from reviews where card_id = $1`,
      [cardId],
    );
    expect(log.rows).toHaveLength(1);
    const row = log.rows[0]!;

    // Before-state comes from the locked card row, not from the client payload.
    expect(row.state_before).toBe(before.fsrs_state);
    expect(row.stability_before).toBe(before.stability);
    expect(row.difficulty_before).toBe(before.difficulty);
    expect(new Date(row.due_before).toISOString()).toBe(
      new Date(before.due).toISOString(),
    );
    expect(row.last_review_before).toBe(before.last_review);
    expect(row.elapsed_days_before).toBe(before.elapsed_days);
    expect(row.learning_steps_before).toBe(before.learning_steps);
    expect(row.scheduled_days).toBe(before.scheduled_days);

    // After-state matches what landed on the card. If these two ever disagree,
    // the schedule and its own history are telling different stories.
    expect(row.state_after).toBe(after.fsrs_state);
    expect(row.stability_after).toBeCloseTo(after.stability!, 10);
    expect(row.difficulty_after).toBeCloseTo(after.difficulty!, 10);
    expect(row.elapsed_days).toBe(after.elapsed_days);
    expect(row.rating).toBe(Grade.Good);
    expect(row.duration_ms).toBe(2400);
    expect(row.undone_at).toBeNull();
  });

  it('moves the card out of the due queue', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const { after } = await rate(cardId, Grade.Good);
    expect(new Date(after.due).getTime()).toBeGreaterThan(Date.now());
  });

  it('accepts a null duration — the timer may not have started', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const before = await readCard(db, cardId);
    const { next } = applyGrade(schedulingOf(before), Grade.Hard, new Date());
    await reviewCard(db, {
      cardId,
      rating: Grade.Hard,
      durationMs: null,
      expectedUpdatedAt: before.updated_at,
      next,
    });
    const stored = await db.raw.query<{ duration_ms: number | null }>(
      'select duration_ms from reviews where card_id = $1',
      [cardId],
    );
    expect(stored.rows[0]?.duration_ms).toBeNull();
  });
});

describe('the stale-rating guard', () => {
  it('rejects a second rating carrying the first one’s updated_at', async () => {
    // Two tabs, both showing the card as it was. The first rating wins.
    const cardId = await seedCard(db, alice, aliceDeck);
    const staleView = await readCard(db, cardId);

    await rate(cardId, Grade.Good);

    const { next } = applyGrade(schedulingOf(staleView), Grade.Again, new Date());
    await expect(
      reviewCard(db, {
        cardId,
        rating: Grade.Again,
        expectedUpdatedAt: staleView.updated_at,
        next,
      }),
    ).rejects.toThrow(/changed since it was loaded/i);

    // And it double-logged nothing.
    const count = await db.raw.query<{ count: string }>(
      'select count(*)::text as count from reviews where card_id = $1',
      [cardId],
    );
    expect(count.rows[0]?.count).toBe('1');
  });

  it('reports the conflict as PT409 so the client can tell it apart', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const staleView = await readCard(db, cardId);
    await rate(cardId, Grade.Good);

    const { next } = applyGrade(schedulingOf(staleView), Grade.Good, new Date());
    const error = await reviewCard(db, {
      cardId,
      rating: Grade.Good,
      expectedUpdatedAt: staleView.updated_at,
      next,
    }).catch((caught: { code?: string }) => caught);
    expect((error as { code?: string }).code).toBe('PT409');
  });

  it('refuses a rating that omits the expected version entirely', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const before = await readCard(db, cardId);
    const { next } = applyGrade(schedulingOf(before), Grade.Good, new Date());
    await expect(
      db.raw.query(
        'select * from review_card($1::uuid, 3::smallint, null, null, $2::jsonb)',
        [cardId, JSON.stringify(next)],
      ),
    ).rejects.toThrow(/changed since it was loaded/i);
  });
});

describe('RLS still applies inside the function', () => {
  it("will not let Bob rate Alice's card", async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const view = await readCard(db, cardId);
    const { next } = applyGrade(schedulingOf(view), Grade.Good, new Date());

    await db.actAs(bob);
    const error = await reviewCard(db, {
      cardId,
      rating: Grade.Good,
      expectedUpdatedAt: view.updated_at,
      next,
    }).catch((caught: { code?: string }) => caught);

    // Not found rather than forbidden: RLS hid the row, so the function cannot
    // distinguish "someone else's card" from "no such card" — and should not.
    expect((error as { code?: string }).code).toBe('PT404');

    await db.actAs(alice);
    const untouched = await readCard(db, cardId);
    expect(untouched.reps).toBe(0);
    expect(untouched.fsrs_state).toBe('new');
  });

  it('logs nothing when the card is invisible', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const view = await readCard(db, cardId);
    const { next } = applyGrade(schedulingOf(view), Grade.Good, new Date());

    await db.actAs(bob);
    await reviewCard(db, {
      cardId,
      rating: Grade.Good,
      expectedUpdatedAt: view.updated_at,
      next,
    }).catch(() => undefined);

    await db.actAs(alice);
    const count = await db.raw.query<{ count: string }>(
      'select count(*)::text as count from reviews where card_id = $1',
      [cardId],
    );
    expect(count.rows[0]?.count).toBe('0');
  });
});

describe('signed-out callers', () => {
  it('cannot execute either RPC at all', async () => {
    // Not merely "sees no rows": `anon` has no EXECUTE grant, so the request is
    // refused before the function body runs. Supabase grants EXECUTE on new
    // public functions to anon by default privileges, so this has to be revoked
    // explicitly — and stay revoked.
    const cardId = await seedCard(db, alice, aliceDeck);
    await db.actAsAnon();

    await expect(
      db.raw.query(
        'select * from review_card($1::uuid, 3::smallint, null, now(), $2::jsonb)',
        [cardId, JSON.stringify({})],
      ),
    ).rejects.toThrow(/permission denied/i);

    await expect(
      db.raw.query('select * from undo_last_review($1::uuid)', [cardId]),
    ).rejects.toThrow(/permission denied/i);
  });
});

describe('lapses', () => {
  it('counts one only on Again', async () => {
    for (const grade of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
      const cardId = await seedCard(db, alice, aliceDeck, {
        fsrs_state: 'review',
        stability: 40,
        difficulty: 5,
        reps: 6,
        lapses: 2,
        scheduled_days: 30,
        elapsed_days: 30,
        last_review: new Date(Date.now() - 30 * 86_400_000).toISOString(),
      });
      const { after } = await rate(cardId, grade);
      expect(after.reps).toBe(7);
      expect(after.lapses).toBe(grade === Grade.Again ? 3 : 2);
    }
  });
});

describe('payload validation', () => {
  async function callWithNext(next: Record<string, unknown>) {
    const cardId = await seedCard(db, alice, aliceDeck);
    const before = await readCard(db, cardId);
    return reviewCard(db, {
      cardId,
      rating: Grade.Good,
      expectedUpdatedAt: before.updated_at,
      next,
    });
  }

  const valid = () => ({
    fsrs_state: 'review',
    stability: 3.2,
    difficulty: 5.1,
    due: new Date(Date.now() + 86_400_000).toISOString(),
    last_review: new Date().toISOString(),
    scheduled_days: 1,
    elapsed_days: 0,
    learning_steps: 0,
  });

  it('accepts exactly the eight scheduling keys', async () => {
    await expect(callWithNext(valid())).resolves.toBeDefined();
  });

  it('rejects an unexpected key rather than ignoring it', async () => {
    // RLS checks who you are, never what you sent. A silently ignored key is how
    // a client ends up believing it wrote something it did not.
    await expect(callWithNext({ ...valid(), user_id: bob })).rejects.toThrow(
      /unexpected key/i,
    );
    await expect(callWithNext({ ...valid(), reps: 999 })).rejects.toThrow(
      /unexpected key/i,
    );
  });

  it('rejects a missing or null key', async () => {
    const { stability: _stability, ...missing } = valid();
    await expect(callWithNext(missing)).rejects.toThrow(/missing stability/i);
    await expect(callWithNext({ ...valid(), difficulty: null })).rejects.toThrow(
      /missing difficulty/i,
    );
  });

  it('rejects a payload that is not an object', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const before = await readCard(db, cardId);
    await expect(
      db.raw.query(
        'select * from review_card($1::uuid, 3::smallint, null, $2::timestamptz, $3::jsonb)',
        [cardId, before.updated_at, JSON.stringify([1, 2, 3])],
      ),
    ).rejects.toThrow(/must be a json object/i);
  });

  it('rejects a rating outside 1..4 before touching the card', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const before = await readCard(db, cardId);
    await expect(
      reviewCard(db, {
        cardId,
        rating: 5,
        expectedUpdatedAt: before.updated_at,
        next: valid(),
      }),
    ).rejects.toThrow(/rating must be 1\.\.4/i);
  });

  it('refuses to send a reviewed card back to state new', async () => {
    await expect(callWithNext({ ...valid(), fsrs_state: 'new' })).rejects.toThrow(
      /cannot return to state new/i,
    );
  });

  it('refuses a state string the enum does not have', async () => {
    await expect(callWithNext({ ...valid(), fsrs_state: 'mastered' })).rejects.toThrow(
      /invalid input value for enum/i,
    );
  });

  it('refuses to rate a suspended card', async () => {
    const cardId = await seedCard(db, alice, aliceDeck, { status: 'suspended' });
    const before = await readCard(db, cardId);
    await expect(
      reviewCard(db, {
        cardId,
        rating: Grade.Good,
        expectedUpdatedAt: before.updated_at,
        next: valid(),
      }),
    ).rejects.toThrow(/not in any queue/i);
  });
});
