/**
 * "What day is it?" — one implementation, used everywhere.
 *
 * SPEC §6: the day boundary is 04:00 in the user's timezone, not midnight and not
 * UTC. Late-night studying belongs to the previous day, and a streak computed in
 * UTC is wrong for most of the world.
 *
 * P1 needs this for the daily new-card cap; P3's heatmap, streak, and retention
 * windows must use the same helpers. Two implementations of "what day is it"
 * will disagree, and the disagreement will look like a scheduling bug.
 *
 * No date library: `Intl.DateTimeFormat` already knows every zone's DST history,
 * and the only hard part is the inverse direction (wall clock -> instant), which
 * is handled by `zonedTimeToUtc` below.
 */

export const DAY_BOUNDARY_HOUR = 4;

const MS_PER_DAY = 86_400_000;

export type ZonedParts = {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
  hour: number;
  minute: number;
  second: number;
};

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
    formatterCache.set(timeZone, formatter);
  }
  return formatter;
}

/** True if the runtime's ICU data knows this zone. */
export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

/**
 * A usable IANA zone name. A profile can hold anything a past client wrote, and a
 * bad zone must not take the whole app down — UTC is a wrong-but-working answer.
 */
export function resolveTimeZone(timeZone: string | null | undefined): string {
  if (timeZone && isValidTimeZone(timeZone)) return timeZone;
  return 'UTC';
}

/** The browser's zone, used to pre-fill settings for a new account. */
export function detectTimeZone(): string {
  return resolveTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone);
}

/** Wall-clock reading of an instant in a zone. */
export function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const read = (type: Intl.DateTimeFormatPartTypes): number => {
    const value = parts.find(part => part.type === type)?.value;
    return value === undefined ? 0 : Number(value);
  };
  return {
    year: read('year'),
    month: read('month'),
    day: read('day'),
    // 'h23' still renders midnight as 24 in some ICU versions.
    hour: read('hour') % 24,
    minute: read('minute'),
    second: read('second'),
  };
}

/** Offset of `timeZone` from UTC at `instant`, in ms (east of UTC is positive). */
function zoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = zonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );
  // Drop sub-second precision on both sides so the difference is exact.
  return asIfUtc - Math.floor(instant.getTime() / 1000) * 1000;
}

/**
 * Inverse of `zonedParts`: the instant at which a zone's clocks read these parts.
 *
 * Two passes, because the offset needed to convert depends on the answer. The
 * first guess uses the offset in effect at the naive timestamp; if that lands on
 * the other side of a DST transition the second pass corrects it. Times that do
 * not exist (the spring-forward gap) resolve to the instant the clocks jump to,
 * which is the only sensible reading of "04:00 on a day with no 04:00".
 */
export function zonedTimeToUtc(parts: ZonedParts, timeZone: string): Date {
  const naive = Date.UTC(
    parts.year,
    parts.month - 1,
    parts.day,
    parts.hour,
    parts.minute,
    parts.second,
  );

  const firstGuess = naive - zoneOffsetMs(new Date(naive), timeZone);
  const refinedOffset = zoneOffsetMs(new Date(firstGuess), timeZone);
  const second = naive - refinedOffset;
  if (second === firstGuess) return new Date(second);

  // The two passes disagree only near a transition. Keep whichever round-trips;
  // if neither does (a skipped wall-clock time), the later instant is the moment
  // the clocks reached that reading.
  const roundTrips = (candidate: number): boolean => {
    const back = zonedParts(new Date(candidate), timeZone);
    return (
      back.year === parts.year &&
      back.month === parts.month &&
      back.day === parts.day &&
      back.hour === parts.hour &&
      back.minute === parts.minute
    );
  };
  if (roundTrips(second)) return new Date(second);
  if (roundTrips(firstGuess)) return new Date(firstGuess);
  return new Date(Math.max(firstGuess, second));
}

/** `YYYY-MM-DD` for a wall-clock date, zero-padded. */
function toDateKey(year: number, month: number, day: number): string {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * The study day an instant belongs to, as `YYYY-MM-DD`.
 *
 * 03:59 local belongs to the previous calendar date — that is the whole point of
 * the 04:00 boundary.
 */
export function studyDayKey(instant: Date, timeZone: string): string {
  const parts = zonedParts(instant, timeZone);
  if (parts.hour >= DAY_BOUNDARY_HOUR) {
    return toDateKey(parts.year, parts.month, parts.day);
  }
  // Step back a calendar day using UTC arithmetic on the *wall-clock* date, which
  // has no DST of its own, so this is always exactly one date earlier.
  const previous = new Date(
    Date.UTC(parts.year, parts.month - 1, parts.day) - MS_PER_DAY,
  );
  return toDateKey(
    previous.getUTCFullYear(),
    previous.getUTCMonth() + 1,
    previous.getUTCDate(),
  );
}

/** The instant a study day (`YYYY-MM-DD`) begins: 04:00 local on that date. */
export function studyDayStart(dayKey: string, timeZone: string): Date {
  const [year, month, day] = dayKey.split('-').map(Number);
  if (year === undefined || month === undefined || day === undefined) {
    throw new Error(`invalid study day key: ${dayKey}`);
  }
  return zonedTimeToUtc(
    { year, month, day, hour: DAY_BOUNDARY_HOUR, minute: 0, second: 0 },
    timeZone,
  );
}

/** The instant the study day containing `instant` began. */
export function startOfStudyDay(instant: Date, timeZone: string): Date {
  return studyDayStart(studyDayKey(instant, timeZone), timeZone);
}

/** The instant the next study day begins — i.e. when today's new-card cap resets. */
export function startOfNextStudyDay(instant: Date, timeZone: string): Date {
  return studyDayStart(addStudyDays(studyDayKey(instant, timeZone), 1), timeZone);
}

/** Shift a `YYYY-MM-DD` key by whole days. Calendar arithmetic, DST-free. */
export function addStudyDays(dayKey: string, days: number): string {
  const start = studyDayStart(dayKey, 'UTC');
  const shifted = new Date(start.getTime() + days * MS_PER_DAY);
  return toDateKey(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
  );
}

/** Whole study days between two keys (`b - a`). */
export function studyDaysBetween(a: string, b: string): number {
  return Math.round(
    (studyDayStart(b, 'UTC').getTime() - studyDayStart(a, 'UTC').getTime()) / MS_PER_DAY,
  );
}
