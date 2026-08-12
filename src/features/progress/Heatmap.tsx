import { useMemo } from 'react';

import { studyDayStart } from '@/lib/day';
import { formatDate, plural } from '@/lib/format';
import { heatmapGrid, HEATMAP_DAYS } from '@/lib/progress';

/**
 * A year of review counts as a CSS grid — deliberately not a chart library
 * (SPEC §8.1). 53 columns of seven days, one cell per study day.
 *
 * The accessibility problem with this shape is that a wall of coloured squares
 * carries all of its information in colour, which excludes anyone who cannot
 * see it and anyone whose perception of these hues differs from the designer's.
 * So the number lives in each cell's label, not only in its shade, and the
 * summary line above the grid states the totals in words.
 *
 * Colours come from the theme's `--primary`, mixed towards `--muted`. Nothing
 * here hardcodes green: the palette has to survive both themes and it is not
 * this component's business to invent one.
 */

const LEVEL_BACKGROUND = [
  'var(--color-muted)',
  'color-mix(in oklab, var(--color-primary) 28%, var(--color-muted))',
  'color-mix(in oklab, var(--color-primary) 52%, var(--color-muted))',
  'color-mix(in oklab, var(--color-primary) 76%, var(--color-muted))',
  'var(--color-primary)',
] as const;

/** Sunday-first, matching `heatmapGrid`'s row order. */
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;

const CELL = 11;
const GAP = 3;

function monthLabel(month: string): string {
  const [year, index] = month.split('-').map(Number);
  if (year === undefined || index === undefined) return '';
  return new Intl.DateTimeFormat(undefined, { month: 'short', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, index - 1, 1)),
  );
}

export function Heatmap({
  counts,
  today,
  timeZone,
  days = HEATMAP_DAYS,
}: {
  counts: ReadonlyMap<string, number>;
  today: string;
  timeZone: string;
  days?: number;
}) {
  const grid = useMemo(() => heatmapGrid(counts, today, days), [counts, today, days]);
  const columns = grid.columns.length;

  // A month that starts mid-column shares that column with the previous one, and
  // two labels at the same grid position overlap into an unreadable smudge.
  const months = useMemo(
    () =>
      grid.months.filter(
        (entry, index) =>
          index === 0 || entry.column - (grid.months[index - 1]?.column ?? 0) >= 2,
      ),
    [grid.months],
  );

  return (
    <div className="space-y-3">
      <p className="text-muted-foreground text-sm">
        {grid.total === 0
          ? 'No reviews in the last year yet.'
          : `${plural(grid.total, 'review')} on ${plural(grid.activeDays, 'day')}, busiest ${plural(grid.busiest, 'review')}.`}
      </p>

      <div className="overflow-x-auto pb-1">
        <div className="inline-flex gap-2">
          <div
            aria-hidden
            className="text-muted-foreground grid text-[10px] leading-none"
            style={{
              gridTemplateRows: `repeat(7, ${CELL}px)`,
              gap: `${GAP}px`,
              paddingTop: '1.15rem',
            }}
          >
            {WEEKDAYS.map((label, row) => (
              // Every other row only: seven labels at this size is noise.
              <span key={label} className="flex items-center">
                {row % 2 === 1 ? label : ''}
              </span>
            ))}
          </div>

          <div>
            <div
              aria-hidden
              className="text-muted-foreground grid h-[1.15rem] text-[10px] leading-none"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${CELL}px)`,
                columnGap: `${GAP}px`,
              }}
            >
              {months.map(({ month, column }) => (
                <span
                  key={month}
                  className="whitespace-nowrap"
                  style={{ gridColumnStart: column + 1, gridColumnEnd: 'span 5' }}
                >
                  {monthLabel(month)}
                </span>
              ))}
            </div>

            <div
              role="group"
              aria-label={`Reviews per day over the last ${plural(days, 'day')}`}
              className="grid"
              style={{
                gridTemplateColumns: `repeat(${columns}, ${CELL}px)`,
                gridTemplateRows: `repeat(7, ${CELL}px)`,
                gridAutoFlow: 'column',
                gap: `${GAP}px`,
              }}
            >
              {grid.columns.flat().map((cell, index) => {
                if (cell.day === null) {
                  return <span key={`pad-${index}`} aria-hidden />;
                }
                const date = formatDate(studyDayStart(cell.day, timeZone), timeZone);
                const label =
                  cell.count === 0
                    ? `No reviews on ${date}`
                    : `${plural(cell.count, 'review')} on ${date}`;
                return (
                  <span
                    key={cell.day}
                    role="img"
                    aria-label={label}
                    title={label}
                    className="rounded-[2px] ring-black/5 ring-inset dark:ring-white/5"
                    style={{ backgroundColor: LEVEL_BACKGROUND[cell.level] }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      <div className="text-muted-foreground flex items-center gap-1.5 text-xs">
        <span>Fewer</span>
        {LEVEL_BACKGROUND.map((background, level) => (
          <span
            key={level}
            className="inline-block rounded-[2px]"
            style={{ width: CELL, height: CELL, backgroundColor: background }}
            aria-hidden
          />
        ))}
        <span>More</span>
        <span className="ml-1">
          (from 1, {grid.thresholds[1]}, {grid.thresholds[2]}, {grid.thresholds[3]}{' '}
          reviews a day — scaled to your own history)
        </span>
      </div>
    </div>
  );
}
