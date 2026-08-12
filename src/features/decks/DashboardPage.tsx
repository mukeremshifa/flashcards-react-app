import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { FlameIcon, LayersIcon, PlayIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { formatDurationWords, plural } from '@/lib/format';
import { streaks } from '@/lib/progress';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDecks, useDueSummary, useProfile, useReviewHistory } from '@/lib/queries';

/**
 * Deliberately thin: four true numbers and a button. The charts live on
 * `/progress`, and a dashboard full of them is a worse first screen than one
 * that answers "what do I do now".
 *
 * The streak is here because it is the number that brings someone back
 * tomorrow. It shares `useReviewHistory`'s cache with /progress, so navigating
 * between the two costs nothing.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const summary = useDueSummary();
  const decks = useDecks();
  const history = useReviewHistory();

  const streak = useMemo(
    () =>
      history.data ? streaks([...history.data.counts.keys()], history.data.today) : null,
    [history.data],
  );

  const name = profile?.display_name?.trim() || user?.email?.split('@')[0] || 'there';
  const ready = (summary.data?.dueNow ?? 0) + (summary.data?.newAvailable ?? 0);

  return (
    <div className="space-y-8">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">Hello, {name}</h1>
        <p className="text-muted-foreground mt-1 text-sm">
          {summary.isPending
            ? 'Checking what is due…'
            : ready > 0
              ? `${plural(ready, 'card')} ready to practise.`
              : 'Nothing due right now.'}
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Due now" value={summary.data?.dueNow} loading={summary.isPending} />
        <Stat
          label="New available"
          value={summary.data?.newAvailable}
          loading={summary.isPending}
        />
        <Stat
          label="Reviewed today"
          value={summary.data?.reviewedToday}
          loading={summary.isPending}
        />
        <Stat
          label="Streak"
          value={streak?.current}
          loading={history.isPending}
          icon={<FlameIcon className="size-4" aria-hidden />}
          suffix={streak ? (streak.current === 1 ? 'day' : 'days') : undefined}
          href="/progress"
        />
      </section>

      <section>
        {ready > 0 ? (
          <Button size="lg" asChild>
            <Link to="/practice">
              <PlayIcon /> Practise {ready} {ready === 1 ? 'card' : 'cards'}
            </Link>
          </Button>
        ) : summary.data?.nextDueAt ? (
          <p className="text-muted-foreground text-sm">
            Next card due in{' '}
            <span className="text-foreground font-medium">
              {formatDurationWords(
                new Date(summary.data.nextDueAt).getTime() - Date.now(),
              )}
            </span>
            .
          </p>
        ) : null}
      </section>

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="font-medium">Recent decks</h2>
          <Button variant="ghost" size="sm" asChild>
            <Link to="/decks">All decks</Link>
          </Button>
        </div>

        {decks.isPending ? (
          <Skeleton className="h-20 w-full rounded-xl" />
        ) : !decks.data || decks.data.length === 0 ? (
          <EmptyState
            icon={<LayersIcon />}
            title="Nothing here yet"
            description="Make a deck, add a few cards, and the schedule starts working from the first review."
            action={
              <Button asChild>
                <Link to="/decks">
                  <PlusIcon /> Create a deck
                </Link>
              </Button>
            }
          />
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {decks.data.slice(0, 4).map(deck => (
              <li key={deck.id}>
                <Card className="py-4">
                  <CardContent>
                    <Link
                      to={`/decks/${deck.id}`}
                      className="font-medium underline-offset-4 hover:underline"
                    >
                      {deck.title}
                    </Link>
                    <p className="text-muted-foreground mt-0.5 text-sm">
                      {plural(deck.cardCount, 'card')}
                      {deck.dueCount + deck.newCount > 0 &&
                        ` · ${deck.dueCount + deck.newCount} ready`}
                    </p>
                  </CardContent>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Stat({
  label,
  value,
  loading,
  icon,
  suffix,
  href,
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
  icon?: React.ReactNode;
  suffix?: string;
  href?: string;
}) {
  const body = (
    <Card className="py-4">
      <CardContent>
        <p className="text-muted-foreground flex items-center gap-1.5 text-sm">
          {icon}
          {label}
        </p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-12" />
        ) : (
          <p className="mt-1 text-3xl font-semibold tabular-nums">
            {value ?? 0}
            {suffix && (
              <span className="text-muted-foreground ml-1.5 text-base font-normal">
                {suffix}
              </span>
            )}
          </p>
        )}
      </CardContent>
    </Card>
  );

  return href ? (
    <Link
      to={href}
      className="focus-visible:ring-ring rounded-xl focus-visible:ring-2 focus-visible:outline-none"
    >
      {body}
    </Link>
  ) : (
    body
  );
}
