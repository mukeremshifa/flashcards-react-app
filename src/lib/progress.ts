/**
 * Every number on `/progress`, as pure functions.
 *
 * No Supabase import, no React, and no clock that is not passed in. The awkward
 * cases this page has — a streak that crosses a DST change, a month with one
 * review in it, a retention window with nothing in it at all — are then unit
 * tests rather than something you can only observe by studying for a week.
 *
 * Two rules run through the whole file:
 *
 *   1. Undone ratings are excluded *before* anything counts them. `CountedReviews`
 *      is branded so it cannot be made except by passing the log through
 *      `countable`, which applies the filter. Forgetting it inflates retention,
 *      which is exactly backwards — undo is what you press after a mistake.
 *   2. A percentage over an empty denominator is `null`, never `0` and never
 *      `NaN`. "No data yet" and "0%" are different sentences and the UI has to
 *      be able to tell them apart.
 *
 * Day bucketing is `src/lib/day.ts` and nothing else. A second answer to "what
 * day is it" is the bug this phase is most likely to ship (SPEC §6).
 */

import { addStudyDays, studyDayKey, studyDayStart, studyDaysBetween } from './day';
import type { FsrsStateName } from './fsrs';
import { Grade } from './schemas';

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** The `reviews` columns these metrics read. Nothing here needs the rest. */
export type ReviewLogEntry = {
  rating: number;
  reviewed_at: string;
  state_before: FsrsStateName;
  /** Non-null means the rating was undone; `countable` drops those rows. */
  undone_at?: string | null;
  stability_after?: number | null;
  difficulty_after?: number | null;
};

/** The `cards` columns these metrics read. */
export type ProgressCard = {
  fsrs_state: FsrsStateName;
  stability?: number | null;
  difficulty?: number | null;
};

declare const counted: unique symbol;

/**
 * A review log with undone ratings already removed.
 *
 * The brand is the point: every metric below takes this type, and the only way
 * to obtain one is `countable`, which does the filtering. A raw array does not
 * type-check, so the filter cannot be forgotten in a new call site.
 */
export type CountedReviews = readonly ReviewLogEntry[] & { readonly [counted]: true };

/** Drop undone ratings. The one door into every metric in this file. */
export function countable<T extends ReviewLogEntry>(rows: readonly T[]): CountedReviews {
  return rows.filter(row => row.undone_at == null) as unknown as CountedReviews;
}

/** A half-open-ish window: `from` inclusive, `to` inclusive, `to` defaults to now-ish. */
export type MetricWindow = { from: Date; to?: Date };

/** A percentage, or `null` when there is nothing to divide by. */
export function percentage(part: number, whole: number): number | null {
  return whole === 0 ? null : (part / whole) * 100;
}

function mean(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  let sum = 0;
  for (const value of values) sum += value;
  return sum / values.length;
}

function inWindow(row: ReviewLogEntry, from: number, to: number): boolean {
  const at = new Date(row.reviewed_at).getTime();
  return at >= from && at <= to;
}

// ---------------------------------------------------------------------------
// Days and streaks
// ---------------------------------------------------------------------------

/**
 * Review counts per study day, keyed `YYYY-MM-DD`.
 *
 * This is the client's transcription of the `review_day_counts` RPC, and
 * `src/test/stats.test.ts` asserts the two agree — including across a DST
 * transition, which is where a hand-rolled bucketer quietly disagrees.
 */
export function dayCounts(rows: CountedReviews, timeZone: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const key = studyDayKey(new Date(row.reviewed_at), timeZone);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return counts;
}

export type Streaks = {
  /** Days in a row up to today. */
  current: number;
  /** The best run ever, which may be the current one. */
  longest: number;
};

/**
 * A day counts towards a streak if it holds at least one review (SPEC §4.4).
 *
 * Today not yet reviewed does **not** break the current streak — the day is not
 * over, and a counter that resets at 04:00 every morning would be a lie for
 * sixteen hours a day. Yesterday not reviewed does break it: that chain really
 * is broken.
 */
