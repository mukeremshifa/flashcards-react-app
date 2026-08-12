import { encodeSseFrame, SSE_HEARTBEAT } from '../../../src/lib/sse.ts';
import type { StreamEvent } from './schemas.ts';
import { CORS_HEADERS } from './http.ts';

/**
 * The outbound half of the wire format in SPEC §7.3: one `data:` frame per card,
 * as it lands, over a connection that stays open for as long as the model keeps
 * writing.
 *
 * The framing itself lives in `src/lib/sse.ts`, shared with the client that
 * decodes it. What is here is the part that only makes sense server-side: the
 * `ReadableStream` the response body is, and the heartbeat that keeps it alive.
 */

export const SSE_HEADERS: Record<string, string> = {
  ...CORS_HEADERS,
  'Content-Type': 'text/event-stream; charset=utf-8',
  'Cache-Control': 'no-cache, no-transform',
  Connection: 'keep-alive',
  // Nginx-family proxies buffer responses by default, which would hold every
  // card until the stream closed and quietly undo the entire point of streaming.
  'X-Accel-Buffering': 'no',
};

/** How often the keep-alive comment goes out while the model is thinking. */
const HEARTBEAT_MS = 15_000;

export type EventStream = {
  readable: ReadableStream<Uint8Array>;
  /** Enqueue one event. Safe to call after close; it is ignored. */
  send(event: StreamEvent): void;
  close(): void;
};

export function createEventStream(): EventStream {
  const encoder = new TextEncoder();
  let controller: ReadableStreamDefaultController<Uint8Array> | null = null;
  let heartbeat: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  function write(text: string): void {
    if (closed || !controller) return;
    try {
      controller.enqueue(encoder.encode(text));
    } catch {
      // The client went away between the check and the enqueue. The generation
      // itself is unaffected — the drafts are already rows (SPEC §4.1) — so this
      // is not worth failing over.
      closed = true;
    }
  }

  function stop(): void {
    if (heartbeat !== undefined) clearInterval(heartbeat);
    heartbeat = undefined;
  }

  const readable = new ReadableStream<Uint8Array>({
    start(streamController) {
      controller = streamController;
      heartbeat = setInterval(() => write(SSE_HEARTBEAT), HEARTBEAT_MS);
    },
    cancel() {
      // The browser closed the tab or hit cancel. Stop the timer, or it keeps
      // firing at a stream nobody is reading until the worker is recycled.
      closed = true;
      stop();
    },
  });

  return {
    readable,
    send(event: StreamEvent) {
      write(encodeSseFrame(event.type, event));
    },
    close() {
      if (closed) return;
      closed = true;
      stop();
      try {
        controller?.close();
      } catch {
        // Already closed by a cancel; nothing to do.
      }
    },
  };
}

export function streamResponse(stream: EventStream): Response {
  return new Response(stream.readable, { status: 200, headers: SSE_HEADERS });
}
