/**
 * Display helpers. Nothing here decides anything — if a number is wrong, the bug
 * is in fsrs.ts or day.ts, not in this file.
 */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const MONTH = 30 * DAY;
const YEAR = 365 * DAY;

/**
 * A scheduling interval, in the compact form the rating buttons use: "10m",
 * "4d", "3mo". Rounded generously — nobody rates a card differently because the
 * answer was 4.3 days rather than 4.
 */
export function formatInterval(ms: number): string {
  const value = Math.max(0, ms);
  if (value < MINUTE) return '<1m';
  if (value < HOUR) return `${Math.round(value / MINUTE)}m`;
  if (value < DAY) return `${Math.round(value / HOUR)}h`;
  if (value < MONTH) return `${Math.round(value / DAY)}d`;
  if (value < YEAR) return `${Math.round((value / MONTH) * 10) / 10}mo`;
  return `${Math.round((value / YEAR) * 10) / 10}y`;
}

/** "in 4d" / "now" — for a due timestamp rather than a raw interval. */
export function formatDueIn(due: Date, now: Date): string {
  const delta = due.getTime() - now.getTime();
  if (delta <= 0) return 'now';
  return `in ${formatInterval(delta)}`;
}

/**
 * The same thing in words, for the empty state that matters most: "next card in
 * about 4 hours". Long form because it is prose, not a button label.
 */
export function formatDurationWords(ms: number): string {
  const value = Math.max(0, ms);
  if (value < MINUTE) return 'less than a minute';
  if (value < HOUR) return plural(Math.round(value / MINUTE), 'minute');
  if (value < DAY) return plural(Math.round(value / HOUR), 'hour');
  return plural(Math.round(value / DAY), 'day');
}

export function plural(count: number, noun: string, pluralForm?: string): string {
  return `${count} ${count === 1 ? noun : (pluralForm ?? `${noun}s`)}`;
}

/** A calendar date in the user's zone, e.g. "12 Aug 2026". */
export function formatDate(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(instant);
}

/** Date and time in the user's zone, for "last reviewed" style detail. */
export function formatDateTime(instant: Date, timeZone: string): string {
  return new Intl.DateTimeFormat(undefined, {
    timeZone,
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}

/** Trim card text down to a table cell without cutting mid-word where avoidable. */
export function truncate(text: string, max: number): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= max) return collapsed;
  const cut = collapsed.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return `${(lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}
