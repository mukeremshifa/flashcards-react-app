// @vitest-environment node
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pg-harness';
import {
  readCard,
  reviewCard,
  schedulingOf,
  seedCard,
  seedDeck,
  undoLastReview,
  type CardRow,
} from './fixtures';
import { applyGrade } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';

/**
 * SPEC §4.2: undo is required, not a nicety. Mis-hitting `1` on a mature card
 * throws away months of interval, and an undo that "looks right" — puts the due
 * date back but not the stability — is worse than none, because the damage is
 * then invisible.
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

async function rate(cardId: string, grade: Grade, now = new Date()) {
  const before = await readCard(db, cardId);
  const { next } = applyGrade(schedulingOf(before), grade, now, { durationMs: 900 });
  const after = await reviewCard(db, {
    cardId,
    rating: grade,
    durationMs: 900,
    expectedUpdatedAt: before.updated_at,
    next,
  });
  return { before, after };
}

/** Everything undo must put back, in one comparable object. */
function snapshot(card: CardRow) {
  return {
    fsrs_state: card.fsrs_state,
    stability: card.stability,
    difficulty: card.difficulty,
    due: new Date(card.due).toISOString(),
    last_review: card.last_review && new Date(card.last_review).toISOString(),
    reps: card.reps,
    lapses: card.lapses,
    scheduled_days: card.scheduled_days,
    elapsed_days: card.elapsed_days,
    learning_steps: card.learning_steps,
  };
}

async function matureCard(): Promise<string> {
  return seedCard(db, alice, aliceDeck, {
    fsrs_state: 'review',
    stability: 87.5,
    difficulty: 4.25,
    due: new Date(Date.now() + 40 * 86_400_000).toISOString(),
    last_review: new Date(Date.now() - 47 * 86_400_000).toISOString(),
    reps: 9,
    lapses: 1,
    scheduled_days: 87,
    elapsed_days: 47,
    learning_steps: 0,
  });
}

describe('restoring the prior state', () => {
  it('puts back every scheduling column, exactly', async () => {
    const cardId = await matureCard();
    const before = await readCard(db, cardId);

    // The mistake this feature exists for: Again on a mature card.
    const { after } = await rate(cardId, Grade.Again);
    expect(snapshot(after)).not.toEqual(snapshot(before));

    const restored = await undoLastReview(db, cardId);
    expect(snapshot(restored)).toEqual(snapshot(before));

    // And it is really on the row, not only in the return value.
    expect(snapshot(await readCard(db, cardId))).toEqual(snapshot(before));
  });

  it('restores stability and difficulty, not just the due date', async () => {
    const cardId = await matureCard();
    const before = await readCard(db, cardId);
    await rate(cardId, Grade.Again);
    const restored = await undoLastReview(db, cardId);

    expect(restored.stability).toBe(before.stability);
    expect(restored.difficulty).toBe(before.difficulty);
    expect(restored.learning_steps).toBe(before.learning_steps);
  });

  it('gives back the lapse it took, and only for Again', async () => {
    const failed = await matureCard();
    const beforeFail = await readCard(db, failed);
    await rate(failed, Grade.Again);
    expect((await readCard(db, failed)).lapses).toBe(beforeFail.lapses + 1);
    expect((await undoLastReview(db, failed)).lapses).toBe(beforeFail.lapses);

    const passed = await matureCard();
    const beforePass = await readCard(db, passed);
    await rate(passed, Grade.Good);
    expect((await readCard(db, passed)).lapses).toBe(beforePass.lapses);
    expect((await undoLastReview(db, passed)).lapses).toBe(beforePass.lapses);
  });

  it('returns a brand-new card to `new`, with no memory state', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const before = await readCard(db, cardId);
    await rate(cardId, Grade.Good);

    const restored = await undoLastReview(db, cardId);
    expect(restored.fsrs_state).toBe('new');
    expect(restored.stability).toBeNull();
    expect(restored.difficulty).toBeNull();
    expect(restored.last_review).toBeNull();
    expect(restored.reps).toBe(0);
    expect(snapshot(restored)).toEqual(snapshot(before));
  });

  it('unwinds a run of reviews one at a time', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const states = [await readCard(db, cardId)];

    let at = Date.now();
    for (const grade of [Grade.Good, Grade.Good, Grade.Hard]) {
      at += 86_400_000;
      await rate(cardId, grade, new Date(at));
      states.push(await readCard(db, cardId));
    }

    for (let step = states.length - 1; step > 0; step -= 1) {
      const restored = await undoLastReview(db, cardId);
      expect(snapshot(restored)).toEqual(snapshot(states[step - 1]!));
    }
  });
});

