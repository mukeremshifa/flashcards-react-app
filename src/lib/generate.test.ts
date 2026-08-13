import { describe, expect, it } from 'vitest';
import { ingestLine, suggestDeckTitle } from './generate';

/**
 * One line of model output at a time — the seam where untrusted text becomes
 * rows (SPEC §7.3).
 *
 * The rule under test everywhere here: a line the model got wrong costs that
 * line and nothing else.
 */

const line = (value: unknown) => JSON.stringify(value);

describe('well-formed lines', () => {
  it('accepts the documented shape', () => {
    const result = ingestLine(
      line({
        card: { kind: 'basic', front: 'What is ATP?', back: 'Adenosine triphosphate' },
        source_excerpt: 'ATP is the energy currency of the cell.',
      }),
    );

    expect(result).toEqual({
      ok: true,
      cards: [
        {
          payload: {
            kind: 'basic',
            front: 'What is ATP?',
            back: 'Adenosine triphosphate',
          },
          sourceExcerpt: 'ATP is the energy currency of the cell.',
        },
      ],
    });
  });

  it('accepts a bare payload, which models emit about as often', () => {
    const result = ingestLine(line({ kind: 'basic', front: 'Q', back: 'A' }));
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cards[0]?.payload.kind).toBe('basic');
  });

  it('keeps an mcq intact, options and all', () => {
    const result = ingestLine(
      line({
        card: {
          kind: 'mcq',
          stem: 'Which organelle makes most ATP?',
          options: [
            { text: 'Mitochondrion', correct: true },
            { text: 'Ribosome', correct: false },
            { text: 'Golgi apparatus', correct: false },
          ],
          explanation: 'Oxidative phosphorylation happens there.',
        },
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.cards[0]?.payload.kind === 'mcq') {
      expect(result.cards[0].payload.options).toHaveLength(3);
    }
  });
});

describe('multi-group cloze', () => {
  it('splits a two-group note into two cards rather than rejecting it', () => {
    // The schema rejects multi-group text on purpose (SPEC §5.3) and the model
    // produces it constantly. Ingest is where the split happens — the same seam
    // the editor implements on the client, using the same function.
    const result = ingestLine(
      line({
        card: {
          kind: 'cloze',
          text: 'The {{c1::mitochondrion}} produces most of the cell’s {{c2::ATP}}.',
        },
        source_excerpt: 'The mitochondrion produces most of the cell’s ATP.',
      }),
    );

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.cards).toHaveLength(2);
    expect(result.cards[0]?.payload).toEqual({
      kind: 'cloze',
      text: 'The {{c1::mitochondrion}} produces most of the cell’s ATP.',
    });
    expect(result.cards[1]?.payload).toEqual({
      kind: 'cloze',
      text: 'The mitochondrion produces most of the cell’s {{c2::ATP}}.',
    });
    // Provenance survives the split; both halves came from the same sentence.
    expect(result.cards[1]?.sourceExcerpt).toBe(
      'The mitochondrion produces most of the cell’s ATP.',
    );
  });

  it('carries the hint onto every card of a split', () => {
    const result = ingestLine(
      line({
        card: {
          kind: 'cloze',
          text: '{{c1::Cats}} and {{c2::dogs}} are mammals.',
          hint: 'Two pets',
        },
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.cards).toHaveLength(2);
      for (const card of result.cards) {
        expect(card.payload.kind === 'cloze' && card.payload.hint).toBe('Two pets');
      }
    }
  });

  it('keeps the good half when one group of a split is unusable', () => {
    const result = ingestLine(
      line({ card: { kind: 'cloze', text: 'A {{c1::real}} one and {{c2:: }} empty.' } }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cards).toHaveLength(1);
  });
});

describe('lines the model got wrong', () => {
  it('reports invalid JSON without throwing', () => {
    const result = ingestLine('{"card": {"kind": "basic", "front"');
    expect(result).toEqual({
      ok: false,
      reason: 'The model emitted a line that was not valid JSON.',
    });
  });

  it('rejects prose, which is what a content refusal looks like', () => {
    expect(ingestLine('I cannot create flashcards from this text.').ok).toBe(false);
  });

  it('rejects an array line', () => {
    expect(ingestLine('[{"kind":"basic","front":"Q","back":"A"}]').ok).toBe(false);
  });

  it('rejects a card missing half of itself, with the schema’s own reason', () => {
    const result = ingestLine(line({ card: { kind: 'basic', front: 'Q' } }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/back/i);
  });

  it('rejects an mcq with two correct answers', () => {
    const result = ingestLine(
      line({
        card: {
          kind: 'mcq',
          stem: 'Pick one',
          options: [
            { text: 'a', correct: true },
            { text: 'b', correct: true },
            { text: 'c', correct: false },
          ],
        },
      }),
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/exactly one/i);
  });

  it('rejects a cloze with no deletion at all', () => {
    expect(
      ingestLine(line({ card: { kind: 'cloze', text: 'Nothing to recall.' } })).ok,
    ).toBe(false);
  });

  it('rejects an unknown card kind', () => {
    expect(ingestLine(line({ card: { kind: 'essay', prompt: 'Discuss' } })).ok).toBe(
      false,
    );
  });
});

describe('source excerpts', () => {
  it('trims an over-long excerpt instead of losing the card', () => {
    const result = ingestLine(
      line({
        card: { kind: 'basic', front: 'Q', back: 'A' },
        source_excerpt: 'x'.repeat(3000),
      }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cards[0]?.sourceExcerpt).toHaveLength(2000);
  });

  it('treats a non-string excerpt as absent', () => {
    const result = ingestLine(
      line({ card: { kind: 'basic', front: 'Q', back: 'A' }, source_excerpt: 42 }),
    );
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.cards[0]?.sourceExcerpt).toBeNull();
  });
});

describe('suggestDeckTitle', () => {
  it('uses the first line', () => {
    expect(suggestDeckTitle('Cell biology\n\nThe mitochondrion…')).toBe('Cell biology');
  });

  it('strips markdown heading marks', () => {
    expect(suggestDeckTitle('## Photosynthesis\ntext')).toBe('Photosynthesis');
  });

  it('cuts a long opening at a word boundary', () => {
    const title = suggestDeckTitle(
      'The mitochondrion is an organelle found in the cells of most eukaryotes and it does a great deal',
    );
    expect(title.length).toBeLessThanOrEqual(60);
    expect(title.endsWith(' ')).toBe(false);
  });

  it('returns an empty string for empty text, rather than a placeholder', () => {
    expect(suggestDeckTitle('   \n  ')).toBe('');
  });
});
