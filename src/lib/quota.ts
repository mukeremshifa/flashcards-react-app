/**
 * How much generating a user may do, and how the answer is worked out.
 *
 * SPEC §5.5 and §7.5: quota is *counted from the `generations` table*, never
 * from a mutable counter column. A counter drifts the first time a write fails
 * halfway; a count cannot, and the same rows are already the cost and audit
 * trail. The trade is one indexed count per request, which
 * `generations_user_time_idx` makes cheap.
 *
 * Pure policy only — no Supabase, no clock of its own. The Edge Function does
 * the counting and calls `decideGeneration` (enforcement); the client does the
 * same counting to *show* the remaining budget (advisory, SPEC §4.1 step 3).
 * Both read their numbers from here so the figure on the screen and the figure
 * that refuses the request cannot disagree.
 */

/**
 * The numbers, and where they come from.
 *
 * Tuned against Groq's free-tier limits for `llama-3.3-70b-versatile`, read from
 * console.groq.com/docs/rate-limits on **2026-08-12**: 30 requests/min, 1,000
 * requests/day, 12,000 tokens/min, 100,000 tokens/day, shared across the whole
 * API key rather than per user.
 *
 * `maxInputChars` is a *character* budget because Groq has no token-counting
 * endpoint (SPEC §7.2), so the arithmetic is deliberately conservative:
 *
 *   28,000 chars ÷ 4 chars/token ≈ 7,000 input tokens
 *   + 4,096 output tokens (`max_tokens`)     ≈ 11,100 tokens
 *   ≈ 92% of the 12,000 token/min ceiling — one worst-case generation a minute.
 *
 * It applies to the *assembled* prompt, not the pasted text, which is what makes
 * it a second and different ceiling from `GENERATION_LIMITS.maxChars` (20,000
 * chars of user text, SPEC §7.5 control 1): system prompt (~3,000 chars) plus
 * framing plus 20,000 chars of text is ~23,400, comfortably inside 28,000, so a
 * request that passes the first check does not then die at the second.
 */
export const GENERATION_QUOTA = {
  /** Per user, per calendar month (SPEC §7.5 control 3). */
  monthlyGenerations: 30,
  /** SPEC §7.5 control 4: a short-window burst limiter, per user. */
  windowSeconds: 60,
  perWindow: 3,
  maxConcurrent: 1,
  /**
   * A `running` row older than this is a crashed generation, not one in flight.
   * The provider call is capped at 60s (SPEC §7.2), so five minutes is far past
   * anything that could still be streaming — and without this, one lost worker
   * would lock a user out of the feature permanently.
   */
  staleRunningMinutes: 5,
  /** The assembled-prompt ceiling. See the arithmetic above. */
  maxInputChars: 28_000,
  /**
   * For the *estimate* shown in the UI only. Never enforcement: English prose
   * runs about 4 chars/token, code and non-Latin scripts do not, and presenting
   * a guess as a measurement is how a user ends up blaming the app for a 429.
   */
  charsPerToken: 4,
} as const;

/**
 * Did this row consume one of the month's generations?
 *
 * The rule, stated once: **you spend an allowance when you get cards, or while a
 * generation is still running.** A row that ended with nothing — refused before
 * dispatch on quota, refused by the model, or failed on a provider 429 — spent
 * nothing, so it does not count. Anything else punishes a user for a failure
 * that was not theirs, and the row is still written either way, because SPEC §10
 * wants every outcome recorded with its reason.
 *
 * Running rows count so that opening three tabs cannot outrun the check. Only
 * *recent* ones do: a row stuck on `running` is a crashed worker, and without
 * the window it would eat one of the thirty forever.
 */
export function countsTowardQuota(
  row: { status: string; cards_returned: number; created_at: string },
  now: Date,
): boolean {
  if (row.cards_returned > 0) return true;
  return (
    row.status === 'running' &&
    new Date(row.created_at).getTime() >= staleRunningBefore(now).getTime()
  );
}

