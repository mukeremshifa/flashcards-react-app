import { lazy, Suspense } from 'react';
import { Link } from 'react-router-dom';
import { CalendarDaysIcon, PlayIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import {
  useCardStates,
  useDueForecast,
  useRetention,
  useReviewHistory,
} from '@/lib/queries';
import { Heatmap } from './Heatmap';
import { RetentionCard } from './RetentionCard';
import { StateDistribution } from './StateDistribution';
import { StreakCard } from './StreakCard';

/**
 * Assembly, and the one place that decides what an account with no history sees.
 *
 * Every figure below is derived from `reviews` and `cards` (SPEC §13 (4)) — no
 * goals, no XP, no badges. A new account has none of that data, and five empty
 * charts is a worse first impression than one sentence pointing at the practice
 * button, so that is what it gets.
 */

/**
 * Recharts is large and this is the only page that needs it. Lazy here keeps it
 * out of the main bundle and gives P4's code-splitting work its first boundary.
 */
const ForecastChart = lazy(() =>
  import('./ForecastChart').then(module => ({ default: module.ForecastChart })),
);

const FORECAST_DAYS = 30;

export function ProgressPage() {
  const history = useReviewHistory();
  const retention = useRetention(90);
  const forecast = useDueForecast(FORECAST_DAYS);
  const cards = useCardStates();

  const loading = history.isPending || cards.isPending;
  const hasReviews = (history.data?.total ?? 0) > 0;
  const hasCards = (cards.data?.distribution.total ?? 0) > 0;

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Progress</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          Everything here is counted from your review log. Nothing is estimated.
        </p>
      </header>

      {loading ? (
        <div className="space-y-6">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-48 w-full rounded-xl" />
        </div>
      ) : !hasReviews ? (
        <EmptyState
          icon={<CalendarDaysIcon />}
          title="Nothing to show yet"
          description={
            hasCards
              ? 'Rate a card and this page starts filling in — a streak from the first day, retention once there are a few reviews to divide by.'
              : 'Make a deck and rate a card. Progress is measured from your review log, so it starts the moment you do.'
          }
          action={
            hasCards ? (
              <Button asChild>
                <Link to="/practice">
                  <PlayIcon /> Practise now
                </Link>
              </Button>
            ) : (
              <Button asChild>
                <Link to="/decks">
                  <PlusIcon /> Create a deck
                </Link>
              </Button>
            )
          }
        />
      ) : (
        <>
          <section className="grid gap-4 sm:grid-cols-3">
            <StreakCard history={history.data} isPending={history.isPending} />
            <Card className="py-5">
              <CardHeader>
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Reviews this year
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold tabular-nums">
                  {history.data?.total ?? 0}
                </p>
              </CardContent>
            </Card>
            <Card className="py-5">
              <CardHeader>
                <CardTitle className="text-muted-foreground text-sm font-medium">
                  Due today
                </CardTitle>
              </CardHeader>
              <CardContent>
                {forecast.isPending ? (
                  <Skeleton className="h-9 w-16" />
                ) : (
                  <p className="text-3xl font-semibold tabular-nums">
                    {forecast.data?.buckets[0]?.total ?? 0}
                  </p>
                )}
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Review history</CardTitle>
              <CardDescription>
                One cell per study day, which starts at 04:00 in your timezone.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {history.data && (
                <Heatmap
                  counts={history.data.counts}
                  today={history.data.today}
                  timeZone={history.data.timeZone}
                />
              )}
            </CardContent>
          </Card>

          <div className="grid gap-6 lg:grid-cols-2">
            <RetentionCard history={retention.data} isPending={retention.isPending} />
            <StateDistribution
              states={cards.data}
              history={retention.data}
              isPending={cards.isPending}
            />
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Due forecast</CardTitle>
              <CardDescription>
                The next {FORECAST_DAYS} days. Today includes everything overdue and the
                new cards still allowed under your daily limit.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {forecast.isPending || !forecast.data ? (
                <Skeleton className="h-[260px] w-full" />
              ) : (
                <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
                  <ForecastChart
                    buckets={forecast.data.buckets}
                    timeZone={forecast.data.timeZone}
                  />
                </Suspense>
              )}
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
