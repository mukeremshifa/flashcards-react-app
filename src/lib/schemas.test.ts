import { describe, expect, it } from 'vitest';
import {
  CardPayload,
  GenerateRequest,
  countClozeGroups,
  parseCloze,
  splitClozeGroups,
} from './schemas';

/**
 * These schemas are the boundary between untrusted model output and the database,
 * so the interesting cases are the malformed ones (SPEC §10).
 */

describe('basic cards', () => {
  it('accepts a well-formed card and trims whitespace', () => {
    const result = CardPayload.parse({
      kind: 'basic',
      front: '  What is the capital of France?  ',
      back: 'Paris',
    });
    expect(result).toEqual({
      kind: 'basic',
      front: 'What is the capital of France?',
      back: 'Paris',
    });
  });

  it('rejects an empty back', () => {
    expect(() => CardPayload.parse({ kind: 'basic', front: 'Q', back: '   ' })).toThrow();
  });

  it('rejects an unknown kind', () => {
    expect(() => CardPayload.parse({ kind: 'essay', prompt: 'Discuss' })).toThrow();
  });
});

describe('cloze cards', () => {
  it('accepts a single deletion group', () => {
    const result = CardPayload.parse({
      kind: 'cloze',
      text: 'The mitochondrion is the {{c1::powerhouse}} of the cell.',
    });
    expect(result.kind).toBe('cloze');
  });

  it('rejects text with no deletion', () => {
    expect(() =>
      CardPayload.parse({ kind: 'cloze', text: 'No deletion markers here.' }),
    ).toThrow(/at least one/i);
  });

  it('rejects an empty deletion', () => {
    expect(() =>
      CardPayload.parse({ kind: 'cloze', text: 'Empty {{c1::}} here.' }),
    ).toThrow(/at least one/i);
  });

  it('rejects multiple groups so ingest must split them first', () => {
    expect(() =>
      CardPayload.parse({
        kind: 'cloze',
        text: '{{c1::Kepler}} described {{c2::elliptical}} orbits.',
      }),
    ).toThrow(/one deletion group/i);
  });

  it('counts repeated markers in the same group once', () => {
    expect(countClozeGroups('{{c1::a}} and {{c1::b}}')).toBe(1);
    expect(countClozeGroups('{{c1::a}} and {{c2::b}}')).toBe(2);
  });
});

describe('splitClozeGroups', () => {
  it('leaves a single-group note alone', () => {
    const text = 'Water boils at {{c1::100}} degrees.';
    expect(splitClozeGroups(text)).toEqual([text]);
  });

  it('produces one card per group, unwrapping the others', () => {
    const result = splitClozeGroups(
      '{{c1::Kepler}} described {{c2::elliptical}} orbits.',
    );
    expect(result).toEqual([
      '{{c1::Kepler}} described elliptical orbits.',
      'Kepler described {{c2::elliptical}} orbits.',
    ]);
  });

  it('produces cards that each pass validation', () => {
    for (const text of splitClozeGroups('{{c1::A}} then {{c2::B}} then {{c3::C}}')) {
      expect(() => CardPayload.parse({ kind: 'cloze', text })).not.toThrow();
    }
  });
});

describe('parseCloze', () => {
  it('splits into renderable segments', () => {
    expect(parseCloze('Water boils at {{c1::100}} degrees.')).toEqual([
      { text: 'Water boils at ', blank: false },
      { text: '100', blank: true },
      { text: ' degrees.', blank: false },
    ]);
  });

  it('handles a deletion at the very start', () => {
    expect(parseCloze('{{c1::Paris}} is the capital.')).toEqual([
      { text: 'Paris', blank: true },
      { text: ' is the capital.', blank: false },
    ]);
  });
});

describe('mcq cards', () => {
  const base = {
    kind: 'mcq' as const,
    stem: 'Which planet is closest to the Sun?',
    options: [
      { text: 'Mercury', correct: true },
      { text: 'Venus', correct: false },
      { text: 'Earth', correct: false },
    ],
  };

  it('accepts exactly one correct option', () => {
    expect(() => CardPayload.parse(base)).not.toThrow();
  });

  it('rejects two correct options', () => {
    const options = base.options.map(option => ({ ...option, correct: true }));
    expect(() => CardPayload.parse({ ...base, options })).toThrow(/exactly one/i);
  });

  it('rejects zero correct options', () => {
    const options = base.options.map(option => ({ ...option, correct: false }));
    expect(() => CardPayload.parse({ ...base, options })).toThrow(/exactly one/i);
  });

  it('rejects fewer than three options', () => {
    expect(() =>
      CardPayload.parse({ ...base, options: base.options.slice(0, 2) }),
    ).toThrow(/at least 3/i);
  });

  it('rejects duplicate options that differ only by case', () => {
    const options = [
      { text: 'Mercury', correct: true },
      { text: 'mercury', correct: false },
      { text: 'Venus', correct: false },
    ];
    expect(() => CardPayload.parse({ ...base, options })).toThrow(/distinct/i);
  });
});

describe('GenerateRequest', () => {
  const valid = {
    text: 'x'.repeat(200),
    cardCount: 10,
    kinds: ['basic'],
    deckTitle: 'Chapter 4',
  };

  it('defaults depth to balanced', () => {
    expect(GenerateRequest.parse(valid).depth).toBe('balanced');
  });

  it('rejects text below the minimum length', () => {
    expect(() => GenerateRequest.parse({ ...valid, text: 'too short' })).toThrow();
  });

  it('rejects text above the maximum length', () => {
    expect(() => GenerateRequest.parse({ ...valid, text: 'x'.repeat(20_001) })).toThrow();
  });

  it('rejects an empty kinds list', () => {
    expect(() => GenerateRequest.parse({ ...valid, kinds: [] })).toThrow();
  });

  it('rejects a card count above the cap', () => {
    expect(() => GenerateRequest.parse({ ...valid, cardCount: 51 })).toThrow();
  });
});
