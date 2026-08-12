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

| Phase            | Plan                                   | Status                     |
| ---------------- | -------------------------------------- | -------------------------- |
| P0 — Reset       | _(executed inline, no plan file)_      | ✅ Complete — 2026-08-12   |
| P0b — Cloud link | [P0b-cloud-link.md](P0b-cloud-link.md) | ✅ Complete — 2026-08-12   |
| P1 — Core loop   | [P1-core-loop.md](P1-core-loop.md)     | 📋 Ready to execute        |
| P2 — Generation  | _not yet written_                      | Written at the close of P1 |
| P3 — Progress    | _not yet written_                      | Written at the close of P2 |
| P4 — Ship        | _not yet written_                      | Written at the close of P3 |

P0b is done, so **P1 has no external blockers** — the database is live, typed, and
RLS-verified. Note the split that still matters day to day: schema and RLS changes are
testable locally against PGlite (`npm test`), but anything touching Supabase Auth needs the
real project, because the harness only stubs `auth.users`.
