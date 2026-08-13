import { MonitorIcon, MoonIcon, SunIcon } from 'lucide-react';

import { cn } from '@/lib/utils';
import { useTheme, type Theme } from './theme';

/**
 * Light, dark, or whatever the machine says.
 *
 * P1–P5 shipped a single button that flipped light↔dark, which meant that the
 * first click permanently opted out of `system` — `theme.tsx` has always kept a
 * live `matchMedia` listener for a state the interface gave no way back to. A
 * two-state control cannot express three states, so this is a radio group: the
 * state is visible rather than inferred from an icon that means "what you will
 * get if you press me".
 *
 * `theme` and not `resolvedTheme` drives the selection. They differ exactly when
 * the answer matters — under `system` at night, `resolvedTheme` is 'dark', and
 * showing Dark as chosen would be a lie about why the app is dark.
 */

const OPTIONS = [
  { value: 'light', label: 'Light', icon: SunIcon },
  { value: 'dark', label: 'Dark', icon: MoonIcon },
  { value: 'system', label: 'System', icon: MonitorIcon },
] as const satisfies ReadonlyArray<{ value: Theme; label: string; icon: unknown }>;

export function ThemeChoice({ className }: { className?: string }) {
  const { theme, setTheme } = useTheme();

  return (
    <div
      role="radiogroup"
      aria-label="Theme"
      className={cn('bg-muted grid grid-cols-3 gap-0.5 rounded-md p-0.5', className)}
    >
      {OPTIONS.map(({ value, label, icon: Icon }) => (
        <button
          key={value}
          type="button"
          role="radio"
          aria-checked={theme === value}
          onClick={() => setTheme(value)}
          className={cn(
            'flex flex-col items-center gap-1 rounded-sm px-2 py-1.5 text-xs transition-colors',
            'focus-visible:ring-ring outline-none focus-visible:ring-2',
            theme === value
              ? 'bg-background text-foreground font-medium shadow-xs'
              : 'text-muted-foreground hover:text-foreground',
          )}
        >
          <Icon className="size-4" aria-hidden />
          {label}
        </button>
      ))}
    </div>
  );
}
