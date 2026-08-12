// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pg-harness';
import {
  readCard,
  reviewCard,
  schedulingOf,
  seedCard,
  seedDeck,
  seedReview,
  undoLastReview,
} from './fixtures';
import { applyGrade } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';
import { studyDayKey } from '@/lib/day';
import { countable, dayCounts } from '@/lib/progress';

/**
 * `review_day_counts` is a second implementation of "what study day is it" —
 * the first being src/lib/day.ts — and two implementations of that question
 * disagree at exactly the moment nobody is testing: 01:00, and the Sunday the
 * clocks change. This file exists to make them agree by assertion rather than
 * by inspection.
 *
 * The other half is arithmetic that no unit test can reach: whether the SQL
 * aggregate counts the rows it should, and whether an undone rating is excluded
 * from it.
 */

let db: TestDb;

beforeAll(async () => {
  db = await createTestDb();
}, 60_000);

afterAll(async () => {
  await db?.close();
});

type DayCountRow = {
  day: string;
  reviews: number;
  again: number;
  hard: number;
  good: number;
  easy: number;
  introduced: number;
};

/** Call the RPC the way PostgREST does, with `date` rendered as text. */
async function sqlDayCounts(timeZone: string, from: Date): Promise<DayCountRow[]> {
  const result = await db.raw.query<DayCountRow>(
    `select day::text as day, reviews, again, hard, good, easy, introduced
       from review_day_counts($1, $2::timestamptz)`,
    [timeZone, from.toISOString()],
  );
  return result.rows;
}

let accounts = 0;

async function freshAccount() {
  accounts += 1;
  const userId = await db.createUser(`stats${accounts}@example.com`);
  const deckId = await seedDeck(db, userId, `Deck ${accounts}`);
  const cardId = await seedCard(db, userId, deckId);
  return { userId, deckId, cardId };
}

const EPOCH = new Date('2020-01-01T00:00:00Z');

describe('review_day_counts buckets days the way day.ts does', () => {
  /**
   * Every zone here is chosen for a reason: New York and Berlin change their
   * clocks on different dates and in different directions within the sampled
   * window, Kolkata never changes but sits at UTC+05:30, and UTC is the case
   * that works even when the implementation is wrong.
   */
  const zones = [
    { timeZone: 'America/New_York', around: '2026-11-01' }, // clocks go back
    { timeZone: 'America/New_York', around: '2026-03-08' }, // clocks go forward
    { timeZone: 'Europe/Berlin', around: '2026-10-25' },
    { timeZone: 'Asia/Kolkata', around: '2026-06-15' },
    { timeZone: 'UTC', around: '2026-06-15' },
  ];

  for (const { timeZone, around } of zones) {
    it(`agrees with studyDayKey in ${timeZone} around ${around}`, async () => {
      const { userId, cardId } = await freshAccount();

      // Two days either side of the transition, sampled at an interval that is
      // not a divisor of an hour so the samples walk across the boundary rather
      // than landing on it repeatedly.
      const start = new Date(`${around}T00:00:00Z`).getTime() - 2 * 86_400_000;
      const instants: Date[] = [];
      for (let step = 0; step < 96; step += 1) {
        instants.push(new Date(start + step * 79 * 60_000));
      }

      for (const instant of instants) {
        await seedReview(db, userId, cardId, { reviewedAt: instant });
      }

      const expected = dayCounts(
        countable(
          instants.map(instant => ({
            rating: 3,
            reviewed_at: instant.toISOString(),
            state_before: 'review' as const,
            undone_at: null,
          })),
        ),
        timeZone,
      );

      await db.actAs(userId);
      const rows = await sqlDayCounts(timeZone, EPOCH);
      const actual = new Map(rows.map(row => [row.day, row.reviews]));

      expect(actual).toEqual(expected);
      // Sanity: the fixture would prove nothing if it produced one bucket.
      expect(actual.size).toBeGreaterThan(3);
    });
  }

  it('puts a 01:00 session on the previous study day', async () => {
    const { userId, cardId } = await freshAccount();
    const timeZone = 'Europe/Berlin'; // UTC+1 in January

    // 01:00 and 03:59 local on the 15th; 04:00 local on the 15th.
    const late = new Date('2026-01-15T00:00:00Z');
    const stillLate = new Date('2026-01-15T02:59:00Z');
    const morning = new Date('2026-01-15T03:00:00Z');

    for (const instant of [late, stillLate, morning]) {
      await seedReview(db, userId, cardId, { reviewedAt: instant });
    }

    await db.actAs(userId);
    const rows = await sqlDayCounts(timeZone, EPOCH);

    expect(rows).toEqual([
      expect.objectContaining({ day: '2026-01-14', reviews: 2 }),
      expect.objectContaining({ day: '2026-01-15', reviews: 1 }),
    ]);
    expect(studyDayKey(stillLate, timeZone)).toBe('2026-01-14');
  });

  it('falls back to UTC for a timezone Postgres does not know', async () => {
    const { userId, cardId } = await freshAccount();
    await seedReview(db, userId, cardId, {
      reviewedAt: new Date('2026-05-10T02:00:00Z'),
    });

    await db.actAs(userId);
    const rows = await sqlDayCounts('Nowhere/Imaginary', EPOCH);

    // 02:00 UTC is before the 04:00 boundary, so it belongs to the 9th.
    expect(rows).toEqual([expect.objectContaining({ day: '2026-05-09', reviews: 1 })]);
  });
});

