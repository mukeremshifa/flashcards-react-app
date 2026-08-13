import { describe, expect, it } from 'vitest';
import {
  countsTowardQuota,
  decideGeneration,
  estimateTokens,
  GENERATION_QUOTA,
  monthWindow,
  quotaCountFilter,
  rateWindowStart,
  remainingGenerations,
  staleRunningBefore,
} from './quota';

/**
 * The quota is the only thing standing between one user and a shared free-tier
 * key. Both directions of an off-by-one matter here: blocking a legitimate
 * generation is as much a bug as letting an extra one through.
 */

const NOW = new Date('2026-08-12T10:00:00.000Z');

function counts(overrides: Partial<Parameters<typeof decideGeneration>[0]> = {}) {
  return {
    usedThisMonth: 0,
    inWindow: 0,
    running: 0,
    promptChars: 5_000,
    ...overrides,
  };
}

describe('the monthly cap', () => {
  it('allows the last generation of the month', () => {
    const decision = decideGeneration(
      counts({ usedThisMonth: GENERATION_QUOTA.monthlyGenerations - 1 }),
    );
    expect(decision.allowed).toBe(true);
  });

  it('refuses the one after it', () => {
    const decision = decideGeneration(
      counts({ usedThisMonth: GENERATION_QUOTA.monthlyGenerations }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('quota_exceeded');
  });

  it('refuses a count somehow past the cap, rather than wrapping', () => {
    const decision = decideGeneration(
      counts({ usedThisMonth: GENERATION_QUOTA.monthlyGenerations + 5 }),
    );
    expect(decision.allowed).toBe(false);
  });

  it('is reported before a rate limit, because it cannot be waited out', () => {
    const decision = decideGeneration(
      counts({
        usedThisMonth: GENERATION_QUOTA.monthlyGenerations,
        inWindow: GENERATION_QUOTA.perWindow,
        running: 1,
      }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('quota_exceeded');
  });

  it('says when the allowance comes back', () => {
    const decision = decideGeneration(
      counts({ usedThisMonth: GENERATION_QUOTA.monthlyGenerations }),
    );
    if (!decision.allowed) expect(decision.message).toMatch(/resets on the 1st/i);
  });
});

describe('the burst limiter', () => {
  it('allows the last request inside the window', () => {
    expect(
      decideGeneration(counts({ inWindow: GENERATION_QUOTA.perWindow - 1 })).allowed,
    ).toBe(true);
  });

  it('refuses one over', () => {
    const decision = decideGeneration(counts({ inWindow: GENERATION_QUOTA.perWindow }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('rate_limited');
  });

  it('refuses a second concurrent generation', () => {
    const decision = decideGeneration(counts({ running: 1 }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('rate_limited');
  });
});

describe('the character ceiling', () => {
  it('allows a prompt exactly at the limit', () => {
    expect(
      decideGeneration(counts({ promptChars: GENERATION_QUOTA.maxInputChars })).allowed,
    ).toBe(true);
  });

  it('refuses one character more', () => {
    const decision = decideGeneration(
      counts({ promptChars: GENERATION_QUOTA.maxInputChars + 1 }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('input_too_long');
  });

  it('leaves room for the system prompt above the 20,000-char user cap', () => {
    // The two ceilings are different things (SPEC §7.5 controls 1 and 2): the
    // request cap is on pasted text, this one is on the assembled prompt. If
    // this ever inverts, a request that passes validation dies at dispatch.
    expect(GENERATION_QUOTA.maxInputChars).toBeGreaterThan(20_000);
  });
});

describe('which rows spend an allowance', () => {
  const row = (over: Partial<Parameters<typeof countsTowardQuota>[0]>) => ({
    status: 'succeeded',
    cards_returned: 0,
    created_at: NOW.toISOString(),
    ...over,
  });

  it('counts a generation that produced cards', () => {
    expect(countsTowardQuota(row({ cards_returned: 18 }), NOW)).toBe(true);
  });

  it('does not count a refusal', () => {
    // Otherwise the first refusal makes every later attempt refuse too, forever.
    expect(countsTowardQuota(row({ status: 'refused' }), NOW)).toBe(false);
  });

  it('does not count a failure that produced nothing', () => {
    expect(countsTowardQuota(row({ status: 'failed' }), NOW)).toBe(false);
  });

  it('counts a failure that still produced cards', () => {
    // A disconnect mid-stream leaves the drafts behind; those cards are real.
    expect(countsTowardQuota(row({ status: 'failed', cards_returned: 12 }), NOW)).toBe(
      true,
    );
  });

  it('counts a generation still running', () => {
    expect(countsTowardQuota(row({ status: 'running' }), NOW)).toBe(true);
  });

  it('stops counting a running row once it is plainly a crashed worker', () => {
    const abandoned = new Date(
      NOW.getTime() - (GENERATION_QUOTA.staleRunningMinutes + 1) * 60_000,
    );
    expect(
      countsTowardQuota(
        row({ status: 'running', created_at: abandoned.toISOString() }),
        NOW,
      ),
    ).toBe(false);
  });

  it('builds a filter that says the same thing to PostgREST', () => {
    const filter = quotaCountFilter(NOW);
    expect(filter).toContain('cards_returned.gt.0');
    expect(filter).toContain('status.eq.running');
    expect(filter).toContain(staleRunningBefore(NOW).toISOString());
  });
});

describe('windows', () => {
  it('runs the month from the 1st to the 1st, in UTC', () => {
    const { start, end } = monthWindow(NOW);
    expect(start.toISOString()).toBe('2026-08-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2026-09-01T00:00:00.000Z');
  });

  it('rolls over December correctly', () => {
    const { start, end } = monthWindow(new Date('2026-12-31T23:59:59.000Z'));
    expect(start.toISOString()).toBe('2026-12-01T00:00:00.000Z');
    expect(end.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('puts the last instant of a month inside that month', () => {
    const last = new Date('2026-08-31T23:59:59.999Z');
    const { start, end } = monthWindow(last);
    expect(last.getTime()).toBeGreaterThanOrEqual(start.getTime());
    expect(last.getTime()).toBeLessThan(end.getTime());
  });

  it('opens the burst window exactly one window back', () => {
    expect(NOW.getTime() - rateWindowStart(NOW).getTime()).toBe(
      GENERATION_QUOTA.windowSeconds * 1000,
    );
  });
});

describe('advisory numbers', () => {
  it('estimates tokens from characters, rounding up', () => {
    expect(estimateTokens(0)).toBe(0);
    expect(estimateTokens(1)).toBe(1);
    expect(estimateTokens(4_000)).toBe(1_000);
  });

  it('never reports a negative remainder', () => {
    expect(remainingGenerations(GENERATION_QUOTA.monthlyGenerations + 3)).toBe(0);
    expect(remainingGenerations(0)).toBe(GENERATION_QUOTA.monthlyGenerations);
  });
});
