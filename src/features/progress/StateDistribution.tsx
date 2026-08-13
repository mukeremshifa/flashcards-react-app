import { useMemo } from 'react';
import { TrendingDownIcon, TrendingUpIcon } from 'lucide-react';

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { addStudyDays, studyDayStart } from '@/lib/day';
import { formatInterval, plural } from '@/lib/format';
import { FSRS_STATES, type FsrsStateName } from '@/lib/fsrs';
import { STATE_TOKEN } from '@/lib/grade-tokens';
import { memoryTrend, type Trend } from '@/lib/progress';
import type { CardStates, RetentionHistory } from '@/lib/queries';

/**
 * Where the collection currently sits, and which way its memory strength is
 * moving (SPEC §4.4).
 *
 * The means are over cards, right now. The trend is over *reviews*, because a
 * collection that is also growing has a mean that moves for reasons that have
 * nothing to do with memory — adding fifty cards drops it without anything
 * being forgotten. So the trend compares the two halves of the review window
 * and the label says exactly that, rather than implying a claim the log cannot
 * support.
 */

const TREND_DAYS = 30;

const STATE_LABELS: Record<FsrsStateName, string> = {
  new: 'New',
  learning: 'Learning',
  review: 'Review',
  relearning: 'Relearning',
};

/** FSRS stability is a number of days; the interval formatter already speaks that. */
function formatDays(days: number): string {
  return formatInterval(days * 86_400_000);
}

function TrendNote({
  trend,
  format,
  noun,
}: {
  trend: Trend;
  format: (value: number) => string;
  noun: string;
}) {
  if (trend.recent === null) return null;
  if (trend.delta === null || trend.earlier === null) {
    return (
      <p className="text-muted-foreground text-xs">
        {noun} of cards reviewed recently: {format(trend.recent)}.
      </p>
    );
  }
  const rising = trend.delta >= 0;
  const Icon = rising ? TrendingUpIcon : TrendingDownIcon;
  return (
    <p className="text-muted-foreground flex items-center gap-1 text-xs">
      <Icon className="size-3.5" aria-hidden />
      {noun} of cards reviewed in the last {TREND_DAYS / 2} days: {format(trend.recent)},
      {rising ? ' up from ' : ' down from '}
      {format(trend.earlier)} in the {TREND_DAYS / 2} days before.
    </p>
  );
}

export function StateDistribution({
  states,
  history,
  isPending,
}: {
  states: CardStates | undefined;
  history: RetentionHistory | undefined;
  isPending: boolean;
}) {
  const trend = useMemo(() => {
    if (!history) return null;
    const from = studyDayStart(
      addStudyDays(history.today, -(TREND_DAYS - 1)),
      history.timeZone,
    );
    return memoryTrend(history.reviews, { from, to: history.to });
  }, [history]);

  const distribution = states?.distribution;
  const strength = states?.strength;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Card states</CardTitle>
        <CardDescription>Where your active cards are in the schedule.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-5">
        {isPending || !distribution || !strength ? (
          <Skeleton className="h-44 w-full" />
        ) : distribution.total === 0 ? (
          <p className="text-muted-foreground text-sm">
            No active cards yet. Add or generate a deck and this fills in.
          </p>
        ) : (
          <>
            <div
              className="bg-muted flex h-2.5 overflow-hidden rounded-full"
              role="img"
              aria-label={FSRS_STATES.map(
                state =>
                  `${distribution.counts[state]} ${STATE_LABELS[state].toLowerCase()}`,
              ).join(', ')}
            >
              {FSRS_STATES.map(state => {
                const share = (distribution.counts[state] / distribution.total) * 100;
                return share === 0 ? null : (
                  <span
                    key={state}
                    style={{ width: `${share}%`, backgroundColor: STATE_TOKEN[state] }}
                  />
                );
              })}
            </div>

            <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm sm:grid-cols-4">
              {FSRS_STATES.map(state => (
                <div key={state}>
                  <dt className="text-muted-foreground flex items-center gap-1.5 text-xs">
                    <span
                      aria-hidden
                      className="size-2 rounded-full"
                      style={{ backgroundColor: STATE_TOKEN[state] }}
                    />
                    {STATE_LABELS[state]}
                  </dt>
                  <dd className="mt-0.5 font-mono font-medium tabular-nums">
                    {distribution.counts[state]}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="space-y-2 border-t pt-4">
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Mean stability</span>
                <span className="font-mono font-medium tabular-nums">
                  {strength.stability === null ? '—' : formatDays(strength.stability)}
                  <span className="text-muted-foreground ml-1.5 text-xs">
                    over {plural(strength.cards, 'card')}
                  </span>
                </span>
              </div>
              <div className="flex items-baseline justify-between text-sm">
                <span className="text-muted-foreground">Mean difficulty</span>
                <span className="font-mono font-medium tabular-nums">
                  {strength.difficulty === null
                    ? '—'
                    : `${strength.difficulty.toFixed(1)} / 10`}
                </span>
              </div>

              {trend && (
                <div className="space-y-1 pt-1">
                  <TrendNote
                    trend={trend.stability}
                    format={formatDays}
                    noun="Stability"
                  />
                  <TrendNote
                    trend={trend.difficulty}
                    format={value => value.toFixed(1)}
                    noun="Difficulty"
                  />
                </div>
              )}
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );
}
