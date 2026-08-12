import {
  CardPayload,
  countClozeGroups,
  splitClozeGroups,
  type CardKind,
} from '@/lib/schemas';

/**
 * The editor's working shape.
 *
 * This is *not* a second definition of a card — `CardPayload` in schemas.ts is
 * still the only one, and everything here is validated against it. It is a flat
 * bag of every field the three sub-forms use, which buys two things:
 *
 *   - switching card kind keeps what was already typed, because nothing is
 *     thrown away on the switch; and
 *   - react-hook-form deals with one object rather than a discriminated union,
 *     which it handles poorly.
 */
export type CardDraft = {
  kind: CardKind;
  front: string;
  back: string;
  text: string;
  hint: string;
  stem: string;
  explanation: string;
  options: Array<{ text: string; correct: boolean }>;
};

export const EMPTY_DRAFT: CardDraft = {
  kind: 'basic',
  front: '',
  back: '',
  text: '',
  hint: '',
  stem: '',
  explanation: '',
  options: [
    { text: '', correct: true },
    { text: '', correct: false },
    { text: '', correct: false },
  ],
};

export function draftFromPayload(payload: CardPayload): CardDraft {
  switch (payload.kind) {
    case 'basic':
      return { ...EMPTY_DRAFT, kind: 'basic', front: payload.front, back: payload.back };
    case 'cloze':
      return {
        ...EMPTY_DRAFT,
        kind: 'cloze',
        text: payload.text,
        hint: payload.hint ?? '',
      };
    case 'mcq':
      return {
        ...EMPTY_DRAFT,
        kind: 'mcq',
        stem: payload.stem,
        explanation: payload.explanation ?? '',
        options: payload.options.map(option => ({ ...option })),
      };
  }
}

/**
 * The prompt side of each kind, and the elaboration side.
 *
 * Switching from basic to cloze should not silently discard a sentence someone
 * just typed. These pairs say which fields mean roughly the same thing, so the
 * switch can carry text across when the destination is still empty.
 */
const PROMPT_FIELD = { basic: 'front', cloze: 'text', mcq: 'stem' } as const;
const DETAIL_FIELD = { basic: 'back', cloze: 'hint', mcq: 'explanation' } as const;

export function switchKind(draft: CardDraft, kind: CardKind): CardDraft {
  if (kind === draft.kind) return draft;

  const next: CardDraft = { ...draft, kind };
  const fromPrompt = draft[PROMPT_FIELD[draft.kind]];
  const toPrompt = PROMPT_FIELD[kind];
  if (fromPrompt.trim() && !next[toPrompt].trim()) next[toPrompt] = fromPrompt;

  const fromDetail = draft[DETAIL_FIELD[draft.kind]];
  const toDetail = DETAIL_FIELD[kind];
  if (fromDetail.trim() && !next[toDetail].trim()) next[toDetail] = fromDetail;

  return next;
}

/**
 * The card (or cards) a draft represents — unvalidated.
 *
 * A cloze draft can yield more than one: SPEC §5.3 stores one deletion group per
 * card, so a note carrying `{{c1::…}}` and `{{c2::…}}` becomes two rows. The
 * schema rejects multi-group text on purpose, and this is the seam where the
 * split happens, so what the user sees is two cards rather than a validation
 * error about a rule they have no way to act on.
 */
export function draftToPayloads(draft: CardDraft): CardPayload[] {
  switch (draft.kind) {
    case 'basic':
      return [{ kind: 'basic', front: draft.front, back: draft.back }];

    case 'cloze':
      return splitClozeGroups(draft.text).map(text => ({
        kind: 'cloze' as const,
        text,
        ...(draft.hint.trim() ? { hint: draft.hint } : {}),
      }));

    case 'mcq':
      return [
        {
          kind: 'mcq',
          stem: draft.stem,
          options: draft.options.map(option => ({
            text: option.text,
            correct: option.correct,
          })),
          ...(draft.explanation.trim() ? { explanation: draft.explanation } : {}),
        },
      ];
  }
}

/** How many cards saving this draft will produce. Shown next to the save button. */
export function draftCardCount(draft: CardDraft): number {
  if (draft.kind !== 'cloze') return 1;
  return Math.max(1, countClozeGroups(draft.text));
}
