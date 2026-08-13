import { createClient, type SupabaseClient } from '@supabase/supabase-js';

import { GenerateRequest, type StreamEvent } from '../_shared/schemas.ts';
import {
  createLineReader,
  createSseDecoder,
  ingestLine,
  isIgnorableLine,
  newCardScheduling,
  SSE_DONE,
} from '../_shared/ingest.ts';
import { createEventStream, streamResponse, type EventStream } from '../_shared/sse.ts';
import { errorResponse, preflightResponse } from '../_shared/http.ts';
import { checkGenerationAllowed } from '../_shared/quota.ts';
import {
  buildUserTurn,
  CARD_SYSTEM_PROMPT,
  PROMPT_VERSION,
} from '../_shared/prompts/cards.ts';

/**
 * POST /functions/v1/generate-cards — the pipeline in SPEC §7.1.
 *
 *   authenticate → validate → quota and rate limit → char budget → create the
 *   deck and the audit row → stream from Groq → per line: split, validate,
 *   insert as a draft, emit → finalise the audit row.
 *
 * Three things here are load-bearing and easy to get wrong:
 *
 * 1. **Supabase is called with the caller's JWT**, never a service key
 *    (SPEC §5.7, §10). Every insert below is therefore subject to the same RLS
 *    policies the browser is, and `user_id` comes from the verified token rather
 *    than from the request body.
 * 2. **Drafts are rows, not React state** (SPEC §4.1). They are written as they
 *    arrive, so a refresh mid-stream leaves a resumable deck instead of a lost
 *    generation.
 * 3. **Every exit updates the `generations` row.** A row left on `running` is
 *    indistinguishable from a crash, and SPEC §10 asks for a reason on every
 *    failure — including the failures that arrive as an exception.
 */

const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Low, because a strict per-line format does not benefit from flair: high
 * temperature on an NDJSON contract buys malformed lines and nothing else
 * (SPEC §7.2).
 */
const TEMPERATURE = 0.4;

/**
 * The output half of the token budget in `src/lib/quota.ts`. Twenty cards is
 * roughly 1,600 tokens; 4,096 leaves room for fifty without threatening the
 * per-minute ceiling the character budget is tuned against.
 */
const MAX_OUTPUT_TOKENS = 4096;

/** SPEC §7.2: the provider call gets one minute, and no silent retry. */
const PROVIDER_TIMEOUT_MS = 60_000;

