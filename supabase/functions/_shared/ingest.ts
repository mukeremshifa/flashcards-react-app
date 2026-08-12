/**
 * The pure half of the pipeline, re-exported for Deno.
 *
 * Same bridge as `schemas.ts` and for the same reason: the line reader, the SSE
 * decoder and the per-line ingest rule are tested by `npm test` under `src/`, and
 * what the Edge Function runs must be those exact functions rather than a Deno
 * copy that drifts. If a chunk-boundary bug is fixed in `src/lib/ndjson.ts`, it
 * is fixed here by construction.
 */
export { createLineReader, isIgnorableLine } from '../../../src/lib/ndjson.ts';
export { createSseDecoder, SSE_DONE } from '../../../src/lib/sse.ts';
export { ingestLine, type IngestedCard } from '../../../src/lib/generate.ts';
export { newCardScheduling } from '../../../src/lib/fsrs.ts';
