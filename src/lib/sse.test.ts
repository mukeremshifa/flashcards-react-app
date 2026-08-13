import { describe, expect, it } from 'vitest';
import { createSseDecoder, encodeSseFrame, SSE_HEARTBEAT, SSE_DONE } from './sse';

/**
 * Both SSE streams in the app are decoded by this: Groq's (data only) and the
 * Edge Function's own (named events). The failures worth a test are the ones
 * that look like nothing happening — a frame split across chunks, and a
 * heartbeat mistaken for an empty card.
 */

describe('decoding', () => {
  it('reads a named event and its data', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('event: card\ndata: {"id":"1"}\n\n')).toEqual([
      { event: 'card', data: '{"id":"1"}' },
    ]);
  });

  it('reads a data-only frame, as Groq sends', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: {"choices":[]}\n\n')).toEqual([
      { event: null, data: '{"choices":[]}' },
    ]);
  });

  it('reassembles a frame split mid-field across chunks', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('event: ca')).toEqual([]);
    expect(decoder.push('rd\ndata: {"id":')).toEqual([]);
    expect(decoder.push('"1"}\n\n')).toEqual([{ event: 'card', data: '{"id":"1"}' }]);
  });

  it('ignores the heartbeat comment', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(SSE_HEARTBEAT)).toEqual([]);
    // …and does not lose the next real frame because of it.
    expect(decoder.push('event: done\ndata: {"returned":2}\n\n')).toEqual([
      { event: 'done', data: '{"returned":2}' },
    ]);
  });

  it('joins multi-line data fields with newlines, per the protocol', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: one\ndata: two\n\n')).toEqual([
      { event: null, data: 'one\ntwo' },
    ]);
  });

  it('strips exactly one leading space from a value', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data:  padded\n\n')).toEqual([{ event: null, data: ' padded' }]);
  });

  it('surfaces the terminator so the reader can skip it', () => {
    const decoder = createSseDecoder();
    expect(decoder.push(`data: ${SSE_DONE}\n\n`)).toEqual([
      { event: null, data: SSE_DONE },
    ]);
  });

  it('does not dispatch a frame that has not been terminated yet', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('event: card\ndata: {"id":"1"}\n')).toEqual([]);
  });

  it('dispatches a trailing unterminated frame on flush', () => {
    const decoder = createSseDecoder();
    decoder.push('event: card\ndata: {"id":"1"}\n');
    expect(decoder.flush()).toEqual([{ event: 'card', data: '{"id":"1"}' }]);
  });

  it('reads several frames arriving in one chunk', () => {
    const decoder = createSseDecoder();
    expect(decoder.push('data: a\n\ndata: b\n\n')).toEqual([
      { event: null, data: 'a' },
      { event: null, data: 'b' },
    ]);
  });
});

describe('encoding', () => {
  it('frames an event the decoder reads back', () => {
    const frame = encodeSseFrame('card', { id: '1', index: 0 });
    expect(frame).toBe('event: card\ndata: {"id":"1","index":0}\n\n');
    expect(createSseDecoder().push(frame)).toEqual([
      { event: 'card', data: '{"id":"1","index":0}' },
    ]);
  });

  it('keeps a payload containing newlines on one wire line', () => {
    // A card front with a line break must not become two `data:` lines by
    // accident — JSON.stringify escapes it, and this asserts that it stays that
    // way.
    const frame = encodeSseFrame('card', { front: 'line one\nline two' });
    expect(frame.split('\n')).toHaveLength(4); // event, data, blank, trailing
    const [decoded] = createSseDecoder().push(frame);
    expect(JSON.parse(decoded!.data)).toEqual({ front: 'line one\nline two' });
  });
});
