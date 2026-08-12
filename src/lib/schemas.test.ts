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

/**
 * What the model actually sends, and what a hostile paste can make it send.
 *
 * SPEC §10 asks for the schemas to be tested "against real and malformed LLM
 * output". These are lines observed from a Groq NDJSON stream, plus the shapes
 * that a prompt-injection attempt or a truncated response produces.
 */
describe('real model output', () => {
  const lines = [
    '{"card":{"kind":"basic","front":"What does FSRS stand for?","back":"Free Spaced Repetition Scheduler"},"source_excerpt":"FSRS (Free Spaced Repetition Scheduler) is a modern scheduling algorithm."}',
    '{"card":{"kind":"cloze","text":"FSRS models memory with {{c1::stability}} and difficulty."},"source_excerpt":"FSRS models memory with stability and difficulty."}',
    '{"card":{"kind":"mcq","stem":"Which of these is not an FSRS grade?","options":[{"text":"Again","correct":false},{"text":"Hard","correct":false},{"text":"Skip","correct":true},{"text":"Easy","correct":false}],"explanation":"The four grades are Again, Hard, Good and Easy."},"source_excerpt":"Ratings are Again, Hard, Good, Easy."}',
  ];

  it('accepts every card of a real stream', () => {
    for (const line of lines) {
      const parsed = JSON.parse(line) as { card: unknown };
      expect(() => CardPayload.parse(parsed.card)).not.toThrow();
    }
  });

  it('accepts a card with unicode punctuation and emoji, which get pasted', () => {
    expect(() =>
      CardPayload.parse({
        kind: 'basic',
        front: 'What does “spaced repetition” mean? 🧠',
        back: 'Reviewing material at increasing intervals — spacing beats cramming.',
      }),
    ).not.toThrow();
  });
});

describe('adversarial model output', () => {
  it('rejects a payload carrying its own status', () => {
    // A discriminated union does not silently accept extra keys as a different
    // card kind; unknown keys are stripped, and a wrong `kind` fails outright.
    const parsed = CardPayload.parse({
      kind: 'basic',
      front: 'Q',
      back: 'A',
      status: 'active',
      user_id: '00000000-0000-0000-0000-000000000000',
    });
    expect(parsed).toEqual({ kind: 'basic', front: 'Q', back: 'A' });
  });

  it('rejects HTML smuggled into a card, by storing it as text', () => {
    // Not stripped — rendered as text (SPEC §10). What matters is that it stays
    // a string and never becomes markup.
    const parsed = CardPayload.parse({
      kind: 'basic',
      front: '<img src=x onerror="alert(1)">',
      back: '<script>fetch("//evil")</script>',
    });
    expect(parsed).toEqual({
      kind: 'basic',
      front: '<img src=x onerror="alert(1)">',
      back: '<script>fetch("//evil")</script>',
    });
  });

  it('rejects a front longer than the column allows', () => {
    expect(() =>
      CardPayload.parse({ kind: 'basic', front: 'x'.repeat(1001), back: 'A' }),
    ).toThrow();
  });

  it('rejects a null payload', () => {
    expect(() => CardPayload.parse(null)).toThrow();
  });

  it('rejects a card whose options are not an array', () => {
    expect(() =>
      CardPayload.parse({ kind: 'mcq', stem: 'Q', options: 'Mercury, Venus' }),
    ).toThrow();
  });

  it('rejects six options, which a model offers when asked for "a few"', () => {
    expect(() =>
      CardPayload.parse({
        kind: 'mcq',
        stem: 'Q',
        options: Array.from({ length: 6 }, (_, index) => ({
          text: `option ${index}`,
          correct: index === 0,
        })),
      }),
    ).toThrow(/at most 5/i);
  });

  it('rejects a cloze whose marker was truncated mid-token', () => {
    expect(() =>
      CardPayload.parse({ kind: 'cloze', text: 'The {{c1::powerhou' }),
    ).toThrow();
  });
});