Deno.serve(async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') return preflightResponse();
  if (req.method !== 'POST') return errorResponse(405, 'Use POST.');

  // SPEC §7.5 control 5: a switch that turns generation off without a deploy.
  if ((Deno.env.get('GENERATION_ENABLED') ?? 'true').toLowerCase() === 'false') {
    return errorResponse(
      503,
      'Card generation is switched off at the moment. Your decks and practice are unaffected.',
    );
  }

  const groqKey = Deno.env.get('GROQ_API_KEY');
  const model = Deno.env.get('GENERATION_MODEL');
  if (!groqKey || !model) {
    // Deliberately vague to the client: a missing key is an operator problem,
    // not something the person pasting text can act on.
    console.error('generate-cards: GROQ_API_KEY or GENERATION_MODEL is not set');
    return errorResponse(503, 'Card generation is not configured on this project yet.');
  }

  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return errorResponse(401, 'You are signed out. Sign in and try again.');
  }

  let supabase: SupabaseClient;
  try {
    supabase = createCallerClient(authHeader);
  } catch (error) {
    console.error('generate-cards: client misconfigured', error);
    return errorResponse(503, 'Card generation is not configured on this project yet.');
  }

  // Verifies the token against the auth server rather than trusting its claims.
  const { data: auth, error: authError } = await supabase.auth.getUser(
    authHeader.slice('Bearer '.length),
  );
  const user = auth?.user;
  if (authError || !user) {
    return errorResponse(401, 'That session is no longer valid. Sign in again.');
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return errorResponse(400, 'That request body was not JSON.');
  }

  const parsed = GenerateRequest.safeParse(body);
  if (!parsed.success) {
    return errorResponse(
      400,
      parsed.error.issues[0]?.message ?? 'That request was not valid.',
    );
  }
  const request = parsed.data;

  const userTurn = buildUserTurn(request);
  // The char budget covers the *assembled* prompt, system message included —
  // that is what the provider bills and rate-limits, not the paste box.
  const promptChars = CARD_SYSTEM_PROMPT.length + userTurn.length;

  const now = new Date();
  let quota;
  try {
    quota = await checkGenerationAllowed(supabase, user.id, promptChars, now);
  } catch (error) {
    console.error('generate-cards: quota check failed', error);
    return errorResponse(500, 'Could not check your generation quota. Try again.');
  }

  if (!quota.allowed) {
    // Refused before dispatch. The row is still written — a quota that cannot be
    // audited after the fact is not a quota — and it carries no deck, which is
    // what marks it as never having reached the provider.
    await supabase.from('generations').insert({
      user_id: user.id,
      source: 'text',
      model,
      prompt_version: PROMPT_VERSION,
      input_chars: request.text.length,
      cards_requested: request.cardCount,
      status: 'refused',
      error: quota.code,
      finished_at: new Date().toISOString(),
    });

    return refusalStream({ type: 'error', code: quota.code, message: quota.message });
  }

  // ---------------------------------------------------------------------------
  // Committed: from here the user has a deck and an audit row, and every path
  // out of this function has to finish both.
  // ---------------------------------------------------------------------------

  const { data: deck, error: deckError } = await supabase
    .from('decks')
    .insert({
      user_id: user.id,
      title: request.deckTitle,
      status: 'generating',
      source: 'text',
    })
    .select('id')
    .single();

  if (deckError || !deck) {
    console.error('generate-cards: could not create deck', deckError);
    return errorResponse(500, 'Could not create the deck. Try again.');
  }

  const { data: generation, error: generationError } = await supabase
    .from('generations')
    .insert({
      user_id: user.id,
      deck_id: deck.id,
      source: 'text',
      model,
      prompt_version: PROMPT_VERSION,
      input_chars: request.text.length,
      cards_requested: request.cardCount,
      status: 'running',
    })
    .select('id')
    .single();

  if (generationError || !generation) {
    console.error('generate-cards: could not create generation row', generationError);
    await supabase.from('decks').update({ status: 'failed' }).eq('id', deck.id);
    return errorResponse(500, 'Could not start the generation. Try again.');
  }

  const stream = createEventStream();
  stream.send({
    type: 'meta',
    deckId: deck.id,
    generationId: generation.id,
    expected: request.cardCount,
  });

  // Not awaited: the Response has to be returned now so the browser can start
  // reading. `EdgeRuntime.waitUntil` keeps the worker alive while the pump runs,
  // so a client that walks away mid-stream still gets its drafts finalised
  // (SPEC §4.1: an interrupted generation is resumable).
  waitUntil(
    runGeneration({
      req,
      supabase,
      stream,
      request,
      userTurn,
      userId: user.id,
      deckId: deck.id,
      generationId: generation.id,
      groqKey,
      model,
    }),
  );

  return streamResponse(stream);
});

// ---------------------------------------------------------------------------
// The generation itself
// ---------------------------------------------------------------------------

type GenerationContext = {
  req: Request;
  supabase: SupabaseClient;
  stream: EventStream;
  request: GenerateRequest;
  userTurn: string;
  userId: string;
  deckId: string;
  generationId: string;
  groqKey: string;
  model: string;
};

