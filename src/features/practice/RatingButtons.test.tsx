import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { GRADE_LABELS } from '@/lib/fsrs';
import { Grade } from '@/lib/schemas';
import { RatingButtons } from './RatingButtons';

/**
 * The regression this exists to prevent already happened once.
 *
 * Through P1–P4 these buttons used `variant="destructive"` for Again and
 * `outline` for the other three, while `ForecastChart` and `StateDistribution`
 * read the `--grade-*` tokens — so one rating was two different colours
 * depending on which screen you were looking at, in defiance of the comment in
 * `globals.css` saying they must agree. Nothing caught it, because nothing
 * asserted it.
 */

const DAY = 86_400_000;

const preview = {
  [Grade.Again]: { intervalMs: 60_000 },
  [Grade.Hard]: { intervalMs: 6 * DAY },
  [Grade.Good]: { intervalMs: 11 * DAY },
  [Grade.Easy]: { intervalMs: 23 * DAY },
} as never;

describe('RatingButtons', () => {
  it('paints each grade with its own --grade-* token', () => {
    render(<RatingButtons preview={preview} onRate={vi.fn()} />);

    const used = new Set<string>();
    for (const grade of [Grade.Again, Grade.Hard, Grade.Good, Grade.Easy]) {
      const button = screen.getByRole('button', {
        name: new RegExp(GRADE_LABELS[grade]),
      });
      const token = [...button.classList].find(name => name.startsWith('bg-grade-'));
      expect(token, `${GRADE_LABELS[grade]} has no bg-grade-* class`).toBeTruthy();
      used.add(token!);
    }

    // Four buttons, four distinct tokens — not one token reused, and no button
    // falling back to a generic button variant.
    expect(used.size).toBe(4);
  });

  it('labels every grade with the interval it will produce', () => {
    render(<RatingButtons preview={preview} onRate={vi.fn()} />);

    expect(screen.getByRole('button', { name: /Again/ })).toHaveTextContent('1m');
    expect(screen.getByRole('button', { name: /Hard/ })).toHaveTextContent('6d');
    expect(screen.getByRole('button', { name: /Good/ })).toHaveTextContent('11d');
    expect(screen.getByRole('button', { name: /Easy/ })).toHaveTextContent('23d');
  });

  it('keeps the 1-4 keyboard hints visible next to their grades', () => {
    render(<RatingButtons preview={preview} onRate={vi.fn()} />);

    // SPEC §8.4: the full keyboard path through practice is a requirement, and
    // the hint is how anyone discovers it.
    for (const [index, grade] of [
      Grade.Again,
      Grade.Hard,
      Grade.Good,
      Grade.Easy,
    ].entries()) {
      const button = screen.getByRole('button', {
        name: new RegExp(GRADE_LABELS[grade]),
      });
      expect(button).toHaveTextContent(String(index + 1));
    }
  });

  it('marks the auto-graded suggestion without colour alone', () => {
    render(<RatingButtons preview={preview} onRate={vi.fn()} suggested={Grade.Good} />);

    const good = screen.getByRole('button', { name: /Good/ });
    expect([...good.classList].some(name => name.startsWith('ring-'))).toBe(true);
  });
});
