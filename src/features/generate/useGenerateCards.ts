import { useCallback, useEffect, useReducer, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';

import { env } from '@/lib/env';
import { supabase } from '@/lib/supabase';
import { createSseDecoder } from '@/lib/sse';
import { StreamEvent, type CardPayload, type GenerateRequest } from '@/lib/schemas';
import { queryKeys } from '@/lib/queries';

/**
 * The generation stream, as component state.
 *
 * Deliberately **not** TanStack Query (SPEC §8.3). Query caches a value that a
 * key can be refetched for; this is a one-shot stream that takes half a minute,
 * cannot be replayed, and whose partial results are already persisted server-side
 * as drafts. Caching it would mean a remount silently re-running a generation —
 * the exact thing SPEC §4.1 says must never happen.
 *
 * `EventSource` is not an option either: it cannot send an `Authorization`
 * header and cannot POST a body, so the stream is read from `fetch` by hand
 * (SPEC §7.3). Each frame is validated with the same `StreamEvent` schema the
 * Edge Function emits against — a frame that does not match is dropped rather
 * than trusted.
 */

const FUNCTION_URL = `${env.VITE_SUPABASE_URL}/functions/v1/generate-cards`;

export type StreamErrorCode = Extract<StreamEvent, { type: 'error' }>['code'];
export type GenerationError = { code: StreamErrorCode; message: string };

export type StagedCard = {
  id: string;
  index: number;
  payload: CardPayload;
  sourceExcerpt: string | null;
};

export type SkippedCard = { index: number; reason: string };

export type GenerateStatus = 'idle' | 'streaming' | 'done' | 'error' | 'cancelled';

export type GenerateState = {
  status: GenerateStatus;
  /** Set as soon as the `meta` frame lands, which is before the first card. */
  deckId: string | null;
  generationId: string | null;
  /** How many cards were asked for — the number of skeleton rows to show. */
  expected: number;
  cards: StagedCard[];
  skipped: SkippedCard[];
  error: GenerationError | null;
};

const INITIAL: GenerateState = {
  status: 'idle',
  deckId: null,
  generationId: null,
  expected: 0,
  cards: [],
  skipped: [],
  error: null,
};

type Action =
  | { type: 'start'; expected: number }
  | { type: 'event'; event: StreamEvent }
  | { type: 'failed'; error: GenerationError }
  | { type: 'cancelled' }
  | { type: 'reset' };

function reducer(state: GenerateState, action: Action): GenerateState {
  switch (action.type) {
    case 'start':
      return { ...INITIAL, status: 'streaming', expected: action.expected };

    case 'cancelled':
      // The drafts that arrived are rows already; the deck stays reviewable.
      return { ...state, status: 'cancelled' };

    case 'failed':
      return { ...state, status: 'error', error: action.error };

    case 'reset':
      return INITIAL;

    case 'event':
      switch (action.event.type) {
        case 'meta':
          return {
            ...state,
            deckId: action.event.deckId,
            generationId: action.event.generationId,
            expected: action.event.expected,
          };

        case 'card':
          return {
            ...state,
            cards: [
              ...state.cards,
              {
                id: action.event.id,
                index: action.event.index,
                payload: action.event.payload,
                sourceExcerpt: action.event.source_excerpt ?? null,
              },
            ],
          };

        case 'warn':
          return {
            ...state,
            skipped: [
              ...state.skipped,
              { index: action.event.index, reason: action.event.reason },
            ],
          };

        case 'done':
          return { ...state, status: 'done', expected: state.cards.length };

        case 'error':
          return {
            ...state,
            status: 'error',
            error: { code: action.event.code, message: action.event.message },
          };
      }
  }
}

export type UseGenerateCards = {
  state: GenerateState;
  /** Runs the generation. Never throws: failures arrive as `state.error`. */
  start: (request: GenerateRequest) => Promise<void>;
  cancel: () => void;
  reset: () => void;
};

export function useGenerateCards(): UseGenerateCards {
  const [state, dispatch] = useReducer(reducer, INITIAL);
  const abortRef = useRef<AbortController | null>(null);
  const queryClient = useQueryClient();

  // Leaving the page mid-stream stops the read, and only the read: the Edge
  // Function keeps writing drafts, so the deck is still waiting at the gate.
  useEffect(() => () => abortRef.current?.abort(), []);

  const cancel = useCallback(() => {
    if (!abortRef.current) return;
    abortRef.current.abort();
    abortRef.current = null;
    dispatch({ type: 'cancelled' });
  }, []);

  const reset = useCallback(() => {
    abortRef.current?.abort();
    abortRef.current = null;
    dispatch({ type: 'reset' });
  }, []);

  const start = useCallback(
    async (request: GenerateRequest) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;
      dispatch({ type: 'start', expected: request.cardCount });

      try {
        const { data, error } = await supabase.auth.getSession();
        if (error) throw error;
        const token = data.session?.access_token;
        if (!token) {
          dispatch({
            type: 'failed',
            error: {
              code: 'internal',
              message: 'You are signed out. Sign in and try again.',
            },
          });
          return;
        }

        const response = await fetch(FUNCTION_URL, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${token}`,
            // Routing key for the API gateway. It grants nothing on its own —
            // the token above is what the policies see (SPEC §10).
            apikey: env.VITE_SUPABASE_PUBLISHABLE_KEY,
            'Content-Type': 'application/json',
            Accept: 'text/event-stream',
          },
          body: JSON.stringify(request),
          signal: controller.signal,
        });

        if (!response.ok || !response.body) {
          dispatch({ type: 'failed', error: await readErrorBody(response) });
          return;
        }

        const reader = response.body.getReader();
        const decoder = new TextDecoder();
        const sse = createSseDecoder();

        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          for (const frame of sse.push(decoder.decode(value, { stream: true }))) {
            const parsed = StreamEvent.safeParse(safeJson(frame.data));
            // An unrecognised frame is dropped, not guessed at: card content is
            // untrusted all the way down (SPEC §10).
            if (parsed.success) dispatch({ type: 'event', event: parsed.data });
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return; // cancel() already said so
        dispatch({
          type: 'failed',
          error: {
            code: 'internal',
            message:
              error instanceof Error
                ? `The connection dropped: ${error.message}`
                : 'The connection dropped part-way through.',
          },
        });
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
        // Whatever happened, a generation was attempted and the deck list and
        // the remaining allowance both moved.
        void queryClient.invalidateQueries({ queryKey: queryKeys.quota });
        void queryClient.invalidateQueries({ queryKey: queryKeys.decks });
      }
    },
    [queryClient],
  );

  return { state, start, cancel, reset };
}

function safeJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

/**
 * The failures that arrive as a status code rather than a frame: no token, a
 * body the function could not read, generation switched off.
 */
async function readErrorBody(response: Response): Promise<GenerationError> {
  const fallback = `The card writer answered with ${response.status}.`;
  try {
    const body = (await response.json()) as { error?: unknown };
    const message = typeof body.error === 'string' ? body.error : fallback;
    return { code: response.status === 429 ? 'rate_limited' : 'internal', message };
  } catch {
    return { code: 'internal', message: fallback };
  }
}