describe('the log after an undo', () => {
  it('keeps the review row and tombstones it', async () => {
    const cardId = await matureCard();
    await rate(cardId, Grade.Again);
    await undoLastReview(db, cardId);

    const rows = await db.raw.query<{ rating: number; undone_at: string | null }>(
      'select rating, undone_at from reviews where card_id = $1',
      [cardId],
    );
    // The rating happened. It stays in the history the optimiser will read; it is
    // simply marked as not counting.
    expect(rows.rows).toHaveLength(1);
    expect(rows.rows[0]?.rating).toBe(Grade.Again);
    expect(rows.rows[0]?.undone_at).not.toBeNull();
  });

  it('skips already-undone reviews when looking for the next one', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const start = await readCard(db, cardId);

    await rate(cardId, Grade.Good, new Date());
    await undoLastReview(db, cardId);
    // Re-rate the same card differently, then undo that too.
    await rate(cardId, Grade.Easy, new Date());
    const restored = await undoLastReview(db, cardId);

    expect(snapshot(restored)).toEqual(snapshot(start));
    const rows = await db.raw.query<{ count: string }>(
      'select count(*)::text as count from reviews where card_id = $1 and undone_at is not null',
      [cardId],
    );
    expect(rows.rows[0]?.count).toBe('2');
  });

  it('refuses when there is nothing to undo', async () => {
    const cardId = await seedCard(db, alice, aliceDeck);
    const error = await undoLastReview(db, cardId).catch(
      (caught: { code?: string }) => caught,
    );
    expect((error as { code?: string }).code).toBe('PT404');

    await rate(cardId, Grade.Good);
    await undoLastReview(db, cardId);
    await expect(undoLastReview(db, cardId)).rejects.toThrow(/no review to undo/i);
  });
});

describe('undo respects RLS', () => {
  it("will not let Bob undo Alice's review", async () => {
    const cardId = await matureCard();
    await rate(cardId, Grade.Again);
    const afterFail = await readCard(db, cardId);

    await db.actAs(bob);
    const error = await undoLastReview(db, cardId).catch(
      (caught: { code?: string }) => caught,
    );
    expect((error as { code?: string }).code).toBe('PT404');

    await db.actAs(alice);
    expect(snapshot(await readCard(db, cardId))).toEqual(snapshot(afterFail));
    const rows = await db.raw.query<{ undone_at: string | null }>(
      'select undone_at from reviews where card_id = $1',
      [cardId],
    );
    expect(rows.rows[0]?.undone_at).toBeNull();
  });
});

describe('undo and the stale-rating guard together', () => {
  it('invalidates a rating prepared before the undo', async () => {
    // A second tab still showing the post-rating card must not be able to write
    // on top of the restored state.
    const cardId = await matureCard();
    await rate(cardId, Grade.Again);
    const staleView = await readCard(db, cardId);
    await undoLastReview(db, cardId);

    const { next } = applyGrade(schedulingOf(staleView), Grade.Good, new Date());
    await expect(
      reviewCard(db, {
        cardId,
        rating: Grade.Good,
        expectedUpdatedAt: staleView.updated_at,
        next,
      }),
    ).rejects.toThrow(/changed since it was loaded/i);
  });
});