export function streaks(dayKeys: readonly string[], today: string): Streaks {
  // Lexical order is chronological order for `YYYY-MM-DD`.
  const days = [...new Set(dayKeys)].sort();

  let longest = 0;
  let run = 0;
  let previous: string | undefined;
  for (const day of days) {
    run = previous !== undefined && studyDaysBetween(previous, day) === 1 ? run + 1 : 1;
    if (run > longest) longest = run;
    previous = day;
  }

  const seen = new Set(days);
  let cursor = seen.has(today) ? today : addStudyDays(today, -1);
  let current = 0;
  while (seen.has(cursor)) {
    current += 1;
    cursor = addStudyDays(cursor, -1);
  }

  return { current, longest };
}

// ---------------------------------------------------------------------------
// Retention
// ---------------------------------------------------------------------------

/** Hard or better is a successful recall; Again is not (SPEC §4.4). */
export const RECALLED_FROM: number = Grade.Hard;

export type RetentionBucket = {
  reviewed: number;
  recalled: number;
  /** 0–100, or `null` when nothing was reviewed in this bucket. */
  percent: number | null;
};

export type Retention = {
  overall: RetentionBucket;
  /**
   * Split by the state the card was in *before* the review. 95% on new cards and
   * 95% on mature ones mean opposite things, and an unsplit figure hides which
   * one you have.
   */
  byState: Record<FsrsStateName, RetentionBucket>;
};

type Tally = { reviewed: number; recalled: number };

function finish(tally: Tally): RetentionBucket {
  return {
    reviewed: tally.reviewed,
    recalled: tally.recalled,
    percent: percentage(tally.recalled, tally.reviewed),
  };
}

export function retention(rows: CountedReviews, window: MetricWindow): Retention {
  const from = window.from.getTime();
  const to = window.to?.getTime() ?? Number.POSITIVE_INFINITY;

  const overall: Tally = { reviewed: 0, recalled: 0 };
  // Written out rather than built from FSRS_STATES so that every key is present
  // under `noUncheckedIndexedAccess` without a non-null assertion.
  const byState: Record<FsrsStateName, Tally> = {
    new: { reviewed: 0, recalled: 0 },
    learning: { reviewed: 0, recalled: 0 },
    review: { reviewed: 0, recalled: 0 },
    relearning: { reviewed: 0, recalled: 0 },
  };

  for (const row of rows) {
    if (!inWindow(row, from, to)) continue;
    const recalled = row.rating >= RECALLED_FROM ? 1 : 0;
    overall.reviewed += 1;
    overall.recalled += recalled;
    const bucket = byState[row.state_before];
    bucket.reviewed += 1;
    bucket.recalled += recalled;
  }

  return {
    overall: finish(overall),
    byState: {
      new: finish(byState.new),
      learning: finish(byState.learning),
      review: finish(byState.review),
      relearning: finish(byState.relearning),
    },
  };
}

// ---------------------------------------------------------------------------
// Card states, memory strength, and its trend
// ---------------------------------------------------------------------------

export type StateDistribution = {
  counts: Record<FsrsStateName, number>;
  total: number;
};

export function stateDistribution(cards: readonly ProgressCard[]): StateDistribution {
  const counts: Record<FsrsStateName, number> = {
    new: 0,
    learning: 0,
    review: 0,
    relearning: 0,
  };
  for (const card of cards) counts[card.fsrs_state] += 1;
  return { counts, total: cards.length };
}

export type MemoryStrength = {
  /** Mean FSRS stability in days, over cards that have any. `null` on day one. */
  stability: number | null;
  /** Mean FSRS difficulty, 1–10. */
  difficulty: number | null;
  /** How many cards the means are over — the denominator, shown in the UI. */
  cards: number;
};

/** Means over cards that have been seen; a `new` card has no memory state yet. */
export function memoryStrength(cards: readonly ProgressCard[]): MemoryStrength {
  const stabilities: number[] = [];
  const difficulties: number[] = [];
  let seen = 0;
  for (const card of cards) {
    if (card.fsrs_state === 'new') continue;
    seen += 1;
    if (typeof card.stability === 'number') stabilities.push(card.stability);
    if (typeof card.difficulty === 'number') difficulties.push(card.difficulty);
  }
  return {
    stability: mean(stabilities),
    difficulty: mean(difficulties),
    cards: seen,
  };
}

export type Trend = {
  recent: number | null;
  earlier: number | null;
  /** `recent - earlier`, or `null` if either half has no data to compare. */
  delta: number | null;
};

export type MemoryTrend = {
  stability: Trend;
  difficulty: Trend;
  /** Where the window was cut in two — the UI says so rather than implying more. */
  splitAt: Date;
};

