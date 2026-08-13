import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { PencilIcon, Undo2Icon } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';
import { BrokenCard, CardBack, CardFront } from '@/features/cards/CardFace';
import { CardEditor } from '@/features/cards/CardEditor';
import { previewSchedule, type SchedulePreview } from '@/lib/fsrs';
import { Grade, type CardPayload } from '@/lib/schemas';
import {
  isStaleCardError,
  parseCardPayload,
  useReviewCard,
  useUndoLastReview,
  useUpdateCard,
  type CardRow,
  type PracticeQueue,
} from '@/lib/queries';
import { cn } from '@/lib/utils';
import { RatingButtons } from './RatingButtons';
import { SessionSummary } from './SessionSummary';

/**
 * One practice session.
 *
 * Session state — which card, whether it is revealed, what has been rated — is
 * component state, not TanStack Query (SPEC §8.3). The queue arrives once as a
 * snapshot and this component works through it; refetching underneath the user
 * would reorder the cards they are part-way through.
 */

type RatedEntry = { card: CardRow; grade: Grade };

export function PracticeSession({
  queue,
  deckId,
  onRefetch,
}: {
  queue: PracticeQueue;
  deckId?: string;
  onRefetch: () => void;
}) {
  const [cards, setCards] = useState<CardRow[]>(queue.cards);
  // The position never moves: rating removes the current card and the next one
  // slides into its place, undo puts one back here. Only the list changes.
  const index = 0;
  const [revealed, setRevealed] = useState(false);
  const [selectedOption, setSelectedOption] = useState<number | null>(null);
  const [editing, setEditing] = useState(false);
  const [rated, setRated] = useState<RatedEntry[]>([]);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const shownAt = useRef<number>(Date.now());

  const reviewCard = useReviewCard();
  const undoReview = useUndoLastReview();
  const updateCard = useUpdateCard();

  const card = cards[index] ?? null;
  const payload = card ? parseCardPayload(card) : null;

  /** SPEC §12 (7): a multiple-choice answer grades itself, overridably. */
  const suggestedGrade: Grade | null =
    payload?.kind === 'mcq' && selectedOption !== null
      ? payload.options[selectedOption]?.correct
        ? Grade.Good
        : Grade.Again
      : null;

  // The preview is computed once per card and then committed as-is, so the
  // interval on the button is the interval the card gets (see lib/fsrs.ts).
  const preview: SchedulePreview | null = useMemo(
    () => (card ? previewSchedule(card, new Date()) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- keyed by the card, not its object identity
    [card?.id],
  );

  useEffect(() => {
    shownAt.current = Date.now();
    setRevealed(false);
    setSelectedOption(null);
  }, [card?.id]);

  // Focus the session so the keyboard shortcuts work without a click first.
  useEffect(() => {
    if (!editing) containerRef.current?.focus();
  }, [editing, card?.id]);

  const reveal = useCallback(() => setRevealed(true), []);

  const rate = useCallback(
    (grade: Grade) => {
      if (!card || !preview) return;

      const durationMs = Math.max(0, Date.now() - shownAt.current);

      // Advance first. A round trip per card is what makes practice feel like
      // filling in a form (SPEC §8.3); the write catches up behind the user.
      // Removing the current card slides the next one into this index, so the
      // index itself does not move; when the list empties, the summary shows.
      setRated(previous => [...previous, { card, grade }]);
      setCards(previous => previous.filter(queued => queued.id !== card.id));

      reviewCard.mutate(
        { card, grade, durationMs, preview, deckId },
        {
          onError: error => {
            if (isStaleCardError(error)) {
              // Another tab already rated this card. Dropping it is correct —
              // the rating that landed first is the real one.
              toast.warning('That card was already rated in another tab.');
              return;
            }
            toast.error('Could not save that rating', {
              description: (error as Error).message,
            });
            // Put it back rather than silently losing the review.
            setRated(previous => previous.filter(entry => entry.card.id !== card.id));
            setCards(previous => [...previous, card]);
          },
        },
      );
    },
    [card, deckId, preview, reviewCard],
  );

  const undo = useCallback(() => {
    const last = rated.at(-1);
    if (!last || undoReview.isPending) return;

    undoReview.mutate(
      { cardId: last.card.id, deckId },
      {
        onSuccess: restored => {
          setRated(previous => previous.slice(0, -1));
          // Show it again, with the schedule it had before the mistake.
          setCards(previous => [
            ...previous.slice(0, index),
            restored,
            ...previous.slice(index),
          ]);
          setRevealed(false);
          toast.success('Rating undone');
        },
        onError: error =>
          toast.error('Could not undo', { description: (error as Error).message }),
      },
    );
  }, [deckId, index, rated, undoReview]);

  const saveEdit = useCallback(
    async (payloads: CardPayload[]) => {
      if (!card) return;
      const [first] = payloads;
      if (!first) return;
      await updateCard.mutateAsync({
        cardId: card.id,
        deckId: card.deck_id,
        payload: first,
      });
      // Reflect the edit on the card in front of the user immediately.
      setCards(previous =>
        previous.map(queued =>
          queued.id === card.id
            ? { ...queued, kind: first.kind, payload: first }
            : queued,
        ),
      );
      setEditing(false);
      if (payloads.length > 1) {
        toast.info('Only the first card was saved — split clozes from the deck page.');
      }
    },
    [card, updateCard],
  );

  const onKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      // The editor has its own inputs. Binding to `document` instead of this
      // container is what makes a shortcut swallow a keystroke inside a form.
      if (editing || event.metaKey || event.ctrlKey || event.altKey) return;

      const key = event.key.toLowerCase();
      if (key === ' ' || key === 'enter') {
        event.preventDefault();
        if (!revealed) reveal();
        else if (suggestedGrade !== null) rate(suggestedGrade);
        return;
      }
      if (key === 'u') {
        event.preventDefault();
        undo();
        return;
      }
      if (key === 'e' && card) {
        event.preventDefault();
        setEditing(true);
        return;
      }
      if (revealed && key >= '1' && key <= '4') {
        event.preventDefault();
        rate(Number(key) as Grade);
      }
    },
    [card, editing, rate, reveal, revealed, suggestedGrade, undo],
  );

  if (!card || !preview) {
    return (
      <SessionSummary
        reviewed={rated.length}
        ratings={countRatings(rated)}
        nextDueAt={queue.nextDueAt}
        heldBackNew={queue.heldBackNew}
        onPracticeMore={onRefetch}
      />
    );
  }

  const total = cards.length + rated.length;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      role="region"
      aria-label="Practice session"
      className="focus-visible:ring-ring mx-auto max-w-2xl space-y-5 rounded-xl outline-none focus-visible:ring-2"
    >
      <div className="space-y-2">
        <div className="text-muted-foreground flex items-center justify-between text-xs">
          <span>
            <span className="text-foreground font-mono tabular-nums">{cards.length}</span>{' '}
            left · <span className="font-mono tabular-nums">{rated.length}</span> done
          </span>
          <div className="flex items-center gap-2">
            {card.fsrs_state === 'new' && <Badge variant="outline">New</Badge>}
            {card.lapses > 0 && (
              <Badge variant="outline">
                <span className="font-mono tabular-nums">{card.lapses}</span> lapses
              </Badge>
            )}
          </div>
        </div>

        {/* Ink, not the accent. The one accent on this screen is the Easy
            rating, which is the thing the session is trying to produce. */}
        <div className="bg-muted h-1 overflow-hidden rounded-full" aria-hidden>
          <div
            className="bg-foreground h-full rounded-full transition-[width] duration-300"
            style={{ width: `${total === 0 ? 0 : (rated.length / total) * 100}%` }}
          />
        </div>
      </div>

      <Card className="py-8">
        <CardContent className="space-y-6 px-8">
          {editing ? (
            <CardEditor
              defaultValue={payload}
              submitLabel="Save changes"
              autoFocus
              onCancel={() => setEditing(false)}
              onSubmit={saveEdit}
            />
          ) : payload ? (
            <>
              <CardFront
                className="text-2xl"
                payload={payload}
                revealed={revealed}
                selectedOption={selectedOption}
                onSelectOption={optionIndex => {
                  setSelectedOption(optionIndex);
                  setRevealed(true);
                }}
              />

              {/*
                The flip is a button with aria-expanded (SPEC §8.4): the answer
                must be reachable by a screen reader, and the card must not
                become a keyboard trap.
              */}
              {!revealed ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="lg"
                  className="w-full"
                  aria-expanded={false}
                  aria-controls="card-answer"
                  onClick={reveal}
                >
                  Show answer <Kbd className="ml-1">Space</Kbd>
                </Button>
              ) : (
                <div
                  id="card-answer"
                  className={cn('space-y-6 border-t pt-6', 'motion-safe:animate-in')}
                >
                  <CardBack payload={payload} />
                  <div className="space-y-2">
                    <p className="text-muted-foreground text-xs tracking-wide uppercase">
                      How well did you know it?
                    </p>
                    <RatingButtons
                      preview={preview}
                      onRate={rate}
                      suggested={suggestedGrade}
                    />
                  </div>
                </div>
              )}
            </>
          ) : (
            <BrokenCard />
          )}
        </CardContent>
      </Card>

      <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex gap-1">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() => setEditing(true)}
            disabled={editing}
          >
            <PencilIcon /> Edit <Kbd>E</Kbd>
          </Button>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={undo}
            disabled={rated.length === 0 || undoReview.isPending}
          >
            <Undo2Icon /> Undo <Kbd>U</Kbd>
          </Button>
        </div>
        <span className="hidden items-center gap-1.5 sm:inline-flex">
          <Kbd>Space</Kbd> reveals · <Kbd>1</Kbd>–<Kbd>4</Kbd> rate
        </span>
      </div>
    </div>
  );
}

function countRatings(rated: RatedEntry[]): Record<Grade, number> {
  const counts = {
    [Grade.Again]: 0,
    [Grade.Hard]: 0,
    [Grade.Good]: 0,
    [Grade.Easy]: 0,
  };
  for (const entry of rated) counts[entry.grade] += 1;
  return counts;
}
