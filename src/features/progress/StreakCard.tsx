import { useMemo } from 'react';
import { FlameIcon } from 'lucide-react';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { plural } from '@/lib/format';
import { streaks } from '@/lib/progress';
import type { ReviewHistory } from '@/lib/queries';

/**
 * The one honest motivator in the product (SPEC §4.4): a day counts if it holds
 * at least one review, and nothing else is dressed up as a reward.
 *
 * The empty state matters more here than anywhere. On day one there is no
 * streak, and a big grey zero framed as an achievement reads as failure — so it
 * says what makes the number move instead.
 */
export function StreakCard({
  history,
  isPending,
}: {
  history: ReviewHistory | undefined;
  isPending: boolean;
}) {
  const streak = useMemo(
    () => (history ? streaks([...history.counts.keys()], history.today) : null),
    [history],
  );

  const reviewedToday = history ? (history.counts.get(history.today) ?? 0) > 0 : false;

  return (
    <Card className="py-5">
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
          <FlameIcon className="size-4" aria-hidden />
          Streak
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending || !streak ? (
          <Skeleton className="h-9 w-24" />
        ) : history?.total === 0 ? (
          <>
            <p className="text-3xl font-semibold tabular-nums">0</p>
            <p className="text-muted-foreground mt-1 text-sm">
              Rate one card and the streak starts today.
            </p>
          </>
        ) : (
          <>
            <p className="text-3xl font-semibold tabular-nums">
              {streak.current}
              <span className="text-muted-foreground ml-1.5 text-base font-normal">
                {streak.current === 1 ? 'day' : 'days'}
              </span>
            </p>
            <p className="text-muted-foreground mt-1 text-sm">
              Longest {plural(streak.longest, 'day')} ·{' '}
              {reviewedToday
                ? 'today is counted'
                : streak.current > 0
                  ? 'practise today to keep it'
                  : 'practise today to start again'}
            </p>
          </>
        )}
      </CardContent>
    </Card>
  );
}
