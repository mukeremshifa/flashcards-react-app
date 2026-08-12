/**
 * Server-sent events, both directions, as plain string handling.
 *
 * Two streams in this app speak SSE and they are not the same stream: Groq sends
 * one to the Edge Function, and the Edge Function sends a different one to the
 * browser (SPEC §7.1). The wire syntax is identical, so the decoder here is
 * shared by both readers and the encoder by the one writer.
 *
 * The client reads its stream with `fetch` + `ReadableStream` rather than
 * `EventSource`, which can neither send an `Authorization` header nor POST a
 * body (SPEC §7.3) — so "the browser has SSE built in" is not an argument for
 * deleting this file.
 */

import { createLineReader } from './ndjson.ts';

/** One decoded event. `event` is absent on Groq's frames, which send data only. */
export type SseFrame = { event: string | null; data: string };

export type SseDecoder = {
  push(chunk: string): SseFrame[];
  /** Any frame left unterminated by a blank line when the stream ended. */
  flush(): SseFrame[];
};

/**
 * Decode an SSE byte stream that has already been turned into text.
 *
 * Field syntax per the EventSource spec, minus the parts nothing here uses:
 * `field: value` lines accumulate, a blank line dispatches, a leading `:` is a
 * comment. Comments matter — the heartbeat is one, and a decoder that treated it
 * as data would hand the client an empty event every fifteen seconds.
 */
export function createSseDecoder(): SseDecoder {
  const lines = createLineReader();
  let event: string | null = null;
  let data: string[] = [];

  function take(): SseFrame[] {
    if (data.length === 0) {
      event = null;
      return [];
    }
    const frame: SseFrame = { event, data: data.join('\n') };
    event = null;
    data = [];
    return [frame];
  }

  function consume(line: string): SseFrame[] {
    if (line === '') return take();
    if (line.startsWith(':')) return [];

    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    // "If value starts with a space, remove it" — one space only, so a data
    // payload that legitimately begins with whitespace survives.
    const rawValue = colon === -1 ? '' : line.slice(colon + 1);
    const value = rawValue.startsWith(' ') ? rawValue.slice(1) : rawValue;

    if (field === 'event') event = value;
    else if (field === 'data') data.push(value);
    // `id` and `retry` exist in the protocol and are unused here: this stream is
    // not resumable by Last-Event-ID — a resumed generation is resumed from the
    // persisted drafts (SPEC §4.1), not by replaying the wire.
    return [];
  }

  return {
    push(chunk: string): SseFrame[] {
      return lines.push(chunk).flatMap(consume);
    },
    flush(): SseFrame[] {
      const trailing = lines.flush().flatMap(consume);
      return [...trailing, ...take()];
    },
  };
}

/** One outbound frame, ready to enqueue. */
export function encodeSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * A comment frame, sent on a timer while the model is thinking.
 *
 * Proxies and load balancers close connections that go quiet, and the gap
 * between "request accepted" and "first card" is exactly the window in which
 * that happens. A comment is the cheapest legal keep-alive: every SSE parser,
 * including the one above, is required to ignore it.
 */
export const SSE_HEARTBEAT = ': keep-alive\n\n';

/** Groq's stream terminator: `data: [DONE]` rather than a JSON payload. */
export const SSE_DONE = '[DONE]';
