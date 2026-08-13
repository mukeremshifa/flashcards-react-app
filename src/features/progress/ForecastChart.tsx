import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';

import { studyDayStart } from '@/lib/day';
import { STATE_TOKEN } from '@/lib/grade-tokens';
import type { ForecastDay } from '@/lib/progress';
import { ChartLegend } from './ChartLegend';

/**
 * The next thirty days, stacked (SPEC §4.4).
 *
 * This module is the only thing in the app that imports Recharts, and it is
 * loaded through `React.lazy` from ProgressPage so the library stays out of the
 * main bundle — the chart is worth its weight on this page and nowhere else.
 *
 * Series colours are the theme's grade tokens, which already mean "this went
 * badly" through to "this went well" on the rating buttons — read from
 * `grade-tokens.ts` so this file and `StateDistribution` cannot drift apart.
 *
 * The legend is rendered outside the chart (`ChartLegend`) rather than by
 * Recharts. It names every series in text, which is the rule P3 set for the
 * heatmap and which applies here for the same reason: stacked bars four series
 * deep are unreadable in greyscale otherwise.
 */

const FORECAST_SERIES = [
  { key: 'relearning', label: 'Relearning', fill: STATE_TOKEN.relearning },
  { key: 'learning', label: 'Learning', fill: STATE_TOKEN.learning },
  { key: 'review', label: 'Review', fill: STATE_TOKEN.review },
  { key: 'new', label: 'New', fill: STATE_TOKEN.new },
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
    <div className="space-y-3">
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
          {FORECAST_SERIES.map(series => (
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

      <ChartLegend items={FORECAST_SERIES} />
    </div>
  );
}
