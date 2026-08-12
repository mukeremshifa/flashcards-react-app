import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

/**
 * The screen a healthy user sees most often.
 *
 * In a spaced-repetition app "nothing due" is not an error state or an empty
 * shell — it is success, and it should read that way. Every list gets one
 * (SPEC-adjacent, P1 task 9), and each says what to do next rather than only
 * what is absent.
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
        'flex flex-col items-center rounded-xl border border-dashed px-6 py-12 text-center',
        className,
      )}
    >
      {icon && <div className="text-muted-foreground mb-3 [&>svg]:size-8">{icon}</div>}
      <p className="font-medium">{title}</p>
      {description && (
        <div className="text-muted-foreground mt-1 max-w-sm text-sm">{description}</div>
      )}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}