/**
 * The same rule as a PostgREST filter, so the client's "23 left" and the Edge
 * Function's refusal are the same query rather than two readings of one comment.
 */
export function quotaCountFilter(now: Date): string {
  return `cards_returned.gt.0,and(status.eq.running,created_at.gte.${staleRunningBefore(now).toISOString()})`;
}

/**
 * The month a generation belongs to: the UTC calendar month.
 *
 * Deliberately *not* the 04:00 study day of `day.ts`. That boundary exists so a
 * late-night review session counts towards the right day of a streak; a quota
 * has no such argument, and the Edge Function would have to fetch the user's
 * profile to know their zone before it could even decide whether to refuse.
 * UTC means the client's "23 left" and the server's answer are computed from the
 * same instant on both sides.
 */
export function monthWindow(now: Date): { start: Date; end: Date } {
  const start = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0),
  );
  const end = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1, 0, 0, 0, 0),
  );
  return { start, end };
}

/** The start of the burst window: everything after this counts towards it. */
export function rateWindowStart(now: Date): Date {
  return new Date(now.getTime() - GENERATION_QUOTA.windowSeconds * 1000);
}

/** Rows still marked `running` but older than this were abandoned, not active. */
export function staleRunningBefore(now: Date): Date {
  return new Date(now.getTime() - GENERATION_QUOTA.staleRunningMinutes * 60_000);
}

/** Advisory only — see `charsPerToken`. */
export function estimateTokens(chars: number): number {
  return Math.ceil(chars / GENERATION_QUOTA.charsPerToken);
}

export function remainingGenerations(usedThisMonth: number): number {
  return Math.max(0, GENERATION_QUOTA.monthlyGenerations - usedThisMonth);
}

export type GenerationCounts = {
  /** Non-refused `generations` rows this calendar month. */
  usedThisMonth: number;
  /** Rows created inside the burst window. */
  inWindow: number;
  /** Rows still `running` and recent enough to believe. */
  running: number;
  /** Length of the whole assembled prompt, system message included. */
  promptChars: number;
};

export type GenerationDecision =
  | { allowed: true }
  | {
      allowed: false;
      /** One of `StreamEvent`'s error codes, so the client already knows it. */
      code: 'quota_exceeded' | 'rate_limited' | 'input_too_long';
      message: string;
    };

/**
 * Whether this generation may run.
 *
 * Order matters: the monthly cap is a fact about the account and is reported
 * first, because telling someone to "try again in a minute" when they have no
 * generations left this month sends them round a loop that cannot end.
 */
export function decideGeneration(counts: GenerationCounts): GenerationDecision {
  if (counts.usedThisMonth >= GENERATION_QUOTA.monthlyGenerations) {
    return {
      allowed: false,
      code: 'quota_exceeded',
      message:
        `You have used all ${GENERATION_QUOTA.monthlyGenerations} generations for this ` +
        'month. The allowance resets on the 1st. You can still add cards by hand, and ' +
        'every deck you already have keeps working.',
    };
  }

  if (counts.running >= GENERATION_QUOTA.maxConcurrent) {
    return {
      allowed: false,
      code: 'rate_limited',
      message:
        'One generation is already running. Wait for it to finish, or reload the page ' +
        'if you closed the tab it was streaming into.',
    };
  }

  if (counts.inWindow >= GENERATION_QUOTA.perWindow) {
    return {
      allowed: false,
      code: 'rate_limited',
      message:
        `That is ${GENERATION_QUOTA.perWindow} generations in under a minute. Wait about ` +
        'a minute and try again — the provider limits how fast cards can be written, ' +
        'and going over it slows everyone down.',
    };
  }

  if (counts.promptChars > GENERATION_QUOTA.maxInputChars) {
    return {
      allowed: false,
      code: 'input_too_long',
      message:
        'That text is too long to send in one go. Split it into shorter passages — a ' +
        'few thousand characters at a time produces better cards anyway.',
    };
  }

  return { allowed: true };
}
