import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';

import type { CardPayload } from '@/lib/schemas';
import { CardBack, CardFront } from './CardFace';

/**
 * The display face has exactly one job in this product, and it is this one.
 *
 * P5 shipped DM Serif Display and wired `--font-serif` into `@theme`, but every
 * card front was still set in the interface face — so the app paid for a second
 * webfont that appeared only in the wordmark. P6 moved the question side to it,
 * because a question in a display serif reads as something to think about and
 * the same question in the UI face reads as a form label.
 *
 * That is a decision a later restyle would undo without noticing: nothing looks
 * broken when a serif quietly becomes a sans, it just stops being designed. So
 * the rule is asserted per card kind, and its converse with it — the answer side
 * must *not* pick the serif up, because answers are read rather than weighed.
 */

const basic: CardPayload = {
  kind: 'basic',
  front: 'What is the powerhouse of the cell?',
  back: 'The mitochondrion',
};

const cloze: CardPayload = {
  kind: 'cloze',
  text: 'The mitochondrion is the {{c1::powerhouse}} of the cell.',
  hint: 'organelle',
};

const mcq: CardPayload = {
  kind: 'mcq',
  stem: "Which organelle produces most of the cell's ATP?",
  options: [
    { text: 'Mitochondrion', correct: true },
    { text: 'Ribosome', correct: false },
    { text: 'Nucleus', correct: false },
  ],
  explanation: 'Oxidative phosphorylation happens on the inner membrane.',
};

/** The nearest ancestor (or self) that carries `font-serif`, if any. */
function serifAncestor(element: HTMLElement | null): Element | null {
  return element?.closest('.font-serif') ?? null;
}

describe('CardFront', () => {
  it('sets a basic card’s question in the display face', () => {
    render(<CardFront payload={basic} />);
    const front = screen.getByText(basic.front);
    expect(serifAncestor(front)).not.toBeNull();
  });

  it('sets a cloze sentence in the display face', () => {
    const { container } = render(<CardFront payload={cloze} revealed />);
    const serif = container.querySelector('.font-serif');

    expect(serif).not.toBeNull();
    // The sentence is split into spans around the deletion, so match the text of
    // the whole element rather than one node.
    expect(serif).toHaveTextContent('The mitochondrion is the powerhouse of the cell.');
  });

  it('sets a multiple-choice stem in the display face, but not its options', () => {
    render(<CardFront payload={mcq} />);

    expect(serifAncestor(screen.getByText(mcq.stem))).not.toBeNull();
    // The options are a list to read through; the display face is for the one
    // line the reader is being asked about.
    expect(serifAncestor(screen.getByText('Ribosome'))).toBeNull();
  });
});

describe('CardBack', () => {
  it('leaves the answer in the interface face', () => {
    render(<CardBack payload={basic} />);
    expect(serifAncestor(screen.getByText(basic.back))).toBeNull();
  });

  it('leaves an explanation in the interface face', () => {
    render(<CardBack payload={mcq} />);
    expect(serifAncestor(screen.getByText(mcq.explanation!))).toBeNull();
  });
});
