import { useMemo, useState } from 'react';

import { Button } from '@/components/ui/button';
import {
  Card,
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
      <span className="font-medium tabular-nums">{Math.round(bucket.percent)}%</span>
      <span className="text-muted-foreground ml-1.5 text-xs tabular-nums">
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
        <CardTitle>Retention</CardTitle>
        <CardDescription>Reviews graded Hard or better.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex gap-1">
          {WINDOWS.map(window => (
            <Button
              key={window}
              size="sm"
              variant={window === days ? 'secondary' : 'ghost'}
              aria-pressed={window === days}
              onClick={() => setDays(window)}
            >
              {window}d
            </Button>
          ))}
        </div>

        {isPending || !stats ? (
          <Skeleton className="h-40 w-full" />
        ) : stats.overall.reviewed === 0 ? (
          <p className="text-muted-foreground text-sm">
            No reviews in the last {plural(days, 'day')}. Retention appears once there is
            something to measure.
          </p>
        ) : (
          <>
            <div className="flex items-baseline justify-between border-b pb-3">
              <span className="text-sm">All reviews</span>
              <span className="text-lg">
                <Percent bucket={stats.overall} />
              </span>
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
