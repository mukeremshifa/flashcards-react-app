import { beforeAll, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { ForecastDay } from '@/lib/progress';
import type { CardStates } from '@/lib/queries';
import { ForecastChart } from './ForecastChart';
import { StateDistribution } from './StateDistribution';

/**
 * The rule P3 set for the heatmap, applied to the two charts that came after it.
 *
 * A stacked bar four series deep and a segmented meter both carry all of their
 * meaning in hue, and the hues here are one ramp — `--grade-again` through
 * `--grade-easy` — chosen so the four stay separable by *lightness* to a reader
 * with no colour vision. Lightness separates them; it does not name them. Only
 * text does that, and a legend rendered as four coloured squares with no words
 * is a chart that stops working in greyscale, in a screen reader, and in a
 * printout.
 *
 * Recharts' own `<Legend>` would satisfy the letter of this, which is why P6
 * replaced it with `ChartLegend`: the legend now lives outside the responsive
 * container, in the app's own type, and is therefore assertable.
 */

// Recharts' ResponsiveContainer observes its box; jsdom has no ResizeObserver.
// The chart itself measures zero and draws nothing here — the legend does not,
// which is the point.
beforeAll(() => {
  globalThis.ResizeObserver ??= class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

const SERIES = ['Relearning', 'Learning', 'Review', 'New'];

function forecastDays(): ForecastDay[] {
  return Array.from({ length: 3 }, (_, index) => ({
    day: `2026-08-${String(13 + index).padStart(2, '0')}`,
    learning: 2,
    review: 5,
    relearning: 1,
    new: index === 0 ? 4 : 0,
    total: index === 0 ? 12 : 8,
  }));
}

const states: CardStates = {
  distribution: {
    counts: { new: 4, learning: 2, review: 9, relearning: 1 },
    total: 16,
  },
  strength: { stability: 12.5, difficulty: 5.4, cards: 12 },
};

describe('ForecastChart', () => {
  it('names every series in text, not colour alone', () => {
    render(<ForecastChart buckets={forecastDays()} timeZone="UTC" />);

    for (const name of SERIES) {
      expect(screen.getByText(name)).toBeInTheDocument();
    }
  });

  it('hides the swatches from assistive tech rather than labelling them', () => {
    const { container } = render(
      <ForecastChart buckets={forecastDays()} timeZone="UTC" />,
    );

    const swatches = container.querySelectorAll('li > span[aria-hidden]');
    // Four series, four decorative squares — and nothing that announces a colour
    // as though it were information.
    expect(swatches).toHaveLength(SERIES.length);
  });
});

describe('StateDistribution', () => {
  it('names every state in text beside its count', () => {
    render(<StateDistribution states={states} history={undefined} isPending={false} />);

    for (const [name, count] of [
      ['New', '4'],
      ['Learning', '2'],
      ['Review', '9'],
      ['Relearning', '1'],
    ]) {
      const term = screen.getByText(name!);
      expect(term.parentElement).toHaveTextContent(count!);
    }
  });

  it('describes the meter in words for anyone who cannot see it', () => {
    render(<StateDistribution states={states} history={undefined} isPending={false} />);

    // The bar is one element with no text of its own; without this label it is
    // four coloured slivers and nothing else.
    expect(
      screen.getByRole('img', { name: '4 new, 2 learning, 9 review, 1 relearning' }),
    ).toBeInTheDocument();
  });
});