/**
 * Which way memory strength is moving, from the log alone.
 *
 * The window is cut in half and the post-review stability and difficulty of each
 * half are averaged. This is a statement about *the cards you reviewed*, not
 * about the whole collection, and the UI labels it that way — a trend line
 * fitted to a collection that is also growing would be a different, and much
 * less honest, number.
 */
export function memoryTrend(
  rows: CountedReviews,
  window: Required<MetricWindow>,
): MemoryTrend {
  const from = window.from.getTime();
  const to = window.to.getTime();
  const splitAt = new Date(Math.round((from + to) / 2));
  const split = splitAt.getTime();

  const recent = { stability: [] as number[], difficulty: [] as number[] };
  const earlier = { stability: [] as number[], difficulty: [] as number[] };

  for (const row of rows) {
    if (!inWindow(row, from, to)) continue;
    const half = new Date(row.reviewed_at).getTime() >= split ? recent : earlier;
    if (typeof row.stability_after === 'number') half.stability.push(row.stability_after);
    if (typeof row.difficulty_after === 'number') {
      half.difficulty.push(row.difficulty_after);
    }
  }

  const trend = (a: readonly number[], b: readonly number[]): Trend => {
    const recentMean = mean(a);
    const earlierMean = mean(b);
    return {
      recent: recentMean,
      earlier: earlierMean,
      delta:
        recentMean === null || earlierMean === null ? null : recentMean - earlierMean,
    };
  };

  return {
    stability: trend(recent.stability, earlier.stability),
    difficulty: trend(recent.difficulty, earlier.difficulty),
    splitAt,
  };
}

// ---------------------------------------------------------------------------
// Due forecast
// ---------------------------------------------------------------------------

export type ForecastCard = { due: string; fsrs_state: FsrsStateName };

export type ForecastDay = {
  day: string;
  learning: number;
  review: number;
  relearning: number;
  /**
   * Only ever non-zero on day 0. An unseen card has no scheduled date — its
   * `due` is its creation time — so projecting introductions across the next
   * thirty days would be inventing a number (SPEC §13 (4)).
   */
  new: number;
  total: number;
};

/**
 * What each of the next `days` study days costs, bucketed by `studyDayKey`.
 *
 * Overdue cards land on day 0 rather than on the day they were scheduled for:
 * they are due *now*, and day 0 has to equal what `/practice` would serve this
 * minute or the forecast contradicts the button next to it. `newToday` is the
 * caller's new-card allowance, already capped by the daily limit (§6).
 */
