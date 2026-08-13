import { CLOZE_MARKER, type CardPayload } from '@/lib/schemas';

/**
 * A one-line rendering of a card, for tables and lists.
 *
 * Cloze markers are unwrapped rather than shown raw: `{{c1::powerhouse}}` in a
 * list of cards is noise, and the deletion is not the point when you are
 * scanning for the card you want to edit.
 */
export function cardSummary(payload: CardPayload): string {
  switch (payload.kind) {
    case 'basic':
      return payload.front;
    case 'cloze':
      return payload.text.replace(
        CLOZE_MARKER,
        (_whole, _group, content: string) => content,
      );
    case 'mcq':
      return payload.stem;
  }
}
