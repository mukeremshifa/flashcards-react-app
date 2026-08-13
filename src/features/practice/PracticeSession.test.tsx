import { beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';

import type { CardPayload } from '@/lib/schemas';
import type { CardRow, PracticeQueue } from '@/lib/queries';
import { PracticeSession } from './PracticeSession';

/**
 * SPEC §8.4, asserted rather than hoped for.
 *
 * "The flip is a `<button>` with `aria-expanded`, not a div — the answer must be
 * reachable by a screen reader, and the card must not become a keyboard trap."
 * That sentence has been in the spec since P0 and nothing enforced it. A restyle
 * is exactly the change that breaks it: turning the reveal into a `<div>` with an
 * `onClick` looks identical to a sighted mouse user, ships, and silently takes
 * the answer away from everyone else.
 *
 * The keyboard path is checked in the same place, because it fails the same way
 * and for the same reason: the shortcuts are bound to the session container
 * rather than to `document` (P1 records why — an editor's inputs must be able to
 * swallow keystrokes), so anything that stops focusing that container disables
 * every shortcut at once without throwing.
 */

// The session is component state over a snapshot queue (SPEC §8.3); the network
// is not what is under test. `parseCardPayload` is kept honest — it is what
// decides whether a card renders at all.
const { reviewMutate } = vi.hoisted(() => ({ reviewMutate: vi.fn() }));

vi.mock('@/lib/queries', () => ({
  parseCardPayload: (row: { payload: unknown }) => row.payload,
  isStaleCardError: () => false,
  useReviewCard: () => ({ mutate: reviewMutate, isPending: false }),
  useUndoLastReview: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateCard: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

beforeEach(() => reviewMutate.mockReset());

const payload: CardPayload = {
  kind: 'basic',
  front: 'What is the powerhouse of the cell?',
  back: 'The mitochondrion',
};

function card(id: string): CardRow {
  return {
    id,
    deck_id: 'deck-1',
    user_id: 'user-1',
    kind: 'basic',
    payload,
    status: 'active',
    fsrs_state: 'new',
    stability: null,
    difficulty: null,
    due: new Date().toISOString(),
    last_review: null,
    reps: 0,
    lapses: 0,
    scheduled_days: 0,
    elapsed_days: 0,
    learning_steps: 0,
    source_excerpt: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  } as unknown as CardRow;
}

const queue: PracticeQueue = {
  cards: [card('card-1')],
  nextDueAt: null,
  heldBackNew: 0,
  fetchedAt: 1,
} as unknown as PracticeQueue;

/**
 * A router, because the summary this session collapses into links to /decks and
 * /settings. Nothing here navigates; it only has to be renderable.
 */
function renderSession() {
  return render(
    <MemoryRouter>
      <PracticeSession queue={queue} onRefetch={vi.fn()} />
    </MemoryRouter>,
  );
}

describe('the reveal control', () => {
  it('is a button that reports its expanded state', () => {
    renderSession();

    const reveal = screen.getByRole('button', { name: /Show answer/ });
    expect(reveal.tagName).toBe('BUTTON');
    expect(reveal).toHaveAttribute('aria-expanded', 'false');
    // It has to point at the region it expands, or the state it reports is
    // about nothing.
    expect(reveal).toHaveAttribute('aria-controls', 'card-answer');
  });

  it('reveals the answer in the region it controls', async () => {
    const user = userEvent.setup();
    const { container } = renderSession();

    expect(container.querySelector('#card-answer')).toBeNull();
    expect(screen.queryByText(payload.back)).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /Show answer/ }));

    const answer = container.querySelector('#card-answer');
    expect(answer).not.toBeNull();
    expect(answer).toHaveTextContent(payload.back);
    expect(screen.getByRole('button', { name: /Again/ })).toBeInTheDocument();
  });

  it('reveals on Space without a click first', async () => {
    const user = userEvent.setup();
    const { container } = renderSession();

    // No click, no tab: the session focuses itself on mount so the keyboard path
    // works from the moment the queue arrives.
    await user.keyboard(' ');

    expect(container.querySelector('#card-answer')).not.toBeNull();
    expect(screen.getByText(payload.back)).toBeInTheDocument();
  });

  it('keeps the question in the display face', () => {
    renderSession();
    // The one place in the app the serif earns its keep (P6) — and practice is
    // the screen that would lose it first in a restyle.
    expect(screen.getByText(payload.front).closest('.font-serif')).not.toBeNull();
  });
});

describe('the keyboard path', () => {
  it('goes reveal → rate → next card with no mouse at all', async () => {
    const user = userEvent.setup();
    renderSession();

    await user.keyboard(' ');
    // 3 is Good. The shortcuts are bound to the session container rather than to
    // `document` (P1), so this also proves the container still holds focus after
    // the reveal re-rendered half the card.
    await user.keyboard('3');

    expect(reviewMutate).toHaveBeenCalledTimes(1);
    expect(reviewMutate.mock.calls[0]?.[0]).toMatchObject({ grade: 3 });

    // The queue had one card, so rating it empties the session.
    expect(screen.getByText('1 card reviewed')).toBeInTheDocument();
  });

  it('ignores a rating pressed before the answer is showing', async () => {
    const user = userEvent.setup();
    renderSession();

    await user.keyboard('3');

    expect(reviewMutate).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Show answer/ })).toBeInTheDocument();
  });
});