export function forecast(
  cards: readonly ForecastCard[],
  from: Date,
  days: number,
  options: { timeZone: string; newToday?: number },
): ForecastDay[] {
  const { timeZone, newToday = 0 } = options;
  const firstDay = studyDayKey(from, timeZone);

  const offsets = new Map<string, number>();
  const buckets: ForecastDay[] = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = addStudyDays(firstDay, offset);
    offsets.set(day, offset);
    buckets.push({ day, learning: 0, review: 0, relearning: 0, new: 0, total: 0 });
  }

  const today = buckets[0];
  if (today) today.new = Math.max(0, newToday);

  for (const card of cards) {
    // Counted through `newToday`, under the cap, rather than through `due`.
    if (card.fsrs_state === 'new') continue;
    const dueAt = new Date(card.due).getTime();
    const key =
      dueAt <= from.getTime() ? firstDay : studyDayKey(new Date(dueAt), timeZone);
    const offset = offsets.get(key);
    if (offset === undefined) continue; // beyond the horizon
    const bucket = buckets[offset];
    if (bucket) bucket[card.fsrs_state] += 1;
  }

  for (const bucket of buckets) {
    bucket.total = bucket.learning + bucket.review + bucket.relearning + bucket.new;
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Heatmap
// ---------------------------------------------------------------------------

/** How many days the heatmap shows. 365 = 52 weeks and one day, hence 53 columns. */
export const HEATMAP_DAYS = 365;

export type HeatmapLevel = 0 | 1 | 2 | 3 | 4;

export type HeatmapCell = {
  /** `null` for padding: before the window opens, and after today. */
  day: string | null;
  count: number;
  level: HeatmapLevel;
};

export type HeatmapGrid = {
  /** Column-major — `columns[week][weekday]`, seven rows, weeks left to right. */
  columns: HeatmapCell[][];
  /** `YYYY-MM` labels for the top axis, at the column each month first appears. */
  months: { month: string; column: number }[];
  first: string;
  last: string;
  total: number;
  /** Days with at least one review — the streak's raw material. */
  activeDays: number;
  busiest: number;
  /** Minimum count for levels 1–4; see `intensityThresholds`. */
  thresholds: [number, number, number, number];
};

/** Weekday of a study day, 0 = Sunday. Uses day.ts so there is one date parser. */
function weekdayOf(dayKey: string): number {
  return studyDayStart(dayKey, 'UTC').getUTCDay();
}

function quantile(sorted: readonly number[], q: number): number {
  if (sorted.length === 0) return 0;
  const position = (sorted.length - 1) * q;
  const lower = Math.floor(position);
  const low = sorted[lower] ?? 0;
  const high = sorted[Math.ceil(position)] ?? low;
  return low + (high - low) * (position - lower);
}

/**
 * The minimum count for each of levels 1–4, relative to the user's own history.
 *
 * Fixed thresholds cannot serve both someone doing fifteen reviews a day and
 * someone doing three hundred: one gets a uniformly pale year, the other a
 * uniformly dark one, and in both cases the chart stops carrying information.
 * So the scale is the user's own 90th-percentile day, split into four bands,
 * with the top band open-ended. The percentile rather than the maximum, because
 * one 400-review cram session should not flatten the other 364 days.
 */
export function intensityThresholds(
  counts: readonly number[],
): [number, number, number, number] {
  const active = counts.filter(count => count > 0).sort((a, b) => a - b);
  if (active.length === 0) return [1, 2, 3, 4];
  const peak = quantile(active, 0.9);
  const second = Math.max(2, Math.ceil(peak * 0.4));
  const third = Math.max(second + 1, Math.ceil(peak * 0.7));
  const fourth = Math.max(third + 1, Math.ceil(peak));
  return [1, second, third, fourth];
}

export function intensityLevel(
  count: number,
  [first, second, third, fourth]: readonly [number, number, number, number],
): HeatmapLevel {
  if (count <= 0) return 0;
  if (count >= fourth) return 4;
  if (count >= third) return 3;
  if (count >= second) return 2;
  return count >= first ? 1 : 0;
}

/**
 * The grid the CSS heatmap renders: seven rows (Sunday first), one column per
 * week, `days` days ending on `today`.
 *
 * The window rarely starts on a Sunday, so the first column is partial and its
 * leading cells are padding — the commonest way to get a heatmap wrong is to
 * drop that padding and shift every count onto the wrong weekday for a year.
 * The last column is partial for the same reason at the other end: the days
 * after today have not happened.
 */
export function heatmapGrid(
  counts: ReadonlyMap<string, number>,
  today: string,
  days: number = HEATMAP_DAYS,
): HeatmapGrid {
  const span = Math.max(1, Math.trunc(days));
  const first = addStudyDays(today, -(span - 1));
  const leading = weekdayOf(first);
  const columnCount = Math.ceil((leading + span) / 7);

  const window: number[] = [];
  for (let offset = 0; offset < span; offset += 1) {
    window.push(counts.get(addStudyDays(first, offset)) ?? 0);
  }
  const thresholds = intensityThresholds(window);

  const columns: HeatmapCell[][] = [];
  const months: { month: string; column: number }[] = [];
  let total = 0;
  let activeDays = 0;
  let busiest = 0;
  let lastMonth = '';

  for (let column = 0; column < columnCount; column += 1) {
    const cells: HeatmapCell[] = [];
    for (let row = 0; row < 7; row += 1) {
      const offset = column * 7 + row - leading;
      if (offset < 0 || offset >= span) {
        cells.push({ day: null, count: 0, level: 0 });
        continue;
      }
      const day = addStudyDays(first, offset);
      const count = window[offset] ?? 0;
      total += count;
      if (count > 0) activeDays += 1;
      if (count > busiest) busiest = count;

      const month = day.slice(0, 7);
      if (month !== lastMonth) {
        months.push({ month, column });
        lastMonth = month;
      }

      cells.push({ day, count, level: intensityLevel(count, thresholds) });
    }
    columns.push(cells);
  }

  return {
    columns,
    months,
    first,
    last: today,
    total,
    activeDays,
    busiest,
    thresholds,
  };
}
