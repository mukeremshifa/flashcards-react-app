import type { TestDb } from './pg-harness';
import type { CardScheduling, FsrsStateName, SchedulingUpdate } from '@/lib/fsrs';

/**
 * Seeding helpers shared by the RPC tests. Everything here runs through the same
 * migrations and the same RLS the app does — `actAs` first, then insert.
 */

export type SeedCardOptions = Partial<CardScheduling> & {
  status?: 'draft' | 'active' | 'suspended' | 'archived';
  front?: string;
};

export async function seedDeck(
  db: TestDb,
  userId: string,
  title = 'Test deck',
): Promise<string> {
  await db.actAs(userId);
  const result = await db.raw.query<{ id: string }>(
    'insert into decks (user_id, title) values ($1, $2) returning id',
    [userId, title],
  );
  return result.rows[0]!.id;
}

export async function seedCard(
  db: TestDb,
  userId: string,
  deckId: string,
  options: SeedCardOptions = {},
): Promise<string> {
  await db.actAs(userId);
  const payload = JSON.stringify({
    kind: 'basic',
    front: options.front ?? 'front',
    back: 'back',
  });

  const result = await db.raw.query<{ id: string }>(
    `insert into cards (
       user_id, deck_id, kind, payload, status,
       fsrs_state, stability, difficulty, due, last_review,
       reps, lapses, scheduled_days, elapsed_days, learning_steps
     ) values (
       $1, $2, 'basic', $3::jsonb, $4::card_status,
       $5::fsrs_state, $6, $7, $8::timestamptz, $9::timestamptz,
       $10, $11, $12, $13, $14
     ) returning id`,
    [
      userId,
      deckId,
      payload,
      options.status ?? 'active',
      options.fsrs_state ?? 'new',
      options.stability ?? null,
      options.difficulty ?? null,
      options.due ?? new Date().toISOString(),
      options.last_review ?? null,
      options.reps ?? 0,
      options.lapses ?? 0,
      options.scheduled_days ?? 0,
      options.elapsed_days ?? 0,
      options.learning_steps ?? 0,
    ],
  );
  return result.rows[0]!.id;
}

export type CardRow = CardScheduling & {
  id: string;
  status: string;
  updated_at: string;
};

/**
 * Read a card back as the client sees it: timestamps as text.
 *
 * That detail matters. `updated_at` carries microseconds, a JavaScript `Date`
 * carries milliseconds, and the optimistic-concurrency check in `review_card` is
 * an equality test. Round-tripping through text is what PostgREST does and what
 * keeps the comparison exact.
 */
export async function readCard(db: TestDb, cardId: string): Promise<CardRow> {
  const result = await db.raw.query<CardRow>(
    `select id, status, fsrs_state, stability, difficulty,
            due::text as due, last_review::text as last_review,
            reps, lapses, scheduled_days, elapsed_days, learning_steps,
            updated_at::text as updated_at
     from cards where id = $1`,
    [cardId],
  );
  const row = result.rows[0];
  if (!row) throw new Error(`card ${cardId} not visible to the current role`);
  return row;
}

/** Call `review_card` exactly as src/lib/queries.ts does. */
export async function reviewCard(
  db: TestDb,
  args: {
    cardId: string;
    rating: number;
    durationMs?: number | null;
    expectedUpdatedAt: string;
    next: SchedulingUpdate | Record<string, unknown>;
  },
): Promise<CardRow> {
  const result = await db.raw.query<CardRow>(
    `select * from review_card($1::uuid, $2::smallint, $3::int, $4::timestamptz, $5::jsonb)`,
    [
      args.cardId,
      args.rating,
      args.durationMs ?? null,
      args.expectedUpdatedAt,
      JSON.stringify(args.next),
    ],
  );
  return result.rows[0]!;
}

export async function undoLastReview(db: TestDb, cardId: string): Promise<CardRow> {
  const result = await db.raw.query<CardRow>('select * from undo_last_review($1::uuid)', [
    cardId,
  ]);
  return result.rows[0]!;
}

/** The scheduling columns of a card, in the shape src/lib/fsrs.ts expects. */
export function schedulingOf(card: CardRow): CardScheduling {
  return {
    fsrs_state: card.fsrs_state,
    stability: card.stability,
    difficulty: card.difficulty,
    due: card.due,
    last_review: card.last_review,
    reps: card.reps,
    lapses: card.lapses,
    scheduled_days: card.scheduled_days,
    elapsed_days: card.elapsed_days,
    learning_steps: card.learning_steps,
  };
}

/**
 * Insert a `reviews` row directly, at a chosen instant.
 *
 * `review_card` stamps `reviewed_at` with `now()`, which is right for the app
 * and useless for testing an aggregate that buckets by day: a month of history
 * has to be *placed*, not accumulated. This goes in as the user, so the same RLS
 * insert policy applies — a row this fixture can write is a row the app could
 * have written.
 */
export async function seedReview(
  db: TestDb,
  userId: string,
  cardId: string,
  options: {
    reviewedAt: string | Date;
    rating?: number;
    stateBefore?: FsrsStateName;
    stateAfter?: FsrsStateName;
    stabilityAfter?: number | null;
    difficultyAfter?: number | null;
    undoneAt?: string | Date | null;
  },
): Promise<string> {
  await db.actAs(userId);
  const at =
    options.reviewedAt instanceof Date
      ? options.reviewedAt.toISOString()
      : options.reviewedAt;
  const undone =
    options.undoneAt instanceof Date
      ? options.undoneAt.toISOString()
      : (options.undoneAt ?? null);

  const result = await db.raw.query<{ id: string }>(
    `insert into reviews (
       user_id, card_id, rating, reviewed_at,
       state_before, stability_before, difficulty_before, due_before,
       elapsed_days, scheduled_days,
       state_after, stability_after, difficulty_after,
       undone_at
     ) values (
       $1, $2, $3::smallint, $4::timestamptz,
       $5::fsrs_state, null, null, $4::timestamptz,
       0, 0,
       $6::fsrs_state, $7, $8,
       $9::timestamptz
     ) returning id`,
    [
      userId,
      cardId,
      options.rating ?? 3,
      at,
      options.stateBefore ?? 'review',
      options.stateAfter ?? 'review',
      options.stabilityAfter ?? null,
      options.difficultyAfter ?? null,
      undone,
    ],
  );
  return result.rows[0]!.id;
}
