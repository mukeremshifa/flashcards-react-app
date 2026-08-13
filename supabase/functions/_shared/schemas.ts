/**
 * The client's schemas, re-exported for Deno.
 *
 * SPEC §9 and CLAUDE.md both say it in one line: one Zod definition per concept,
 * in `src/lib/schemas.ts`, shared by client and Edge Function. Deno cannot follow
 * the `@/` alias, so the bridge is this relative import — a real import, not a
 * copy. A duplicated card schema would drift the day someone tightened a bound on
 * one side, and the divergence would show up as cards the browser refuses to
 * render after the server has already stored them.
 *
 * `zod` resolves through the import map in supabase/functions/deno.json.
 */
export * from '../../../src/lib/schemas.ts';
