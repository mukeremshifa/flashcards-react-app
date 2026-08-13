/**
 * Turning one line of model output into cards.
 *
 * This is the seam between untrusted text and the database (SPEC §7.3). It runs
 * inside the Edge Function, once per NDJSON line, and it has one rule: a line
 * the model got wrong costs that line and nothing else. Nineteen good cards must
 * not be lost to the twentieth, so every path here returns either cards or a
 * reason, and never throws.
 *
 * Pure, so the cases that matter — a malformed line mid-stream, a multi-group
 * cloze, an excerpt longer than the column allows — are ordinary unit tests
 * rather than something you can only find by pasting an essay and hoping.
 */

import { GeneratedCard, splitClozeGroups, type CardPayload } from './schemas.ts';
import { parseJsonLine } from './ndjson.ts';

/** The longest `source_excerpt` the schema and the column both accept. */
const MAX_EXCERPT_CHARS = 2000;

export type IngestedCard = {
  payload: CardPayload;
  /** The slice of source text this card came from; shown in the review gate. */
  sourceExcerpt: string | null;
};

export type IngestResult =
  { ok: true; cards: IngestedCard[] } | { ok: false; reason: string };

/**
 * One NDJSON line in, zero or more validated cards out.
 *
 * The documented contract is `{"card": {...}, "source_excerpt": "..."}`, but a
 * model that has been told to emit cards will sometimes emit the card itself, so
 * a bare payload is accepted too. That is not schema drift: both shapes end up
 * validated by the same `GeneratedCard`, which is built from the same
 * `CardPayload` the browser renders and the editor writes.
 */
export function ingestLine(line: string): IngestResult {
  const parsed = parseJsonLine(line);
  if (!parsed.ok) {
    return { ok: false, reason: 'The model emitted a line that was not valid JSON.' };
  }

  const value = parsed.value;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return { ok: false, reason: 'The model emitted something that was not a card.' };
  }

  const record = value as Record<string, unknown>;
  const card = 'card' in record ? record.card : record;
  const sourceExcerpt = normaliseExcerpt(record.source_excerpt);

  const candidates = expandClozeGroups(card);

  const cards: IngestedCard[] = [];
  let firstFailure = 'The card did not match any known card type.';

  for (const candidate of candidates) {
    const result = GeneratedCard.safeParse({
      card: candidate,
      // Normalised rather than validated: an excerpt three characters over the
      // limit is a provenance note to trim, not a reason to throw away a good
      // card. Everything that *defines* the card still goes through the schema.
      ...(sourceExcerpt === null ? {} : { source_excerpt: sourceExcerpt }),
    });

    if (result.success) {
      cards.push({ payload: result.data.card, sourceExcerpt });
    } else {
      const issue = result.error.issues[0];
      if (issue) firstFailure = describeIssue(issue);
    }
  }

  if (cards.length === 0) return { ok: false, reason: firstFailure };
  return { ok: true, cards };
}

/**
 * Split a multi-group cloze before validation, not after.
 *
 * SPEC §5.3 stores one deletion group per card and the schema enforces it, so a
 * note carrying `{{c1::…}}` and `{{c2::…}}` — which the model produces
 * constantly — would otherwise be rejected wholesale. `splitClozeGroups` is the
 * same function `card-draft.ts` uses on the client for the same reason: the
 * split is one behaviour, implemented once (SPEC §12 decision 5).
 */
function expandClozeGroups(card: unknown): unknown[] {
  if (typeof card !== 'object' || card === null) return [card];

  const record = card as Record<string, unknown>;
  if (record.kind !== 'cloze' || typeof record.text !== 'string') return [card];

  return splitClozeGroups(record.text).map(text => ({ ...record, text }));
}

/**
 * A skipped card's reason, as it appears under the staging list.
 *
 * Zod's message for a missing field is "expected string, received undefined",
 * which says nothing about *which* field. The path is the useful half, so it
 * goes in front — minus the `card` prefix every path here starts with.
 */
function describeIssue(issue: { path: PropertyKey[]; message: string }): string {
  const field = issue.path.filter(part => part !== 'card').join('.');
  return field ? `${field}: ${issue.message}` : issue.message;
}

function normaliseExcerpt(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim().slice(0, MAX_EXCERPT_CHARS).trim();
  return trimmed === '' ? null : trimmed;
}

/**
 * A deck title guessed from the pasted text (SPEC §4.1 step 2).
 *
 * A heading if the text has one, otherwise the opening words. Advisory: the
 * field stays editable, and this only has to be better than an empty box.
 */
export function suggestDeckTitle(text: string): string {
  const firstLine = text
    .split('\n')
    .map(line => line.replace(/^#+\s*/, '').trim())
    .find(line => line.length > 0);

  if (!firstLine) return '';
  if (firstLine.length <= 60) return firstLine;

  const cut = firstLine.slice(0, 60);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > 30 ? cut.slice(0, lastSpace) : cut).trim();
}
