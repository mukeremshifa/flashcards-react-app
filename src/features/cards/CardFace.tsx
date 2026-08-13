import { AlertTriangleIcon } from 'lucide-react';
import type { CardPayload } from '@/lib/schemas';
import { cn } from '@/lib/utils';
import { ClozeText } from './ClozeText';
import { McqOptions } from './McqOptions';

/**
 * How a card looks, front and back.
 *
 * A discriminated switch on `kind` and nothing else — no `dangerouslySetInnerHTML`
 * anywhere in this directory. Card text is untrusted (§10): today it is typed by
 * the user, from P2 it is written by a language model, and the ESLint rule that
 * blocks raw HTML is what keeps that decision from eroding.
 *
 * **The front is the one place the display face earns its keep (P6).** A question
 * set in DM Serif Display reads as something to think about; the same question in
 * the interface face reads as a form label, which is what it looked like through
 * P1–P5. The back does not follow it: answers, hints and explanations are read
 * rather than weighed, and a display face at body size is worse at being read.
 * `text-xl` is the base because this component also renders twenty rows deep in
 * the review gate — practice passes a larger size for the single card in front of
 * someone.
 */

export function CardFront({
  payload,
  selectedOption,
  onSelectOption,
  revealed = false,
  className,
}: {
  payload: CardPayload;
  selectedOption?: number | null;
  onSelectOption?: (index: number) => void;
  revealed?: boolean;
  className?: string;
}) {
  switch (payload.kind) {
    case 'basic':
      return (
        <p
          className={cn('font-serif text-xl leading-snug whitespace-pre-wrap', className)}
        >
          {payload.front}
        </p>
      );

    case 'cloze':
      return (
        <div className={className}>
          <ClozeText text={payload.text} revealed={revealed} />
          {payload.hint && !revealed && (
            <p className="text-muted-foreground mt-3 text-sm">Hint: {payload.hint}</p>
          )}
        </div>
      );

    case 'mcq':
      return (
        <div className={cn('space-y-5', className)}>
          <p className="font-serif text-xl leading-snug whitespace-pre-wrap">
            {payload.stem}
          </p>
          <McqOptions
            payload={payload}
            selected={selectedOption ?? null}
            onSelect={onSelectOption}
            revealed={revealed}
          />
        </div>
      );
  }
}

export function CardBack({
  payload,
  className,
}: {
  payload: CardPayload;
  className?: string;
}) {
  switch (payload.kind) {
    case 'basic':
      return (
        <p className={cn('text-lg leading-relaxed whitespace-pre-wrap', className)}>
          {payload.back}
        </p>
      );

    case 'cloze':
      // The revealed sentence is the answer; ClozeText on the front already shows
      // it once `revealed` is set, so the back only adds the hint if there is one.
      return payload.hint ? (
        <p className={cn('text-muted-foreground text-sm', className)}>{payload.hint}</p>
      ) : null;

    case 'mcq':
      return payload.explanation ? (
        <p className={cn('text-muted-foreground leading-relaxed', className)}>
          {payload.explanation}
        </p>
      ) : null;
  }
}

/**
 * What to show when a stored payload does not match the schema. It should be
 * impossible — the payload is validated on write — but "impossible" data is
 * exactly what a generated-content feature produces, and a blank card with no
 * explanation is the worst possible answer.
 */
export function BrokenCard({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'text-muted-foreground flex items-start gap-2 rounded-lg border border-dashed p-4 text-sm',
        className,
      )}
    >
      <AlertTriangleIcon className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        This card&rsquo;s content does not match any known card type. Edit it to fix the
        content, or delete it.
      </span>
    </div>
  );
}
