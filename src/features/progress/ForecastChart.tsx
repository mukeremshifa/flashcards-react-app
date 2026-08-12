import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { studyDayStart } from '@/lib/day';
import type { ForecastDay } from '@/lib/progress';

/**
 * The next thirty days, stacked (SPEC §4.4).
 *
 * This module is the only thing in the app that imports Recharts, and it is
 * loaded through `React.lazy` from ProgressPage so the library stays out of the
 * main bundle — the chart is worth its weight on this page and nowhere else.
 *
 * Series colours are the theme's grade tokens, which already mean "this went
 * badly" through to "this went well" on the rating buttons: relearning is the
 * Again colour because that is literally how a card gets there.
 */

const SERIES = [
  { key: 'relearning', label: 'Relearning', fill: 'var(--color-grade-again)' },
  { key: 'learning', label: 'Learning', fill: 'var(--color-grade-hard)' },
  { key: 'review', label: 'Review', fill: 'var(--color-grade-good)' },
  { key: 'new', label: 'New', fill: 'var(--color-primary)' },
] as const;

export function ForecastChart({
  buckets,
  timeZone,
}: {
  buckets: ForecastDay[];
  timeZone: string;
}) {
  const data = buckets.map((bucket, index) => ({
    ...bucket,
    label:
      index === 0
        ? 'Today'
        : new Intl.DateTimeFormat(undefined, {
            timeZone,
            day: 'numeric',
            month: 'short',
          }).format(studyDayStart(bucket.day, timeZone)),
  }));

  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -20 }}>
        <CartesianGrid stroke="var(--color-border)" vertical={false} />
        <XAxis
          dataKey="label"
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
          tickLine={false}
          axisLine={{ stroke: 'var(--color-border)' }}
          // Every fifth day: thirty labels at this width are unreadable.
          interval={4}
        />
        <YAxis
          allowDecimals={false}
          tick={{ fill: 'var(--color-muted-foreground)', fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <Tooltip
          cursor={{ fill: 'var(--color-muted)' }}
          contentStyle={{
            background: 'var(--color-popover)',
            color: 'var(--color-popover-foreground)',
            border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-md)',
            fontSize: 12,
          }}
        />
        <Legend
          wrapperStyle={{ fontSize: 12, color: 'var(--color-muted-foreground)' }}
          iconType="square"
        />
        {SERIES.map(series => (
          <Bar
            key={series.key}
            dataKey={series.key}
            name={series.label}
            stackId="due"
            fill={series.fill}
            radius={series.key === 'new' ? [3, 3, 0, 0] : undefined}
          />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}
