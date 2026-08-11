// @vitest-environment node
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestDb, type TestDb } from './pg-harness';

/**
 * SPEC §10: "RLS on every table, verified by a test that queries as user B for
 * user A's rows." This is that test. It is the one test in the suite whose
 * failure means a data breach rather than a bug.
 */

let db: TestDb;
let alice: string;
let bob: string;
let aliceDeck: string;
let aliceCard: string;

beforeAll(async () => {
  db = await createTestDb();
  alice = await db.createUser('alice@example.com');
  bob = await db.createUser('bob@example.com');

  await db.actAs(alice);
  const deck = await db.raw.query<{ id: string }>(
    "insert into decks (user_id, title) values ($1, 'Alice deck') returning id",
    [alice],
  );
  aliceDeck = deck.rows[0]!.id;

  const card = await db.raw.query<{ id: string }>(
    `insert into cards (user_id, deck_id, kind, payload)
     values ($1, $2, 'basic', '{"kind":"basic","front":"f","back":"b"}'::jsonb)
     returning id`,
    [alice, aliceDeck],
  );
  aliceCard = card.rows[0]!.id;
}, 60_000);

afterAll(async () => {
  await db?.close();
});

describe('profile provisioning', () => {
  it('creates a profile row for every new auth user', async () => {
    await db.actAs(alice);
    const result = await db.raw.query('select id, timezone from profiles');
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ id: alice, timezone: 'UTC' });
  });
});

describe('cross-user isolation', () => {
  it("hides Alice's deck from Bob", async () => {
    await db.actAs(bob);
    const result = await db.raw.query('select id from decks');
    expect(result.rows).toEqual([]);
  });

  it("hides Alice's cards from Bob", async () => {
    await db.actAs(bob);
    const result = await db.raw.query('select id from cards');
    expect(result.rows).toEqual([]);
  });

  it("stops Bob updating Alice's card", async () => {
    await db.actAs(bob);
    const result = await db.raw.query(
      "update cards set status = 'archived' where id = $1",
      [aliceCard],
    );
    // No matching UPDATE policy row -> filtered out, zero rows touched.
    expect(result.affectedRows).toBe(0);

    await db.actAs(alice);
    const check = await db.raw.query<{ status: string }>(
      'select status from cards where id = $1',
      [aliceCard],
    );
    expect(check.rows[0]?.status).toBe('active');
  });

  it("stops Bob deleting Alice's deck", async () => {
    await db.actAs(bob);
    const result = await db.raw.query('delete from decks where id = $1', [aliceDeck]);
    expect(result.affectedRows).toBe(0);
  });

  it('stops Bob forging a row owned by Alice', async () => {
    await db.actAs(bob);
    await expect(
      db.raw.query("insert into decks (user_id, title) values ($1, 'forged')", [alice]),
    ).rejects.toThrow(/row-level security/i);
  });

  it("stops Bob parking a card in Alice's deck", async () => {
    await db.actAs(bob);
    await expect(
      db.raw.query(
        `insert into cards (user_id, deck_id, kind, payload)
         values ($1, $2, 'basic', '{"kind":"basic","front":"f","back":"b"}'::jsonb)`,
        [bob, aliceDeck],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("stops Bob reading Alice's generation history", async () => {
    await db.actAs(alice);
    await db.raw.query(
      `insert into generations (user_id, source, model, input_chars, cards_requested)
       values ($1, 'text', 'test-model', 500, 10)`,
      [alice],
    );

    await db.actAs(bob);
    const result = await db.raw.query('select id from generations');
    expect(result.rows).toEqual([]);
  });
});

describe('review log is append-only', () => {
  it('accepts an insert from the card owner', async () => {
    await db.actAs(alice);
    await db.raw.query(
      `insert into reviews (user_id, card_id, rating, state_before, elapsed_days,
                            scheduled_days, state_after, stability_after, difficulty_after)
       values ($1, $2, 3, 'new', 0, 0, 'learning', 1.2, 5.0)`,
      [alice, aliceCard],
    );
    const result = await db.raw.query('select id from reviews');
    expect(result.rows).toHaveLength(1);
  });

  it('permits no update, even by the owner', async () => {
    await db.actAs(alice);
    const result = await db.raw.query('update reviews set rating = 1');
    expect(result.affectedRows).toBe(0);
  });

  it('permits no delete, even by the owner', async () => {
    await db.actAs(alice);
    const result = await db.raw.query('delete from reviews');
    expect(result.affectedRows).toBe(0);
  });

  it("stops Bob logging a review against Alice's card", async () => {
    await db.actAs(bob);
    await expect(
      db.raw.query(
        `insert into reviews (user_id, card_id, rating, state_before, elapsed_days,
                              scheduled_days, state_after)
         values ($1, $2, 3, 'new', 0, 0, 'learning')`,
        [bob, aliceCard],
      ),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe('schema constraints', () => {
  it('rejects a payload missing its kind-specific keys', async () => {
    await db.actAs(alice);
    await expect(
      db.raw.query(
        `insert into cards (user_id, deck_id, kind, payload)
         values ($1, $2, 'mcq', '{"kind":"mcq","stem":"no options here"}'::jsonb)`,
        [alice, aliceDeck],
      ),
    ).rejects.toThrow(/cards_payload_shape/);
  });

  it('rejects a reviewed card with no FSRS state', async () => {
    await db.actAs(alice);
    await expect(
      db.raw.query(
        `insert into cards (user_id, deck_id, kind, payload, fsrs_state, last_review)
         values ($1, $2, 'basic', '{"kind":"basic","front":"f","back":"b"}'::jsonb,
                 'review', now())`,
        [alice, aliceDeck],
      ),
    ).rejects.toThrow(/cards_state_consistency/);
  });

  it('rejects an out-of-range review rating', async () => {
    await db.actAs(alice);
    await expect(
      db.raw.query(
        `insert into reviews (user_id, card_id, rating, state_before, elapsed_days,
                              scheduled_days, state_after)
         values ($1, $2, 5, 'new', 0, 0, 'learning')`,
        [alice, aliceCard],
      ),
    ).rejects.toThrow(/reviews_rating_check/);
  });
});