async function runGeneration(context: GenerationContext): Promise<void> {
  const { req, supabase, stream, userTurn, groqKey, model } = context;

  /** Position in the stream: every emitted card and every skipped line takes one. */
  let position = 0;
  let returned = 0;
  let sawContent = false;
  let inputTokens: number | null = null;
  let outputTokens: number | null = null;
  let finishReason: string | null = null;

  const signal = AbortSignal.any([req.signal, AbortSignal.timeout(PROVIDER_TIMEOUT_MS)]);

  /** One NDJSON line: validate, store as a draft, emit — or warn and carry on. */
  async function handleLine(line: string): Promise<void> {
    if (isIgnorableLine(line)) return;
    sawContent = true;

    const result = ingestLine(line);
    if (!result.ok) {
      // One malformed line costs that line. SPEC §7.3: the other nineteen cards
      // still land.
      stream.send({ type: 'warn', index: position++, reason: result.reason });
      return;
    }

    for (const card of result.cards) {
      const { data: row, error } = await supabase
        .from('cards')
        .insert({
          user_id: context.userId,
          deck_id: context.deckId,
          kind: card.payload.kind,
          payload: card.payload,
          // A draft until the review gate says otherwise (SPEC §4.1 step 5).
          status: 'draft',
          source_excerpt: card.sourceExcerpt,
          // The same fresh-card scheduling a hand-written card gets: nothing
          // downstream should be able to tell where a card came from.
          ...newCardScheduling(new Date()),
        })
        .select('id')
        .single();

      if (error || !row) {
        console.error('generate-cards: card insert failed', error);
        stream.send({
          type: 'warn',
          index: position++,
          reason: 'That card could not be saved.',
        });
        continue;
      }

      stream.send({
        type: 'card',
        id: row.id,
        index: position++,
        payload: card.payload,
        ...(card.sourceExcerpt ? { source_excerpt: card.sourceExcerpt } : {}),
      });
      returned += 1;
    }
  }

  try {
    const response = await fetch(GROQ_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${groqKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        stream: true,
        // Usage arrives on the final chunk; without this it never arrives at all
        // and `generations` loses the only token figures it will ever see.
        stream_options: { include_usage: true },
        temperature: TEMPERATURE,
        max_tokens: MAX_OUTPUT_TOKENS,
        // No `response_format`: JSON object mode constrains the whole response
        // to a *single* object, which is the opposite of one card per line
        // (SPEC §7.2). Per-line Zod is what guarantees shape here.
        messages: [
          { role: 'system', content: CARD_SYSTEM_PROMPT },
          { role: 'user', content: userTurn },
        ],
      }),
      signal,
    });

    if (!response.ok || !response.body) {
      const detail = await response.text().catch(() => '');
      // A free-tier 429 is normal operating behaviour, not an exception
      // (SPEC §7.2) — and it is never retried silently, because the user is
      // watching a half-filled staging list.
      const rateLimited = response.status === 429;
      const retryAfter = response.headers.get('retry-after');
      stream.send({
        type: 'error',
        code: rateLimited ? 'rate_limited' : 'provider_error',
        message: rateLimited
          ? `The card writer is busy right now${
              retryAfter ? `, try again in about ${retryAfter} seconds` : ''
            }. This attempt did not use up a generation.`
          : 'The card writer could not be reached. This attempt did not use up a generation.',
      });
      await finish(context, {
        status: 'failed',
        error: `provider_${response.status}: ${detail.slice(0, 300)}`,
        returned,
        inputTokens,
        outputTokens,
      });
      return;
    }

    const decoder = new TextDecoder();
    const sse = createSseDecoder();
    const lines = createLineReader();
    const reader = response.body.getReader();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      for (const frame of sse.push(decoder.decode(value, { stream: true }))) {
        if (frame.data === SSE_DONE) continue;

        let chunk: GroqChunk;
        try {
          chunk = JSON.parse(frame.data) as GroqChunk;
        } catch {
          continue;
        }

        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        if (chunk.usage) {
          inputTokens = chunk.usage.prompt_tokens ?? inputTokens;
          outputTokens = chunk.usage.completion_tokens ?? outputTokens;
        }

        const delta = choice?.delta?.content;
        if (typeof delta === 'string' && delta.length > 0) {
          for (const line of lines.push(delta)) await handleLine(line);
        }
      }
    }

    // The tail. `finish_reason: 'length'` means the model was cut off mid-card,
    // so whatever is in the buffer is half a card and is discarded rather than
    // salvaged (SPEC §7.2).
    const tail = lines.rest();
    if (finishReason !== 'length') {
      for (const line of lines.flush()) await handleLine(line);
    }

    if (returned === 0) {
      // A content refusal arrives as a normal completion whose body is prose
      // instead of JSON: zero valid lines with a non-empty response is the
      // signal (SPEC §7.2).
      const refused = sawContent || tail.trim().length > 0;
      stream.send({
        type: 'error',
        code: refused ? 'refused' : 'provider_error',
        message: refused
          ? 'The card writer would not make cards from that text. Try a different passage, or write a card by hand.'
          : 'The card writer returned nothing at all. Try again.',
      });
      await finish(context, {
        status: refused ? 'refused' : 'failed',
        error: refused ? 'provider_refused' : 'empty_response',
        returned,
        inputTokens,
        outputTokens,
      });
      return;
    }

    stream.send({
      type: 'done',
      returned,
      ...(inputTokens === null ? {} : { inputTokens }),
      ...(outputTokens === null ? {} : { outputTokens }),
    });
    await finish(context, {
      status: 'succeeded',
      // Not a failure, but worth recording: `length` means the model ran out of
      // output budget rather than running out of things to say.
      error: finishReason === 'length' ? 'truncated_at_max_tokens' : null,
      returned,
      inputTokens,
      outputTokens,
    });
  } catch (error) {
    const disconnected = req.signal.aborted;
    if (!disconnected) {
      const timedOut = error instanceof DOMException && error.name === 'TimeoutError';
      stream.send({
        type: 'error',
        code: timedOut ? 'provider_error' : 'internal',
        message: timedOut
          ? 'The card writer took too long. Any cards that arrived are saved as drafts.'
          : 'Something went wrong part-way through. Any cards that arrived are saved as drafts.',
      });
    }
    console.error('generate-cards: generation failed', error);
    await finish(context, {
      // Cards that landed are the user's, disconnect or not, so a run that
      // produced them is not recorded as a failure — the reason still is.
      status: returned > 0 ? 'succeeded' : 'failed',
      error: disconnected ? 'client_disconnected' : describeError(error),
      returned,
      inputTokens,
      outputTokens,
    });
  } finally {
    stream.close();
  }
}

