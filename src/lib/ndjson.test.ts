import { describe, expect, it } from 'vitest';
import { createLineReader, isIgnorableLine, parseJsonLine } from './ndjson';

/**
 * The bug this file exists to prevent: a card lost because the newline that
 * ended it arrived in the next network chunk. It is invisible in a demo, it does
 * not throw, and the only symptom is "sometimes I ask for 20 and get 19".
 */

/** Feed a whole payload through in arbitrary slices, as a socket would. */
function readInChunks(text: string, sizes: number[]): string[] {
  const reader = createLineReader();
  const lines: string[] = [];
  let cursor = 0;

  for (const size of sizes) {
    if (cursor >= text.length) break;
    lines.push(...reader.push(text.slice(cursor, cursor + size)));
    cursor += size;
  }
  if (cursor < text.length) lines.push(...reader.push(text.slice(cursor)));

  lines.push(...reader.flush());
  return lines;
}

describe('chunk boundaries', () => {
  const payload = '{"a":1}\n{"b":2}\n{"c":3}\n';

  it('reassembles a line split across two chunks', () => {
    const reader = createLineReader();
    expect(reader.push('{"a":')).toEqual([]);
    expect(reader.push('1}\n')).toEqual(['{"a":1}']);
  });

  it('yields the same lines however the stream is sliced', () => {
    const expected = ['{"a":1}', '{"b":2}', '{"c":3}'];
    for (const size of [1, 2, 3, 5, 7, 11, 100]) {
      const sizes = Array.from({ length: Math.ceil(payload.length / size) }, () => size);
      expect(readInChunks(payload, sizes)).toEqual(expected);
    }
  });

  it('holds back a partial line rather than emitting half a card', () => {
    const reader = createLineReader();
    expect(reader.push('{"a":1}\n{"b":')).toEqual(['{"a":1}']);
    expect(reader.rest()).toBe('{"b":');
  });

  it('emits several complete lines from one chunk', () => {
    const reader = createLineReader();
    expect(reader.push('{"a":1}\n{"b":2}\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('handles CRLF, which some proxies introduce', () => {
    const reader = createLineReader();
    expect(reader.push('{"a":1}\r\n{"b":2}\r\n')).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('treats a blank line as a line, not as the end of anything', () => {
    const reader = createLineReader();
    expect(reader.push('{"a":1}\n\n{"b":2}\n')).toEqual(['{"a":1}', '', '{"b":2}']);
  });
});

describe('flush', () => {
  it('returns the trailing line when the stream ends without a newline', () => {
    const reader = createLineReader();
    reader.push('{"a":1}');
    expect(reader.flush()).toEqual(['{"a":1}']);
  });

  it('returns nothing when the stream ended cleanly', () => {
    const reader = createLineReader();
    reader.push('{"a":1}\n');
    expect(reader.flush()).toEqual([]);
  });

  it('clears the buffer, so a second flush is empty', () => {
    const reader = createLineReader();
    reader.push('{"a":1}');
    reader.flush();
    expect(reader.flush()).toEqual([]);
  });

  it('leaves the truncated tail readable without emitting it', () => {
    // `finish_reason: 'length'` means this is half a card. The Edge Function
    // checks `rest()` to know something was there, and never flushes it.
    const reader = createLineReader();
    reader.push('{"card":{"kind":"basic","fro');
    expect(reader.rest()).toBe('{"card":{"kind":"basic","fro');
  });
});

describe('ignorable lines', () => {
  it('skips blank lines and markdown fences', () => {
    expect(isIgnorableLine('')).toBe(true);
    expect(isIgnorableLine('   ')).toBe(true);
    expect(isIgnorableLine('```json')).toBe(true);
    expect(isIgnorableLine('```')).toBe(true);
  });

  it('does not skip a card', () => {
    expect(isIgnorableLine('{"kind":"basic"}')).toBe(false);
  });
});

describe('parseJsonLine', () => {
  it('parses a well-formed line', () => {
    expect(parseJsonLine('{"a":1}')).toEqual({ ok: true, value: { a: 1 } });
  });

  it('reports a malformed line instead of throwing', () => {
    expect(parseJsonLine('{"a":')).toEqual({ ok: false, reason: 'invalid_json' });
  });

  it('survives a line that is prose rather than JSON', () => {
    expect(parseJsonLine("I'm sorry, I can't help with that.")).toEqual({
      ok: false,
      reason: 'invalid_json',
    });
  });
});
