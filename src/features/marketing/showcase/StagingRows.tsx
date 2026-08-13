import { CheckIcon, PencilIcon, XIcon } from 'lucide-react';

import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

/**
 * The review gate, mid-generation: two cards that have arrived and one still on
 * its way.
 *
 * A copy of `StagingList`'s row, for the reason set out in `ReviewCard.tsx` —
 * the live component imports `CardEditor`, `useGenerateCards` and the schemas,
 * and none of that belongs in a page a stranger opens with no session.
 *
 * **Why both drafts are basic cards.** The real gate renders every draft
 * `revealed`, and a revealed cloze blank and a revealed MCQ answer are both
 * accent fields (`ClozeText`, `McqOptions`). Either one here would spend a
 * second accent on an illustration, on a page whose whole accent budget belongs
 * to the sign-up button. The three card types are named in the copy instead,
 * which costs nothing and stays true.
 *
 * Only the first row carries the ring and the shortcut hints, because that is
 * how the gate actually behaves: twenty accent-filled Accept buttons is twenty
 * things shouting at once (P6). Here the cursor row is ink-ringed and its Accept
 * is outline rather than filled — the same reason again, one page up.
 */

const DRAFTS = [
  {
    index: 1,
    kind: 'Basic',
    front: 'What does FSRS mean by the stability of a card?',
    back: 'The number of days over which recall probability falls to 90%. The higher it is, the longer the card can wait.',
  },
  {
    index: 2,
    kind: 'Basic',
    front: 'Why is a review log append-only rather than a running total?',
    back: 'A total cannot be recomputed or audited. A log can be replayed, which is what makes every figure on the progress page a count rather than an estimate.',
  },
] as const;

export function StagingRowsShowcase() {
  return (
    <div aria-hidden className="pointer-events-none w-full space-y-3 select-none">
      {DRAFTS.map((draft, position) => (
        <Card
          key={draft.index}
          className={cn(
            'gap-4 py-5',
            position === 0 ? 'ring-ring ring-2' : 'border-border/70 shadow-none',
          )}
        >
          <CardContent className="space-y-4">
            <div className="text-muted-foreground flex items-center gap-2 text-xs tracking-wide uppercase">
              <span className="font-mono normal-case tabular-nums">{draft.index}</span>
              <span>·</span>
              <span>{draft.kind}</span>
            </div>

            <p className="font-serif text-lg leading-snug sm:text-xl">{draft.front}</p>
            <p className="leading-relaxed sm:text-lg">{draft.back}</p>

            <div className="flex flex-wrap items-center gap-2 pt-1 text-sm font-medium">
              <span
                className={cn(
                  'inline-flex h-8 items-center gap-1.5 rounded-md px-3',
                  position === 0
                    ? 'bg-background border shadow-xs'
                    : 'text-muted-foreground',
                )}
              >
                <CheckIcon className="size-4" /> Accept
                {position === 0 && <Kbd className="ml-1">A</Kbd>}
              </span>
              <span className="text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3">
                <PencilIcon className="size-4" /> Edit
                {position === 0 && <Kbd className="ml-1">E</Kbd>}
              </span>
              <span className="text-muted-foreground inline-flex h-8 items-center gap-1.5 rounded-md px-3">
                <XIcon className="size-4" /> Reject
                {position === 0 && <Kbd className="ml-1">R</Kbd>}
              </span>
            </div>
          </CardContent>
        </Card>
      ))}

      {/* The row a card has not finished streaming into yet (SPEC §4.1 step 4). */}
      <Card className="border-border/70 py-4 shadow-none">
        <CardContent className="space-y-3">
          <Skeleton className="h-4 w-20" />
          <Skeleton className="h-5 w-4/5" />
          <Skeleton className="h-5 w-2/3" />
        </CardContent>
      </Card>
    </div>
  );
}