type FinishState = {
  status: 'succeeded' | 'failed' | 'refused';
  error: string | null;
  returned: number;
  inputTokens: number | null;
  outputTokens: number | null;
};

/**
 * Close the books: the audit row always, and the deck to match.
 *
 * A deck that produced cards becomes `draft` — the review gate's resumable
 * state. One that produced none becomes `failed`, which is what keeps an empty
 * deck out of the deck list instead of leaving the user something to tidy up.
 */
async function finish(context: GenerationContext, state: FinishState): Promise<void> {
  const { supabase, deckId, generationId } = context;

  const results = await Promise.allSettled([
    supabase
      .from('generations')
      .update({
        status: state.status,
        cards_returned: state.returned,
        input_tokens: state.inputTokens,
        output_tokens: state.outputTokens,
        error: state.error,
        finished_at: new Date().toISOString(),
        // cost_usd stays null: the free tier costs nothing, and the column is
        // there for the day that changes (SPEC §7.5).
      })
      .eq('id', generationId),

    supabase
      .from('decks')
      .update({ status: state.returned > 0 ? 'draft' : 'failed' })
      .eq('id', deckId),
  ]);

  for (const result of results) {
    if (result.status === 'rejected') {
      console.error('generate-cards: could not finalise', result.reason);
    }
  }
}

// ---------------------------------------------------------------------------
// Plumbing
// ---------------------------------------------------------------------------

type GroqChunk = {
  choices?: Array<{
    delta?: { content?: string | null };
    finish_reason?: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number } | null;
};

/**
 * A Supabase client that *is* the caller.
 *
 * The publishable key carries no privileges of its own; the `Authorization`
 * header decides what the request may see and RLS decides the rest (SPEC §5.7).
 * The fallback exists because older Edge runtimes inject only `SUPABASE_ANON_KEY`
 * — the same powerless role under a legacy name, and the `SUPABASE_` prefix is
 * reserved, so it cannot simply be set by hand. What is refused outright is a
 * secret key: it maps to `service_role`, which holds BYPASSRLS, and using it here
 * would void every policy this function depends on (CLAUDE.md, SPEC §10).
 */
function createCallerClient(authHeader: string): SupabaseClient {
  const url = Deno.env.get('SUPABASE_URL');
  const key =
    Deno.env.get('SUPABASE_PUBLISHABLE_KEY') ?? Deno.env.get('SUPABASE_ANON_KEY');

  if (!url || !key) throw new Error('SUPABASE_URL or the publishable key is missing');
  if (key.startsWith('sb_secret_')) {
    throw new Error('refusing to run with a secret key: it bypasses row level security');
  }

  return createClient(url, key, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** A refusal, delivered as the one-frame stream the client already reads. */
function refusalStream(event: StreamEvent): Response {
  const stream = createEventStream();
  stream.send(event);
  stream.close();
  return streamResponse(stream);
}

function describeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.slice(0, 300);
}

/**
 * Keep the worker alive until the pump finishes, where the runtime offers it.
 * Without this, a client that disconnects can have its worker recycled before
 * the `generations` row is finalised — the one thing SPEC §10 asks always to
 * happen.
 */
function waitUntil(work: Promise<unknown>): void {
  const runtime = (
    globalThis as { EdgeRuntime?: { waitUntil?: (promise: Promise<unknown>) => void } }
  ).EdgeRuntime;

  if (runtime?.waitUntil) runtime.waitUntil(work);
  else void work.catch(error => console.error('generate-cards: unhandled', error));
}
