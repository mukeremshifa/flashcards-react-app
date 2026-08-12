import { describe, expect, it } from 'vitest';
import { buildQueue, nextDueAfter, remainingNewAllowance, type QueueCard } from './queue';

/**
 * SPEC §6. Two failures, both of which look fine on day one:
 *   - a new-card cap that leaks, so a fresh deck floods the user;
 *   - new cards taking slots from due reviews, so the review debt grows
 *     invisibly until the queue is unmanageable.
 */

const AT = (iso: string) => new Date(iso).toISOString();

function reviews(count: number): QueueCard[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `due-${index}`,
    due: AT(`2026-05-01T0${Math.min(index, 9)}:00:00Z`),
    fsrs_state: 'review' as const,
  }));
}

function fresh(count: number): QueueCard[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `new-${index}`,
    due: AT('2026-05-01T00:00:00Z'),
    fsrs_state: 'new' as const,
  }));
}

const isNew = (card: QueueCard) => card.fsrs_state === 'new';

describe('the daily new-card cap', () => {
  it('introduces no more than the limit', () => {
    const queue = buildQueue({
      due: [],
      fresh: fresh(50),
      dailyNewLimit: 20,
      introducedToday: 0,
    });
    expect(queue).toHaveLength(20);
  });

  it('counts cards already introduced today against the limit', () => {
    const queue = buildQueue({
      due: [],
      fresh: fresh(50),
      dailyNewLimit: 20,
      introducedToday: 13,
    });
    expect(queue).toHaveLength(7);
  });

  it('introduces nothing once the limit is used up', () => {
    const queue = buildQueue({
      due: reviews(3),
      fresh: fresh(50),
      dailyNewLimit: 20,
      introducedToday: 20,
    });
    expect(queue.filter(isNew)).toHaveLength(0);
    expect(queue).toHaveLength(3);
  });

  it('does not go negative if the limit was lowered mid-day', () => {
    // Settings let the user drop daily_new_limit below what they already did.
    expect(remainingNewAllowance(5, 20)).toBe(0);
    const queue = buildQueue({
      due: reviews(2),
      fresh: fresh(10),
      dailyNewLimit: 5,
      introducedToday: 20,
    });
    expect(queue).toHaveLength(2);
  });

  it('honours a limit of zero — review-only mode', () => {
    const queue = buildQueue({
      due: reviews(4),
      fresh: fresh(10),
      dailyNewLimit: 0,
      introducedToday: 0,
    });
    expect(queue.filter(isNew)).toHaveLength(0);
    expect(queue).toHaveLength(4);
  });
});

describe('due reviews are never starved', () => {
  it('keeps every due review, whatever the new-card load', () => {
    const due = reviews(10);
    const queue = buildQueue({
      due,
      fresh: fresh(100),
      dailyNewLimit: 20,
      introducedToday: 0,
    });
    expect(queue.filter(card => !isNew(card)).map(card => card.id)).toEqual(
      due.map(card => card.id),
    );
    expect(queue).toHaveLength(30);
  });

  it('preserves due order — oldest first', () => {
    const due = reviews(8);
    const queue = buildQueue({
      due,
      fresh: fresh(3),
      dailyNewLimit: 20,
      introducedToday: 0,
    });
    const dueIds = queue.filter(card => !isNew(card)).map(card => card.id);
    expect(dueIds).toEqual(due.map(card => card.id));
  });

  it('does not front-load the session with new cards', () => {
    // Twenty unfamiliar cards in a row is how a session gets abandoned.
    const queue = buildQueue({
      due: reviews(10),
      fresh: fresh(20),
      dailyNewLimit: 20,
      introducedToday: 0,
    });
    const leadingNew = queue.findIndex(card => !isNew(card));
    expect(leadingNew).toBeLessThanOrEqual(2);

    // Spread out rather than clustered: no run of new cards longer than a few.
    let run = 0;
    let longestRun = 0;
    for (const card of queue) {
      run = isNew(card) ? run + 1 : 0;
      longestRun = Math.max(longestRun, run);
    }
    expect(longestRun).toBeLessThanOrEqual(3);
  });

  it('still works when there is nothing new left', () => {
    const due = reviews(5);
    expect(
      buildQueue({ due, fresh: [], dailyNewLimit: 20, introducedToday: 0 }).map(
        c => c.id,
      ),
    ).toEqual(due.map(card => card.id));
  });

  it('still works when there is nothing due', () => {
    const queue = buildQueue({
      due: [],
      fresh: fresh(4),
      dailyNewLimit: 20,
      introducedToday: 0,
    });
    expect(queue).toHaveLength(4);
    expect(queue.every(isNew)).toBe(true);
  });

  it('returns an empty queue when there is nothing at all', () => {
    expect(
      buildQueue({ due: [], fresh: [], dailyNewLimit: 20, introducedToday: 0 }),
    ).toEqual([]);
  });

  it('never drops or duplicates a card', () => {
    const due = reviews(9);
    const newCards = fresh(30);
    const queue = buildQueue({
      due,
      fresh: newCards,
      dailyNewLimit: 7,
      introducedToday: 0,
    });
    const ids = queue.map(card => card.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toHaveLength(due.length + 7);
    for (const card of due) expect(ids).toContain(card.id);
  });
});

describe('nextDueAfter', () => {
  const now = new Date('2026-05-01T12:00:00Z');

  it('finds the soonest card still ahead', () => {
    expect(
      nextDueAfter(
        [
          AT('2026-05-02T09:00:00Z'),
          AT('2026-05-01T16:00:00Z'),
          AT('2026-05-03T09:00:00Z'),
        ],
        now,
      ),
    ).toEqual(new Date('2026-05-01T16:00:00Z'));
  });

  it('ignores cards that are already due', () => {
    expect(
      nextDueAfter([AT('2026-05-01T08:00:00Z'), AT('2026-05-01T18:00:00Z')], now),
    ).toEqual(new Date('2026-05-01T18:00:00Z'));
  });

  it('says nothing is scheduled rather than guessing', () => {
    expect(nextDueAfter([], now)).toBeNull();
    expect(nextDueAfter([AT('2026-04-30T08:00:00Z')], now)).toBeNull();
  });
});
