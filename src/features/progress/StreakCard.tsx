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
 *
 * P6 promoted it to one of the two cards that lead the page, so the number is
 * set at display size in the mono face. Mono because the digits are the point:
 * tabular figures do not reflow as the count crosses from 9 to 10.
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
    <Card>
      <CardHeader>
        <CardTitle className="text-muted-foreground flex items-center gap-1.5 text-sm font-medium">
          <FlameIcon className="size-4" aria-hidden />
          Streak
        </CardTitle>
      </CardHeader>
      <CardContent>
        {isPending || !streak ? (
          <Skeleton className="h-11 w-28" />
        ) : history?.total === 0 ? (
          <>
            <p className="font-mono text-4xl leading-none tabular-nums">0</p>
            <p className="text-muted-foreground mt-3 text-sm">
              Rate one card and the streak starts today.
            </p>
          </>
        ) : (
          <>
            <p className="font-mono text-4xl leading-none tabular-nums">
              {streak.current}
              <span className="text-muted-foreground ml-2 font-sans text-base">
                {streak.current === 1 ? 'day' : 'days'}
              </span>
            </p>
            <p className="text-muted-foreground mt-3 text-sm">
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
