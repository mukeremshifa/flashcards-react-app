import { parseCloze } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * A cloze sentence, with the deletion either hidden or revealed.
 *
 * SPEC §8.4: the blank is announced as "blank", not rendered as a row of
 * underscores. A screen-reader user hearing "The mitochondrion is the
 * ___________ of the cell" hears nothing at all where the question is.
 */
export function ClozeText({
  text,
  revealed,
  className,
}: {
  text: string;
  revealed: boolean;
  className?: string;
}) {
  const segments = parseCloze(text);

  return (
    <p className={cn('text-lg leading-relaxed', className)}>
      {segments.map((segment, index) =>
        segment.blank ? (
          <span
            key={index}
            // The visible width hints at the answer's length, as paper cards do,
            // while the label keeps it legible to assistive tech either way.
            aria-label={revealed ? undefined : 'blank'}
            className={cn(
              'mx-0.5 inline-block rounded px-1 font-medium',
              revealed
                ? 'bg-primary/10 text-primary'
                : 'bg-muted text-transparent select-none',
            )}
          >
            {segment.text}
          </span>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </p>
  );
}
