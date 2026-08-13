# Phase plans

`SPEC.md` says _what_ the product is and _why_ each decision was made. These plans say
_how_ to execute one phase, in enough detail that a fresh session can be pointed at a
single file and start work without re-deriving anything.

## How to use one

> Execute docs/plans/P1-core-loop.md.

That should be the whole prompt. If a plan needs more context than that to act on, the
plan is underspecified — fix the plan.

## Convention

Each plan contains, in this order:

1. **Preconditions** — what must already be true, with a command to verify it.
2. **Out of scope** — what belongs to a later phase. This section exists because scope
   creep is the main failure mode of a plan like this; anything tempting-but-later goes
   here explicitly.
3. **Tasks** — ordered, each naming the files it touches. Ordered so the app builds and
   runs after every task, never only at the end.
4. **Acceptance criteria** — observable checks, not vibes.
5. **Tests to write** — named, with the specific failure each one catches.
6. **Decisions to record** — things the executing session must write back into `SPEC.md`
   or this file, so the next session inherits them.

## Why these are written one at a time

Only the next phase gets a detailed plan. A P4 plan written today would be fiction: it
would assume file layouts, hooks, and query keys that P1–P3 have not created yet, and
every drift between plan and reality is a session confidently doing the wrong thing.

So: the last task of every phase plan is to write the next one. That way each plan is
authored against the codebase it will actually run in.

## Board

| Phase            | Plan                                   | Status                                                          |
| ---------------- | -------------------------------------- | --------------------------------------------------------------- |
| P0 — Reset       | _(executed inline, no plan file)_      | ✅ Complete — 2026-08-12                                        |
| P0b — Cloud link | [P0b-cloud-link.md](P0b-cloud-link.md) | ✅ Complete — 2026-08-12                                        |
| P1 — Core loop   | [P1-core-loop.md](P1-core-loop.md)     | ✅ Complete — 2026-08-12                                        |
| P2 — Generation  | [P2-generation.md](P2-generation.md)   | ✅ Complete — 2026-08-12                                        |
| P3 — Progress    | [P3-progress.md](P3-progress.md)       | ✅ Complete — 2026-08-12                                        |
| P4 — Ship        | [P4-ship.md](P4-ship.md)               | 🟡 Code complete — 2026-08-13; the deploy itself is the owner's |
| P5 — Identity    | [P5-identity.md](P5-identity.md)       | ✅ Complete — 2026-08-13                                        |
| P6 — Surface     | [P6-surface.md](P6-surface.md)         | ✅ Complete — 2026-08-13                                        |
| P7 — Landing     | [P7-landing.md](P7-landing.md)         | 📋 Planned, not started                                         |
| Post-v1          | [POST-V1.md](POST-V1.md)               | 📋 Backlog, not a phase                                         |

The split that still matters day to day: schema and RLS changes are testable locally
against PGlite (`npm test`), but anything touching Supabase Auth needs the real project,
because the harness only stubs `auth.users`.

All five migrations are applied and `src/types/database.ts` is generated from the live
schema. P1 pushed `…_review_card.sql` and `…_revoke_anon_rpc.sql`; **P2 added none** — the
`generations` table, `deck_status`, and `card_status = 'draft'` were all built in P0 for
it; P3 added `20260812210000_progress_stats.sql`. **P4 adds none either**, so it starts
against a database that matches the repository.

Second split, new since P2: `tsc` and ESLint both exclude `supabase/functions`, so the
Edge Function is typechecked only by `npm run fn:check` (Deno). Run it alongside the other
four commands whenever anything under `src/lib` that the function imports changes — the
bridge in `supabase/functions/_shared/` means those files are compiled by two compilers.

Third, new since P3 and finished in P4: the bundle is split. Everything except the auth
pages, the dashboard and the deck list loads lazily, so `npm run build` prints a dozen
chunks and the number that matters is the eager one (`index-*.js`). It is **788 kB raw /
233 kB gzip** after P6, and P4 records why the 400 kB target it was given is unreachable with
this dependency set — read that table before trying again. P6 added ~6 kB raw to it, all of
it accounted for: the account menu, the three-state theme control and the `Kbd` primitive
are new components inside the eager `AppLayout`, plus two lucide icons that were not
previously imported anywhere. No new dependency entered the first chunk.

The same P2 item is still outstanding and still belongs to the owner: setting
`GROQ_API_KEY` and `GENERATION_MODEL` as function secrets and running `npm run fn:deploy`.
Until then `/create/text` answers "not configured on this project yet". It did not block
P3. **It blocked the end of P4**: `scripts/seed-demo.mjs` is written and its replay is
verified offline, but it cannot be run, because the demo decks have to contain generated
cards. The owner's remaining list is at the bottom of [P4-ship.md](P4-ship.md).

Fourth, new since P5: the visual system is `src/styles/globals.css` and nothing else — no
component hardcodes a colour, and `src/test/tokens.test.ts` enforces three invariants about
that file (theme parity, chroma-0 neutrals, and the grade ramp's lightness ordering). The
shipped icons and social cards in `public/` are **generated** by `npm run brand:assets` from
`assets/brand/*.svg`; edit the masters, re-run, and commit the result. Re-running must leave
`git status --porcelain public/` empty.

Fifth, new since P6: that closure is now enforced from the other direction too.
`src/test/palette.test.ts` walks every `.ts`, `.tsx` and `.css` file under `src/` and fails on
a numbered Tailwind palette class or a literal colour outside a comment, so "just this one
green" cannot get back in. P6 also settled the typographic rules a later session would
otherwise re-litigate — where the serif may appear, that numbers are mono, and what "one
accent per screen" excludes — all recorded in SPEC §12 under _Closed at P6_.
