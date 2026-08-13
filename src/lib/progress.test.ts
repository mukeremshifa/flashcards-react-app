import { describe, expect, it } from 'vitest';
import { addStudyDays, studyDayKey, studyDayStart } from './day';
import type { FsrsStateName } from './fsrs';
import { Grade } from './schemas';
import {
  countable,
  dayCounts,
  forecast,
  heatmapGrid,
  intensityLevel,
  intensityThresholds,
  memoryStrength,
  memoryTrend,
  percentage,
  retention,
  stateDistribution,
  streaks,
  type ReviewLogEntry,
} from './progress';

/**
 * SPEC §10 names "streak and retention math across timezone boundaries" as a
 * thing that must be unit-tested, and this is why: every failure mode in this
 * file is silent. A streak that resets itself on the last Sunday in October,
 * a heatmap whose counts sit one row off for a year, "0% retention" shown to
 * someone who has reviewed nothing — none of them throws, and none of them is
 * visible without studying for a month in the right timezone.
 */

function entry(
  reviewedAt: string,
  overrides: Partial<ReviewLogEntry> = {},
): ReviewLogEntry {
  return {
    rating: Grade.Good,
    reviewed_at: reviewedAt,
    state_before: 'review',
    undone_at: null,
    ...overrides,
  };
}

/** 01:00 local on the morning *after* `dayKey` — still that study day. */
function lateNightOf(dayKey: string, timeZone: string): Date {
  return new Date(studyDayStart(dayKey, timeZone).getTime() + 21 * 3_600_000);
}

function range(first: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => addStudyDays(first, index));
}