describe('a seeded month aggregates to known counts', () => {
  it('splits by rating and counts introductions', async () => {
    const { userId, cardId } = await freshAccount();
    const timeZone = 'UTC';

    // Day one: a new card is introduced, then two more reviews.
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-01T09:00:00Z',
      rating: Grade.Good,
      stateBefore: 'new',
      stateAfter: 'learning',
    });
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-01T09:10:00Z',
      rating: Grade.Again,
      stateBefore: 'learning',
    });
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-01T21:00:00Z',
      rating: Grade.Easy,
    });

    // Day two: nothing at all — the gap a streak has to notice.

    // Day three: one Hard, one Good, and one rating that was undone.
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-03T12:00:00Z',
      rating: Grade.Hard,
    });
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-03T12:30:00Z',
      rating: Grade.Good,
    });
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-03T13:00:00Z',
      rating: Grade.Again,
      undoneAt: '2026-07-03T13:00:05Z',
    });

    // Just after the 04:00 boundary on day four — the day it starts, not ends.
    await seedReview(db, userId, cardId, {
      reviewedAt: '2026-07-04T04:00:01Z',
      rating: Grade.Good,
      stateBefore: 'new',
      stateAfter: 'learning',
    });

    await db.actAs(userId);
    const rows = await sqlDayCounts(timeZone, EPOCH);

    expect(rows).toEqual([
      {
        day: '2026-07-01',
        reviews: 3,
        again: 1,
        hard: 0,
        good: 1,
        easy: 1,
        introduced: 1,
      },
      {
        day: '2026-07-03',
        reviews: 2,
        again: 0,
        hard: 1,
        good: 1,
        easy: 0,
        introduced: 0,
      },
      {
        day: '2026-07-04',
        reviews: 1,
        again: 0,
        hard: 0,
        good: 1,
        easy: 0,
        introduced: 1,
      },
    ]);
  });

  it('respects p_from', async () => {
    const { userId, cardId } = await freshAccount();
    await seedReview(db, userId, cardId, { reviewedAt: '2026-02-01T10:00:00Z' });
    await seedReview(db, userId, cardId, { reviewedAt: '2026-03-01T10:00:00Z' });

    await db.actAs(userId);
    const rows = await sqlDayCounts('UTC', new Date('2026-02-15T00:00:00Z'));

    expect(rows.map(row => row.day)).toEqual(['2026-03-01']);
  });

  it('shows one user nothing of another user’s log', async () => {
    const mine = await freshAccount();
    const theirs = await freshAccount();
    await seedReview(db, theirs.userId, theirs.cardId, {
      reviewedAt: '2026-04-04T10:00:00Z',
    });

    await db.actAs(mine.userId);
    expect(await sqlDayCounts('UTC', EPOCH)).toEqual([]);
  });
});

describe('undone ratings', () => {
  it('are excluded, so undo lowers the day’s count by one', async () => {
    const { userId, deckId } = await freshAccount();
    const cardId = await seedCard(db, userId, deckId, { front: 'undo me' });
    const timeZone = 'UTC';
    const today = studyDayKey(new Date(), timeZone);

    // Rated through the real RPC, so `reviewed_at` is now() and the row is
    // exactly what the app writes.
    const before = await readCard(db, cardId);
    const { next } = applyGrade(schedulingOf(before), Grade.Good, new Date(), {
      durationMs: 900,
    });
    await reviewCard(db, {
      cardId,
      rating: Grade.Good,
      durationMs: 900,
      expectedUpdatedAt: before.updated_at,
      next,
    });

    await db.actAs(userId);
    const rated = await sqlDayCounts(timeZone, EPOCH);
    expect(rated.find(row => row.day === today)?.reviews).toBe(1);

    await undoLastReview(db, cardId);

    await db.actAs(userId);
    const undone = await sqlDayCounts(timeZone, EPOCH);
    expect(undone.find(row => row.day === today)).toBeUndefined();

    // The row is still there: the log is append-only, the metric just skips it.
    const kept = await db.raw.query<{ n: number }>(
      'select count(*)::int as n from reviews where card_id = $1',
      [cardId],
    );
    expect(kept.rows[0]?.n).toBe(1);
  });
});

describe('grants', () => {
  it('is closed to anon', async () => {
    await db.actAsAnon();
    await expect(
      db.raw.query("select * from review_day_counts('UTC', now())"),
    ).rejects.toThrow(/permission denied/i);
  });

  it('is open to authenticated', async () => {
    const { userId } = await freshAccount();
    await db.actAs(userId);
    await expect(sqlDayCounts('UTC', EPOCH)).resolves.toEqual([]);
  });
});
