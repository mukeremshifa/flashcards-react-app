import { parseCloze } from '@/lib/schemas';
import { cn } from '@/lib/utils';

/**
 * A cloze sentence, with the deletion either hidden or revealed.
 *
 * SPEC §8.4: the blank is announced as "blank", not rendered as a row of
 * underscores. A screen-reader user hearing "The mitochondrion is the
 * ___________ of the cell" hears nothing at all where the question is.
 *
 * Set in the display face, like every other card front (P6) — a cloze sentence
 * *is* the question, not a caption above one.
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
    <p className={cn('font-serif text-xl leading-snug', className)}>
      {segments.map((segment, index) =>
        segment.blank ? (
          <span
            key={index}
            // The visible width hints at the answer's length, as paper cards do,
            // while the label keeps it legible to assistive tech either way.
            aria-label={revealed ? undefined : 'blank'}
            className={cn(
              'mx-0.5 inline-block rounded px-1 font-medium',
              // Revealed, the answer is literally highlighted: accent field, ink
              // on top. `text-primary` would be unreadable (globals.css).
              revealed
                ? 'bg-primary text-primary-foreground'
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
