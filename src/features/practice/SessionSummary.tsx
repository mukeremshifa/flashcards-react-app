import { Link } from 'react-router-dom';
import { CheckCircle2Icon } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatDurationWords, plural } from '@/lib/format';
import { GRADES, GRADE_LABELS } from '@/lib/fsrs';
import type { Grade } from '@/lib/schemas';

/**
 * What just happened, and when to come back. Shown when the queue runs out —
 * which, in a working SRS, is most sessions.
 */
export function SessionSummary({
  reviewed,
  ratings,
  nextDueAt,
  heldBackNew,
  onPracticeMore,
}: {
  reviewed: number;
  ratings: Record<Grade, number>;
  nextDueAt: string | null;
  heldBackNew: number;
  onPracticeMore?: () => void;
}) {
  const now = new Date();
  const nextDue = nextDueAt ? new Date(nextDueAt) : null;

  return (
    <Card className="mx-auto max-w-lg">
      <CardHeader className="items-center text-center">
        <CheckCircle2Icon className="mx-auto size-8 text-emerald-500" aria-hidden />
        <CardTitle>
          {reviewed === 0 ? 'Nothing to review' : `${plural(reviewed, 'card')} reviewed`}
        </CardTitle>
      </CardHeader>

      <CardContent className="space-y-6">
        {reviewed > 0 && (
          <dl className="grid grid-cols-4 gap-2 text-center">
            {GRADES.map(grade => (
              <div key={grade} className="bg-muted/50 rounded-lg py-3">
                <dt className="text-muted-foreground text-xs">{GRADE_LABELS[grade]}</dt>
                <dd className="text-lg font-semibold tabular-nums">
                  {ratings[grade] ?? 0}
                </dd>
              </div>
            ))}
          </dl>
        )}

        <div className="text-muted-foreground space-y-1 text-center text-sm">
          {nextDue ? (
            <p>
              Next card due in{' '}
              <span className="text-foreground font-medium">
                {formatDurationWords(nextDue.getTime() - now.getTime())}
              </span>
              .
            </p>
          ) : (
            <p>No cards scheduled yet. Add some and they will appear here.</p>
          )}
          {heldBackNew > 0 && (
            <p>
              {plural(heldBackNew, 'new card')} held back by today&rsquo;s limit — they
              start tomorrow, or raise the limit in{' '}
              <Link to="/settings" className="underline underline-offset-4">
                settings
              </Link>
              .
            </p>
          )}
        </div>

        <div className="flex justify-center gap-2">
          {onPracticeMore && (
            <Button variant="outline" onClick={onPracticeMore}>
              Check for more
            </Button>
          )}
          <Button asChild>
            <Link to="/decks">Back to decks</Link>
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
