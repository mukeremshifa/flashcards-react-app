import { cn } from '@/lib/utils';

/**
 * One legend for both charts on the page.
 *
 * P3 established the rule for the heatmap: a chart must still carry its
 * information with the colour taken away. Recharts' own `<Legend>` does name its
 * series, but it renders inside the responsive container, styles itself through
 * a wrapper object rather than the theme, and disagrees with the hand-rolled
 * legend `StateDistribution` was already using — three renderings of the same
 * idea. This is the one, in the app's own type and spacing, outside the chart.
 *
 * The swatch is `aria-hidden`; the name is text. That is the whole point.
 */

export type LegendItem = {
  key: string;
  label: string;
  /** A `var(--color-…)` string — see `src/lib/grade-tokens.ts`. */
  fill: string;
  /** Optional figure, e.g. the count in that series. */
  value?: number;
};

export function ChartLegend({
  items,
  className,
}: {
  items: readonly LegendItem[];
  className?: string;
}) {
  return (
    <ul
      className={cn(
        'text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs',
        className,
      )}
    >
      {items.map(item => (
        <li key={item.key} className="flex items-center gap-1.5">
          <span
            aria-hidden
            className="size-2 rounded-xs"
            style={{ backgroundColor: item.fill }}
          />
          {item.label}
          {item.value !== undefined && (
            <span className="text-foreground font-mono tabular-nums">{item.value}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
