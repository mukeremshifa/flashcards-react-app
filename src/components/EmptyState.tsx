import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The screen a healthy user sees most often.
 *
 * In a spaced-repetition app "nothing due" is not an error state or an empty
 * shell — it is success, and it should read that way. Every list gets one
 * (SPEC-adjacent, P1 task 9), and each says what to do next rather than only
 * what is absent.
 *
 * Restyled once, here, in P6 rather than per screen: the icon sits in a filled
 * disc so it reads as a deliberate mark instead of a stray glyph, and the whole
 * block is given room. Nine screens render this component, and nine hand-rolled
 * variations of it is how an app stops looking like one product.
 */
export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        'flex flex-col items-center rounded-xl border border-dashed px-6 py-14 text-center',
        className,
      )}
    >
      {icon && (
        <div className="bg-muted text-muted-foreground mb-4 flex size-12 items-center justify-center rounded-full [&>svg]:size-6">
          {icon}
        </div>
      )}
      <p className="text-base font-medium">{title}</p>
      {description && (
        <div className="text-muted-foreground mt-2 max-w-sm text-sm leading-relaxed">
          {description}
        </div>
      )}
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