describe('streaks', () => {
  it('counts a day with at least one review', () => {
    expect(streaks(['2026-08-10', '2026-08-11', '2026-08-12'], '2026-08-12')).toEqual({
      current: 3,
      longest: 3,
    });
  });

  it('does not break today when today has not been reviewed yet', () => {
    // The day is not over. A streak that resets every morning at 04:00 would be
    // wrong for most of the waking day.
    expect(streaks(['2026-08-10', '2026-08-11'], '2026-08-12')).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('does break when yesterday was missed', () => {
    expect(streaks(['2026-08-09', '2026-08-10'], '2026-08-12')).toEqual({
      current: 0,
      longest: 2,
    });
  });

  it('remembers the longest run after the current one ends', () => {
    const days = [...range('2026-01-01', 9), ...range('2026-08-11', 2)];
    expect(streaks(days, '2026-08-12')).toEqual({ current: 2, longest: 9 });
  });

  it('is unmoved by several reviews on the same day', () => {
    expect(streaks(['2026-08-12', '2026-08-12', '2026-08-11'], '2026-08-12')).toEqual({
      current: 2,
      longest: 2,
    });
  });

  it('has no streak at all on day one', () => {
    expect(streaks([], '2026-08-12')).toEqual({ current: 0, longest: 0 });
  });

  describe('across a DST transition', () => {
    // Reviews at 01:00 local every night: the hardest combination, because the
    // instant is on the *next* calendar date and the clocks move underneath it.
    const timeZone = 'Europe/Berlin';

    it('survives the clocks going back (a 25-hour study day)', () => {
      const days = range('2026-10-20', 11); // 25 Oct is the transition
      const keys = days.map(day => studyDayKey(lateNightOf(day, timeZone), timeZone));

      expect(keys).toEqual(days);
      expect(streaks(keys, '2026-10-30')).toEqual({ current: 11, longest: 11 });
    });

    it('survives the clocks going forward (a 23-hour study day)', () => {
      const days = range('2026-03-25', 10); // 29 Mar is the transition
      const keys = days.map(day => studyDayKey(lateNightOf(day, timeZone), timeZone));

      expect(keys).toEqual(days);
      expect(streaks(keys, '2026-04-03')).toEqual({ current: 10, longest: 10 });
    });

    it('still notices a genuinely missed day next to the transition', () => {
      const days = range('2026-10-20', 11).filter(day => day !== '2026-10-25');
      const keys = days.map(day => studyDayKey(lateNightOf(day, timeZone), timeZone));

      expect(streaks(keys, '2026-10-30')).toEqual({ current: 5, longest: 5 });
    });
  });
});

describe('day bucketing', () => {
  it('counts a 01:00 session towards the previous day', () => {
    const timeZone = 'America/New_York';
    const counts = dayCounts(
      countable([
        entry('2026-08-12T05:30:00Z'), // 01:30 on the 12th, local
        entry('2026-08-12T07:59:00Z'), // 03:59 on the 12th, local
        entry('2026-08-12T08:01:00Z'), // 04:01 on the 12th, local
      ]),
      timeZone,
    );

    expect(counts).toEqual(
      new Map([
        ['2026-08-11', 2],
        ['2026-08-12', 1],
      ]),
    );
  });

  it('excludes undone ratings', () => {
    const counts = dayCounts(
      countable([
        entry('2026-08-12T12:00:00Z'),
        entry('2026-08-12T12:05:00Z', { undone_at: '2026-08-12T12:05:30Z' }),
      ]),
      'UTC',
    );

    expect(counts.get('2026-08-12')).toBe(1);
  });
});

describe('retention', () => {
  const window = {
    from: new Date('2026-08-01T00:00:00Z'),
    to: new Date('2026-08-31T00:00:00Z'),
  };

  it('is null, not zero, when nothing has been reviewed', () => {
    const result = retention(countable([]), window);

    // "No data yet" and "0% retention" are different sentences.
    expect(result.overall).toEqual({ reviewed: 0, recalled: 0, percent: null });
    expect(result.byState.review.percent).toBeNull();
  });

  it('counts Hard and better as recalled', () => {
    const result = retention(
      countable([
        entry('2026-08-10T10:00:00Z', { rating: Grade.Again }),
        entry('2026-08-10T10:01:00Z', { rating: Grade.Hard }),
        entry('2026-08-10T10:02:00Z', { rating: Grade.Good }),
        entry('2026-08-10T10:03:00Z', { rating: Grade.Easy }),
      ]),
      window,
    );

    expect(result.overall).toEqual({ reviewed: 4, recalled: 3, percent: 75 });
  });

  it('splits by the state the card was in beforehand', () => {
    const result = retention(
      countable([
        entry('2026-08-10T10:00:00Z', { rating: Grade.Again, state_before: 'new' }),
        entry('2026-08-10T10:01:00Z', { rating: Grade.Good, state_before: 'new' }),
        entry('2026-08-10T10:02:00Z', { rating: Grade.Good, state_before: 'review' }),
        entry('2026-08-10T10:03:00Z', { rating: Grade.Good, state_before: 'review' }),
      ]),
      window,
    );

    expect(result.byState.new).toEqual({ reviewed: 2, recalled: 1, percent: 50 });
    expect(result.byState.review).toEqual({ reviewed: 2, recalled: 2, percent: 100 });
    expect(result.byState.learning.percent).toBeNull();
  });

  it('excludes undone ratings, which would otherwise inflate it', () => {
    const rows = [
      entry('2026-08-10T10:00:00Z', { rating: Grade.Again }),
      // Rated Again by mistake, undone. Counting it twice — once as the mistake
      // and once as the real answer — is exactly backwards.
      entry('2026-08-10T10:00:30Z', {
        rating: Grade.Again,
        undone_at: '2026-08-10T10:00:35Z',
      }),
      entry('2026-08-10T10:01:00Z', { rating: Grade.Good }),
    ];

    expect(retention(countable(rows), window).overall).toEqual({
      reviewed: 2,
      recalled: 1,
      percent: 50,
    });
  });

  it('ignores reviews outside the window', () => {
    const rows = countable([
      entry('2026-07-31T23:59:00Z', { rating: Grade.Again }),
      entry('2026-08-02T10:00:00Z', { rating: Grade.Good }),
    ]);

    expect(retention(rows, window).overall.reviewed).toBe(1);
  });

  it('has a percentage helper that refuses to divide by zero', () => {
    expect(percentage(0, 0)).toBeNull();
    expect(percentage(0, 4)).toBe(0);
    expect(percentage(1, 4)).toBe(25);
  });
});

describe('card states', () => {
  const cards = [
    { fsrs_state: 'new' as FsrsStateName, stability: null, difficulty: null },
    { fsrs_state: 'new' as FsrsStateName, stability: null, difficulty: null },
    { fsrs_state: 'learning' as FsrsStateName, stability: 1, difficulty: 5 },
    { fsrs_state: 'review' as FsrsStateName, stability: 30, difficulty: 5 },
    { fsrs_state: 'relearning' as FsrsStateName, stability: 5, difficulty: 8 },
  ];

  it('counts every state, including the empty ones', () => {
    expect(stateDistribution(cards)).toEqual({
      counts: { new: 2, learning: 1, review: 1, relearning: 1 },
      total: 5,
    });
    expect(stateDistribution([]).counts.review).toBe(0);
  });

  it('averages only over cards that have memory state', () => {
    const strength = memoryStrength(cards);
    expect(strength.cards).toBe(3);
    expect(strength.stability).toBeCloseTo(12, 10);
    expect(strength.difficulty).toBeCloseTo(6, 10);
  });

  it('has no mean at all before the first review', () => {
    expect(memoryStrength([{ fsrs_state: 'new' }])).toEqual({
      stability: null,
      difficulty: null,
      cards: 0,
    });
  });
});

describe('memoryTrend', () => {
  const window = {
    from: new Date('2026-08-01T00:00:00Z'),
    to: new Date('2026-08-31T00:00:00Z'),
  };

  it('compares the two halves of the window', () => {
    const rows = countable([
      entry('2026-08-02T10:00:00Z', { stability_after: 10, difficulty_after: 6 }),
      entry('2026-08-05T10:00:00Z', { stability_after: 20, difficulty_after: 4 }),
      entry('2026-08-20T10:00:00Z', { stability_after: 30, difficulty_after: 5 }),
      entry('2026-08-25T10:00:00Z', { stability_after: 50, difficulty_after: 5 }),
    ]);

    const trend = memoryTrend(rows, window);
    expect(trend.stability).toEqual({ recent: 40, earlier: 15, delta: 25 });
    expect(trend.difficulty).toEqual({ recent: 5, earlier: 5, delta: 0 });
  });

  it('has no delta when one half is empty', () => {
    const rows = countable([
      entry('2026-08-20T10:00:00Z', { stability_after: 30, difficulty_after: 5 }),
    ]);

    const trend = memoryTrend(rows, window);
    expect(trend.stability.recent).toBe(30);
    expect(trend.stability.earlier).toBeNull();
    expect(trend.stability.delta).toBeNull();
  });
});

describe('forecast', () => {
  const timeZone = 'UTC';
  const from = new Date('2026-08-12T10:00:00Z');

  const cards = [
    { due: '2026-07-01T00:00:00Z', fsrs_state: 'review' as FsrsStateName }, // overdue
    { due: '2026-08-12T23:00:00Z', fsrs_state: 'learning' as FsrsStateName }, // today
    { due: '2026-08-14T06:00:00Z', fsrs_state: 'review' as FsrsStateName },
    { due: '2026-08-14T07:00:00Z', fsrs_state: 'relearning' as FsrsStateName },
    { due: '2026-12-01T06:00:00Z', fsrs_state: 'review' as FsrsStateName }, // past horizon
    { due: '2026-08-12T09:00:00Z', fsrs_state: 'new' as FsrsStateName }, // not scheduled
  ];

  it('bucket 0 is what /practice would serve right now', () => {
    const days = forecast(cards, from, 30, { timeZone, newToday: 3 });

    expect(days).toHaveLength(30);
    expect(days[0]).toEqual({
      day: '2026-08-12',
      // Overdue since July, plus the learning card due later today.
      review: 1,
      learning: 1,
      relearning: 0,
      new: 3,
      total: 5,
    });
  });

  it('never projects new cards past today', () => {
    const days = forecast(cards, from, 30, { timeZone, newToday: 3 });
    // A new card has no scheduled date; guessing one would be inventing data.
    expect(days.slice(1).every(day => day.new === 0)).toBe(true);
  });

  it('buckets by study day and drops anything past the horizon', () => {
    const days = forecast(cards, from, 30, { timeZone, newToday: 0 });

    expect(days[2]).toMatchObject({
      day: '2026-08-14',
      review: 1,
      relearning: 1,
      total: 2,
    });
    expect(days.reduce((sum, day) => sum + day.total, 0)).toBe(4);
  });

  it('uses the 04:00 boundary, not midnight', () => {
    const days = forecast(
      [{ due: '2026-08-13T02:00:00Z', fsrs_state: 'review' }],
      from,
      30,
      { timeZone, newToday: 0 },
    );

    // 02:00 on the 13th is still the study day that began on the 12th.
    expect(days[0]?.review).toBe(1);
    expect(days[1]?.review).toBe(0);
  });
});

describe('heatmapGrid', () => {
  // Sunday through Saturday: the alignment has to hold whichever weekday the
  // year happens to end on, and it is wrong for exactly six of them if the
  // leading padding is dropped.
  const anyWeekday = range('2026-08-09', 7);

  it('is 53 columns of 7, whatever day the year ends on', () => {
    for (const today of anyWeekday) {
      const grid = heatmapGrid(new Map(), today, 365);
      expect(grid.columns).toHaveLength(53);
      expect(grid.columns.every(column => column.length === 7)).toBe(true);
    }
  });

  it('puts every day on its own weekday row', () => {
    for (const today of anyWeekday) {
      const grid = heatmapGrid(new Map(), today, 365);
      for (const column of grid.columns) {
        column.forEach((cell, row) => {
          if (cell.day !== null) {
            expect(studyDayStart(cell.day, 'UTC').getUTCDay()).toBe(row);
          }
        });
      }
    }
  });

  it('shows exactly the window, ending on today', () => {
    for (const today of anyWeekday) {
      const visible = heatmapGrid(new Map(), today, 365)
        .columns.flat()
        .filter(cell => cell.day !== null);

      expect(visible).toHaveLength(365);
      expect(visible[0]?.day).toBe(addStudyDays(today, -364));
      expect(visible.at(-1)?.day).toBe(today);
    }
  });

  it('pads the first column and the last, and nothing in between', () => {
    const today = '2026-08-12'; // a Wednesday
    const grid = heatmapGrid(new Map(), today, 365);

    const firstColumn = grid.columns[0] ?? [];
    const lastColumn = grid.columns.at(-1) ?? [];
    // 365 days back from a Wednesday starts on a Thursday: three empty cells.
    expect(firstColumn.filter(cell => cell.day === null)).toHaveLength(3);
    // Wednesday is row 3, so Thursday to Saturday have not happened yet.
    expect(lastColumn.filter(cell => cell.day === null)).toHaveLength(3);
    expect(
      grid.columns
        .slice(1, -1)
        .flat()
        .filter(cell => cell.day === null),
    ).toHaveLength(0);
  });

  it('lands each count on its own day, and ignores days outside the window', () => {
    const today = '2026-08-12';
    const counts = new Map([
      [today, 5],
      ['2025-08-13', 2], // the first day in the window
      ['2025-08-12', 99], // one day too early
    ]);

    const grid = heatmapGrid(counts, today, 365);
    const cells = new Map(
      grid.columns
        .flat()
        .filter(cell => cell.day !== null)
        .map(cell => [cell.day, cell.count]),
    );

    expect(cells.get(today)).toBe(5);
    expect(cells.get('2025-08-13')).toBe(2);
    expect(cells.has('2025-08-12')).toBe(false);
    expect(grid.total).toBe(7);
    expect(grid.activeDays).toBe(2);
    expect(grid.busiest).toBe(5);
  });

  it('reports zero days rather than pretending on a new account', () => {
    const grid = heatmapGrid(new Map(), '2026-08-12', 365);
    expect(grid.total).toBe(0);
    expect(grid.activeDays).toBe(0);
    expect(grid.columns.flat().every(cell => cell.level === 0)).toBe(true);
  });
});

describe('heatmap intensity', () => {
  it('scales to the user’s own history', () => {
    const light = intensityThresholds([1, 2, 3, 2, 1, 4]);
    const heavy = intensityThresholds(Array.from({ length: 50 }, () => 200));

    // Twenty reviews is a busy day for one of these users and a quiet one for
    // the other; fixed thresholds would give one a blank year and the other a
    // solid block.
    expect(intensityLevel(20, light)).toBe(4);
    expect(intensityLevel(20, heavy)).toBe(1);
  });

  it('is monotone and reserves level 0 for a day with nothing on it', () => {
    const thresholds = intensityThresholds([1, 5, 10, 20, 40]);
    expect(thresholds[0]).toBe(1);
    expect(thresholds[1]).toBeGreaterThan(thresholds[0]);
    expect(thresholds[2]).toBeGreaterThan(thresholds[1]);
    expect(thresholds[3]).toBeGreaterThan(thresholds[2]);

    expect(intensityLevel(0, thresholds)).toBe(0);
    expect(intensityLevel(1, thresholds)).toBe(1);
    expect(intensityLevel(10_000, thresholds)).toBe(4);
  });

  it('survives a history with nothing in it', () => {
    expect(intensityThresholds([])).toEqual([1, 2, 3, 4]);
    expect(intensityThresholds([0, 0, 0])).toEqual([1, 2, 3, 4]);
  });
});
