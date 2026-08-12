/**
 * Reading newline-delimited JSON out of a stream that does not respect lines.
 *
 * SPEC §7.3: the model emits one JSON object per line, and the Edge Function
 * validates, stores and re-emits each one as it arrives. Nothing about the
 * transport preserves that framing — a chunk boundary lands wherever the network
 * put it, routinely mid-token and often mid-line. Buffering the tail until the
 * newline actually arrives is the whole job, and getting it wrong drops cards
 * silently, which is the failure mode that never shows up in a happy-path demo.
 *
 * Pure string handling on purpose: no fetch, no Deno, no DOM. The Edge Function
 * imports this file directly (supabase/functions/_shared), so what the tests here
 * exercise is the code that runs in production rather than a sibling of it.
 */

/** A line reader that survives chunk boundaries. */
export type LineReader = {
  /** Complete lines contained in everything pushed so far. */
  push(chunk: string): string[];
  /** Whatever sits after the last newline — a partial line, or ''. */
  rest(): string;
  /**
   * The trailing partial line, and clears it. Call at end of stream *only* when
   * the stream ended cleanly: a response truncated by `max_tokens` ends with
   * half a card, and half a card must be discarded rather than salvaged
   * (SPEC §7.2).
   */
  flush(): string[];
};

export function createLineReader(): LineReader {
  let buffer = '';

  return {
    push(chunk: string): string[] {
      buffer += chunk;
      const lines = buffer.split('\n');
      // The last element is either '' (the chunk ended on a newline) or the
      // start of a line whose remainder has not arrived yet. Either way it stays
      // in the buffer rather than being handed out as if it were complete.
      buffer = lines.pop() ?? '';
      return lines.map(stripCarriageReturn);
    },

    rest(): string {
      return buffer;
    },

    flush(): string[] {
      const tail = stripCarriageReturn(buffer);
      buffer = '';
      return tail.trim() === '' ? [] : [tail];
    },
  };
}

function stripCarriageReturn(line: string): string {
  return line.endsWith('\r') ? line.slice(0, -1) : line;
}

/**
 * Is this line worth parsing?
 *
 * Blank lines are ordinary NDJSON padding. Fences are a prompt failure the
 * prompt cannot fully prevent: told "no markdown", a model will still open with
 * ```json perhaps one time in twenty. Skipping those three characters costs
 * nothing and saves a `warn` frame that would tell the user nothing useful.
 */
export function isIgnorableLine(line: string): boolean {
  const trimmed = line.trim();
  return trimmed === '' || trimmed.startsWith('```');
}

export type JsonLine =
  { ok: true; value: unknown } | { ok: false; reason: 'invalid_json' };

export function parseJsonLine(line: string): JsonLine {
  try {
    return { ok: true, value: JSON.parse(line) as unknown };
  } catch {
    return { ok: false, reason: 'invalid_json' };
  }
}
