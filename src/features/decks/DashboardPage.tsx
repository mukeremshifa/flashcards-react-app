import { Link } from 'react-router-dom';
import { LayersIcon, PlayIcon, PlusIcon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { EmptyState } from '@/components/EmptyState';
import { formatDurationWords, plural } from '@/lib/format';
import { useAuth } from '@/features/auth/AuthProvider';
import { useDecks, useDueSummary, useProfile } from '@/lib/queries';

/**
 * Deliberately thin. The interesting numbers — the heatmap, retention, the due
 * forecast — are P3, and a dashboard full of half-built charts is worse than one
 * that shows three true things and a button.
 */
export function DashboardPage() {
  const { user } = useAuth();
  const { data: profile } = useProfile();
  const summary = useDueSummary();
  const decks = useDecks();

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

      <section className="grid gap-3 sm:grid-cols-3">
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
}: {
  label: string;
  value: number | undefined;
  loading: boolean;
}) {
  return (
    <Card className="py-4">
      <CardContent>
        <p className="text-muted-foreground text-sm">{label}</p>
        {loading ? (
          <Skeleton className="mt-1 h-8 w-12" />
        ) : (
          <p className="mt-1 text-3xl font-semibold tabular-nums">{value ?? 0}</p>
        )}
      </CardContent>
    </Card>
  );
}
