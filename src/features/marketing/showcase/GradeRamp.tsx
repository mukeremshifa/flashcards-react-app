import { cn } from '@/lib/utils';

/**
 * The four ratings, as the scale they are.
 *
 * The grade ramp is the one signature graphic this brand has — red through to
 * `#D0F861` across Again → Hard → Good → Easy, already on the social card and
 * already on the rating buttons — and it is exempt from the once-per-screen
 * accent rule because it is a scale carrying meaning rather than an emphasis
 * (SPEC §12, _Closed at P6_). It costs four `<div>`s, which is why P7 reaches
 * for it instead of inventing a graphic.
 *
 * Lightness climbs 0.60 → 0.72 → 0.82 → 0.92 in even steps, so the four stay
 * separable with no colour vision at all; labels are ink on every band for the
 * same reason `RatingButtons` uses ink on all four. Classes rather than the
 * `var()` strings in `src/lib/grade-tokens.ts`, because that module reaches
 * `src/lib/fsrs.ts` and `ts-fsrs` with it, and nothing on this page should pull
 * the scheduler into the bundle to draw a stripe.
 *
 * The intervals are illustrative and hardcoded — a mid-strength card in the
 * review state. They are formatted the way `formatInterval` formats them so the
 * drawing and the app agree about what an interval looks like.
 */

const RAMP = [
  { key: '1', label: 'Again', interval: '10m', field: 'bg-grade-again' },
  { key: '2', label: 'Hard', interval: '2d', field: 'bg-grade-hard' },
  { key: '3', label: 'Good', interval: '5d', field: 'bg-grade-good' },
  { key: '4', label: 'Easy', interval: '12d', field: 'bg-grade-easy' },
] as const;

export function GradeRampShowcase() {
  return (
    <div aria-hidden className="pointer-events-none w-full select-none">
      <div className="grid grid-cols-4 gap-1.5 sm:gap-2">
        {RAMP.map(({ key, label, interval, field }) => (
          <div
            key={label}
            className={cn(
              'text-primary-foreground flex flex-col items-center gap-0.5 rounded-md px-1 py-2.5 sm:px-2',
              field,
            )}
          >
            <span className="flex items-center gap-1 text-xs font-semibold sm:gap-1.5 sm:text-sm">
              <span className="font-mono text-xs opacity-60">{key}</span>
              {label}
            </span>
            <span className="font-mono text-xs tabular-nums opacity-75">{interval}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
