import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';

import type { CardPayload } from '@/lib/schemas';
import { StagingList } from './StagingList';
import type { StagedCard } from './useGenerateCards';

/**
 * The review gate, at the level where it can actually break: a card that is
 * accepted and then still shown, an edit that is saved and then lost when the
 * row re-renders, a reject that removes the wrong card.
 *
 * The parent owns the list here exactly as `ReviewGatePage` does, so this
 * harness is that page's state machine with the network taken out.
 */

const basic = (id: string, front: string): StagedCard => ({
  id,
  index: Number(id),
  payload: { kind: 'basic', front, back: `answer ${id}` },
  sourceExcerpt: null,
});

function Harness({
  initial,
  onAccept,
  onReject,
  onEdit,
}: {
  initial: StagedCard[];
  onAccept?: (card: StagedCard) => void;
  onReject?: (card: StagedCard) => void;
  onEdit?: (card: StagedCard, payload: CardPayload) => void;
}) {
  const [cards, setCards] = useState(initial);
  const [editingId, setEditingId] = useState<string | null>(null);

  return (
    <StagingList
      cards={cards}
      editingId={editingId}
      onEditingChange={setEditingId}
      onAccept={card => {
        onAccept?.(card);
        setCards(previous => previous.filter(row => row.id !== card.id));
      }}
      onReject={card => {
        onReject?.(card);
        setCards(previous => previous.filter(row => row.id !== card.id));
      }}
      onEdit={(card, payload) => {
        onEdit?.(card, payload);
        setCards(previous =>
          previous.map(row => (row.id === card.id ? { ...row, payload } : row)),
        );
      }}
    />
  );
}

const rowFor = (front: string) =>
  screen.getByText(front).closest('li') as HTMLElement | null;

describe('accepting and rejecting', () => {
  it('accepts one card and takes it out of the list', async () => {
    const user = userEvent.setup();
    const onAccept = vi.fn();
    render(
      <Harness
        initial={[basic('1', 'First card'), basic('2', 'Second card')]}
        onAccept={onAccept}
      />,
    );

    const first = rowFor('First card');
    expect(first).not.toBeNull();
    await user.click(within(first!).getByRole('button', { name: /accept/i }));

    expect(onAccept).toHaveBeenCalledTimes(1);
    expect(onAccept.mock.calls[0]![0].id).toBe('1');
    expect(screen.queryByText('First card')).not.toBeInTheDocument();
    // …and takes only that one.
    expect(screen.getByText('Second card')).toBeInTheDocument();
  });

  it('rejects the card whose button was pressed, not the first one', async () => {
    const user = userEvent.setup();
    const onReject = vi.fn();
    render(
      <Harness
        initial={[basic('1', 'First card'), basic('2', 'Second card')]}
        onReject={onReject}
      />,
    );

    await user.click(
      within(rowFor('Second card')!).getByRole('button', { name: /reject/i }),
    );

    expect(onReject.mock.calls[0]![0].id).toBe('2');
    expect(screen.getByText('First card')).toBeInTheDocument();
    expect(screen.queryByText('Second card')).not.toBeInTheDocument();
  });
});

describe('editing', () => {
  it('keeps the edit it just made', async () => {
    // The failure this test is named for: the editor closes, the mutation
    // succeeds, and the row snaps back to the model's original wording because
    // nothing told the list about the change.
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<Harness initial={[basic('1', 'Vaguely worded question')]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));

    const front = screen.getByLabelText('Front');
    await user.clear(front);
    await user.type(front, 'A much better question');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]![1]).toEqual({
      kind: 'basic',
      front: 'A much better question',
      back: 'answer 1',
    });

    // The editor closed and the row shows the edited text, not the old one.
    expect(screen.queryByLabelText('Front')).not.toBeInTheDocument();
    expect(screen.getByText('A much better question')).toBeInTheDocument();
    expect(screen.queryByText('Vaguely worded question')).not.toBeInTheDocument();
  });

  it('does not save an edit that fails validation', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<Harness initial={[basic('1', 'A question')]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.clear(screen.getByLabelText('Front'));
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(screen.getByRole('alert')).toBeInTheDocument());
    expect(onEdit).not.toHaveBeenCalled();
  });

  it('leaves the card alone when the edit is cancelled', async () => {
    const user = userEvent.setup();
    const onEdit = vi.fn();
    render(<Harness initial={[basic('1', 'Original wording')]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    await user.clear(screen.getByLabelText('Front'));
    await user.type(screen.getByLabelText('Front'), 'Discarded wording');
    await user.click(screen.getByRole('button', { name: /cancel/i }));

    expect(onEdit).not.toHaveBeenCalled();
    expect(screen.getByText('Original wording')).toBeInTheDocument();
  });

  it('splits a multi-group cloze on save, and keeps the first card', async () => {
    // `CardEditor` hands back one payload per deletion group. The gate edits one
    // row, so it takes the first — the split itself belongs to ingest and to the
    // deck page, not here.
    const user = userEvent.setup();
    const onEdit = vi.fn();
    const cloze: StagedCard = {
      id: '1',
      index: 0,
      payload: { kind: 'cloze', text: 'The {{c1::first}} fact.' },
      sourceExcerpt: null,
    };
    render(<Harness initial={[cloze]} onEdit={onEdit} />);

    await user.click(screen.getByRole('button', { name: /edit/i }));
    const text = screen.getByLabelText('Text');
    await user.clear(text);
    // Pasted, not typed: `{{` is userEvent's escape for a literal brace, so
    // typing cloze markers produces something that is not a cloze marker.
    await user.click(text);
    await user.paste('The {{c1::first}} and {{c2::second}} facts.');
    await user.click(screen.getByRole('button', { name: /2 cards/i }));

    await waitFor(() => expect(onEdit).toHaveBeenCalledTimes(1));
    expect(onEdit.mock.calls[0]![1]).toEqual({
      kind: 'cloze',
      text: 'The {{c1::first}} and second facts.',
    });
  });
});

describe('while cards are still arriving', () => {
  it('shows a skeleton row for each card still to come', () => {
    render(<StagingList cards={[basic('1', 'Arrived')]} pending={3} />);
    expect(screen.getByText('Arrived')).toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(
      '1 cards so far, 3 still coming',
    );
  });

  it('offers no accept or reject controls during generation', () => {
    render(<StagingList cards={[basic('1', 'Arrived')]} pending={1} />);
    expect(screen.queryByRole('button', { name: /accept/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /reject/i })).not.toBeInTheDocument();
  });

  it('says what was skipped rather than quietly returning fewer cards', () => {
    render(
      <StagingList
        cards={[basic('1', 'Arrived')]}
        skipped={[{ index: 4, reason: 'back: Invalid input' }]}
      />,
    );
    expect(screen.getByText(/one card was skipped/i)).toBeInTheDocument();
    expect(screen.getByText('back: Invalid input')).toBeInTheDocument();
  });
});
