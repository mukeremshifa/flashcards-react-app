import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { addStudyDays, studyDayStart } from '@/lib/day';
import { plural } from '@/lib/format';
import { FSRS_STATES, type FsrsStateName } from '@/lib/fsrs';
import { retention, type RetentionBucket } from '@/lib/progress';
import type { RetentionHistory } from '@/lib/queries';

/**
 * Percentage of reviews graded Hard or better, windowed 7 / 30 / 90 days and
 * split by the state the card was in beforehand (SPEC §4.4).
 *
 * The split is the whole point: 95% on cards you saw for the first time and 95%
 * on mature cards mean opposite things, and one blended figure hides which one
 * you have. So does a percentage with no denominator — 100% over four reviews
 * is not a fact about your memory, and this shows the four.
 *
 * P6 gave the overall figure display weight and moved the window buttons into
 * the header. The per-state split stays exactly as legible as it was: it is the
 * honest part, and burying it under one big number would undo the reason this
 * card is split at all.
 */

const WINDOWS = [7, 30, 90] as const;

/** Below this, a percentage is noise. Said out loud rather than hidden. */
const SMALL_SAMPLE = 20;

const STATE_LABELS: Record<FsrsStateName, string> = {
  new: 'First sight',
  learning: 'Learning',
  review: 'Review',
  relearning: 'Relearning',
};

function Percent({ bucket }: { bucket: RetentionBucket }) {
  if (bucket.percent === null) {
    return <span className="text-muted-foreground">no reviews</span>;
  }
  return (
    <>
      <span className="font-mono font-medium tabular-nums">
        {Math.round(bucket.percent)}%
      </span>
      <span className="text-muted-foreground ml-1.5 font-mono text-xs tabular-nums">
        {bucket.recalled}/{bucket.reviewed}
      </span>
    </>
  );
}

export function RetentionCard({
  history,
  isPending,
}: {
  history: RetentionHistory | undefined;
  isPending: boolean;
}) {
  const [days, setDays] = useState<(typeof WINDOWS)[number]>(30);

  const stats = useMemo(() => {
    if (!history) return null;
    const from = studyDayStart(
      addStudyDays(history.today, -(days - 1)),
      history.timeZone,
    );
    return retention(history.reviews, { from, to: history.to });
  }, [history, days]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground text-sm font-medium">
          Retention
        </CardTitle>
        <CardDescription>Reviews graded Hard or better.</CardDescription>
        <CardAction>
          <div className="bg-muted flex gap-0.5 rounded-md p-0.5">
            {WINDOWS.map(window => (
              <Button
                key={window}
                size="xs"
                variant={window === days ? 'outline' : 'ghost'}
                aria-pressed={window === days}
                className="font-mono"
                onClick={() => setDays(window)}
              >
                {window}d
              </Button>
            ))}
          </div>
        </CardAction>
      </CardHeader>

      <CardContent className="space-y-4">
        {isPending || !stats ? (
          <Skeleton className="h-40 w-full" />
        ) : stats.overall.reviewed === 0 ? (
          <p className="text-muted-foreground text-sm">
            No reviews in the last {plural(days, 'day')}. Retention appears once there is
            something to measure.
          </p>
        ) : (
          <>
            <div className="border-b pb-4">
              <p className="font-mono text-4xl leading-none tabular-nums">
                {stats.overall.percent === null
                  ? '—'
                  : `${Math.round(stats.overall.percent)}%`}
              </p>
              <p className="text-muted-foreground mt-2 text-sm">
                across{' '}
                <span className="font-mono tabular-nums">{stats.overall.reviewed}</span>{' '}
                {stats.overall.reviewed === 1 ? 'review' : 'reviews'} in {days} days
              </p>
            </div>

            <dl className="space-y-2 text-sm">
              {FSRS_STATES.map(state => (
                <div key={state} className="flex items-baseline justify-between">
                  <dt className="text-muted-foreground">{STATE_LABELS[state]}</dt>
                  <dd>
                    <Percent bucket={stats.byState[state]} />
                  </dd>
                </div>
              ))}
            </dl>

            {stats.overall.reviewed < SMALL_SAMPLE && (
              <p className="text-muted-foreground text-xs">
                {plural(stats.overall.reviewed, 'review')} is a small sample — treat these
                as provisional.
              </p>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}
