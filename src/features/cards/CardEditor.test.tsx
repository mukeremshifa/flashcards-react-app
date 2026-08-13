import { describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CardEditor } from './CardEditor';
import type { CardPayload } from '@/lib/schemas';

/**
 * The failure this file exists for: a user pastes a note with two deletion
 * groups and is shown "Only one deletion group per card" — a rule they cannot
 * act on and did not ask about. The schema rejects multi-group text by design
 * (SPEC §5.3); the editor is where the split happens.
 */

function setup() {
  const onSubmit = vi.fn<(payloads: CardPayload[]) => void>();
  const user = userEvent.setup();
  render(<CardEditor onSubmit={onSubmit} />);
  return { user, onSubmit };
}

const chooseKind = (name: string) => screen.getByRole('button', { name });

describe('multi-group cloze', () => {
  it('splits a two-group paste into two cards', async () => {
    const { user, onSubmit } = setup();
    await user.click(chooseKind('Cloze'));

    await user.click(screen.getByLabelText('Text'));
    await user.paste(
      'The {{c1::mitochondrion}} produces most of the cell’s {{c2::ATP}}.',
    );

    // The editor says what saving will do before it is pressed.
    expect(screen.getByText(/2 deletion groups/i)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /2 cards/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1));
    const payloads = onSubmit.mock.calls[0]![0];
    expect(payloads).toHaveLength(2);
    expect(payloads[0]).toEqual({
      kind: 'cloze',
      text: 'The {{c1::mitochondrion}} produces most of the cell’s ATP.',
    });
    expect(payloads[1]).toEqual({
      kind: 'cloze',
      text: 'The mitochondrion produces most of the cell’s {{c2::ATP}}.',
    });
  });

  it('shows no validation error for the multi-group text', async () => {
    const { user, onSubmit } = setup();
    await user.click(chooseKind('Cloze'));
    await user.click(screen.getByLabelText('Text'));
    await user.paste('{{c1::Alpha}} and {{c2::Beta}} and {{c3::Gamma}}.');
    await user.click(screen.getByRole('button', { name: /3 cards/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(onSubmit.mock.calls[0]![0]).toHaveLength(3);
  });

  it('carries the hint onto every card the split produces', async () => {
    const { user, onSubmit } = setup();
    await user.click(chooseKind('Cloze'));
    await user.click(screen.getByLabelText('Text'));
    await user.paste('{{c1::One}} then {{c2::Two}}');
    await user.type(screen.getByLabelText(/hint/i), 'counting');
    await user.click(screen.getByRole('button', { name: /2 cards/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    for (const payload of onSubmit.mock.calls[0]![0]) {
      expect(payload).toMatchObject({ hint: 'counting' });
    }
  });

  it('still rejects cloze text with no deletion at all', async () => {
    const { user, onSubmit } = setup();
    await user.click(chooseKind('Cloze'));
    await user.type(screen.getByLabelText('Text'), 'A sentence with nothing hidden.');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/at least one/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('switching card type', () => {
  it('keeps text that means the same thing on the other side', async () => {
    const { user } = setup();
    await user.type(screen.getByLabelText('Front'), 'Capital of France');
    await user.type(screen.getByLabelText('Back'), 'Paris');

    await user.click(chooseKind('Multiple choice'));
    // The prompt survives the switch; retyping it is the thing users hate.
    expect(screen.getByLabelText('Question')).toHaveValue('Capital of France');
    expect(screen.getByLabelText(/explanation/i)).toHaveValue('Paris');

    await user.click(chooseKind('Basic'));
    expect(screen.getByLabelText('Front')).toHaveValue('Capital of France');
    expect(screen.getByLabelText('Back')).toHaveValue('Paris');
  });
});

describe('the other two kinds', () => {
  it('saves a basic card', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText('Front'), 'What is 2 + 2?');
    await user.type(screen.getByLabelText('Back'), '4');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual([
      { kind: 'basic', front: 'What is 2 + 2?', back: '4' },
    ]);
  });

  it('refuses a basic card with an empty side', async () => {
    const { user, onSubmit } = setup();
    await user.type(screen.getByLabelText('Front'), 'Only a front');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toHaveTextContent(/back is required/i);
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it('saves a multiple-choice card with exactly one correct option', async () => {
    const { user, onSubmit } = setup();
    await user.click(chooseKind('Multiple choice'));
    await user.type(screen.getByLabelText('Question'), 'Pick the vowel');
    await user.type(screen.getByLabelText('Option 1'), 'b');
    await user.type(screen.getByLabelText('Option 2'), 'a');
    await user.type(screen.getByLabelText('Option 3'), 'c');
    await user.click(screen.getByLabelText('Option 2 is correct'));
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual([
      {
        kind: 'mcq',
        stem: 'Pick the vowel',
        options: [
          { text: 'b', correct: false },
          { text: 'a', correct: true },
          { text: 'c', correct: false },
        ],
      },
    ]);
  });

  it('keeps exactly one option marked correct', async () => {
    const { user } = setup();
    await user.click(chooseKind('Multiple choice'));
    await user.click(screen.getByLabelText('Option 3 is correct'));

    expect(screen.getByLabelText('Option 3 is correct')).toBeChecked();
    expect(screen.getByLabelText('Option 1 is correct')).not.toBeChecked();
  });

  it('refuses a multiple-choice card with a blank option', async () => {
    const { user, onSubmit } = setup();
    await user.click(chooseKind('Multiple choice'));
    await user.type(screen.getByLabelText('Question'), 'Incomplete');
    await user.type(screen.getByLabelText('Option 1'), 'only one filled in');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    expect(await screen.findByRole('alert')).toBeInTheDocument();
    expect(onSubmit).not.toHaveBeenCalled();
  });
});

describe('editing an existing card', () => {
  it('opens with the card loaded and returns the edit', async () => {
    const onSubmit = vi.fn<(payloads: CardPayload[]) => void>();
    const user = userEvent.setup();
    render(
      <CardEditor
        defaultValue={{ kind: 'basic', front: 'Old front', back: 'Old back' }}
        onSubmit={onSubmit}
      />,
    );

    expect(screen.getByLabelText('Front')).toHaveValue('Old front');
    await user.clear(screen.getByLabelText('Front'));
    await user.type(screen.getByLabelText('Front'), 'New front');
    await user.click(screen.getByRole('button', { name: /save card/i }));

    await waitFor(() => expect(onSubmit).toHaveBeenCalled());
    expect(onSubmit.mock.calls[0]![0]).toEqual([
      { kind: 'basic', front: 'New front', back: 'Old back' },
    ]);
  });
});
