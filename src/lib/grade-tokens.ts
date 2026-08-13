import type { FsrsStateName } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';

/**
 * The grade ramp, as CSS values, in one place.
 *
 * `globals.css` has always said the rating buttons and the progress charts must
 * mean the same thing by the same colour; through P3–P5 they agreed only because
 * three files happened to contain the same four strings. `ForecastChart` and
 * `StateDistribution` each carried their own copy of the state→colour map, which
 * is exactly the arrangement that let the buttons drift away from the tokens
 * once already (see `RatingButtons.tsx`).
 *
 * These are `var(…)` strings rather than Tailwind classes because their
 * consumers are Recharts `fill` props and inline `backgroundColor` — a chart
 * library cannot be handed a utility class. Anything that *can* use a class
 * should: `bg-grade-easy` resolves to the same token.
 */

export const GRADE_TOKEN: Record<Grade, string> = {
  [Grade.Again]: 'var(--color-grade-again)',
  [Grade.Hard]: 'var(--color-grade-hard)',
  [Grade.Good]: 'var(--color-grade-good)',
  [Grade.Easy]: 'var(--color-grade-easy)',
};

/**
 * Where each scheduler state sits on that same ramp.
 *
 * Relearning is the Again colour because that is literally how a card gets
 * there, and New is the accent because a new card is what the product exists to
 * produce — `--grade-easy` and `--primary` are the same value, so this is one
 * ramp and not two.
 */
export const STATE_TOKEN: Record<FsrsStateName, string> = {
  new: 'var(--color-primary)',
  learning: 'var(--color-grade-hard)',
  review: 'var(--color-grade-good)',
  relearning: 'var(--color-grade-again)',
};
