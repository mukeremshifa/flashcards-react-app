# Post-v1 — the backlog

Not a phase. v1 is the product SPEC §1 describes, and everything below is something v1
deliberately does not do (SPEC §11).

This file opened by saying "there is no P5", which stopped being true the day the owner asked
for an identity — P5, P6 and P7 followed, and the note at the bottom records why. **P7 is the
last of them.** The board in [README.md](README.md) is closed, so from here this list is the
only place work lives.

So this file is written differently from a plan. Each entry says what the thing is, what
P1–P4 learned that changes how it should be built, and — the part that matters — **what
would have to be true before starting it**. An item with no trigger is an item that will
be started for the wrong reason, on a quiet afternoon, instead of the one that was
actually blocking someone.

Nothing here is scheduled. Nothing here is promised. Ordering below is roughly by
expected value, not by intent.

---

## 1. FSRS parameter optimisation

**What.** `profiles.fsrs_params` is `null` for every user, and `src/lib/fsrs.ts`
therefore schedules everyone with ts-fsrs's default weights. Optimisation replays a user's
own review history to fit the 21 FSRS weights to how _they_ actually forget, and stores
the result in that column. `scheduler(params)` already takes them — the plumbing is done.

**What P1–P4 learned.**

- `reviews` has carried the full pre-review snapshot since P1 (`state_before`,
  `stability_before`, `difficulty_before`, `due_before`, `last_review_before`,
  `elapsed_days`, `scheduled_days`, `learning_steps_before`). That was not for undo alone.
  It is exactly the input an optimiser replays from, which is why this needs **no
  migration** — the column to write and the rows to read both already exist.
- `undone_at` tombstones rather than deletes, so the optimiser gets to decide for itself
  whether an undone rating is signal. It usually is not.
- P3 built the thing that says when to start: `/progress` counts reviews. The trigger
  below is now observable rather than guessed at.

**Before starting.** The user has **~1,000 reviews**. Below that the fit is noise dressed
as personalisation, and it will move intervals in ways that look like a bug. Two further
conditions: the optimiser runs somewhere that is not the render path (an Edge Function or
an explicit button on `/settings`, never a `useEffect`), and there is a way back — storing
the parameters is only safe if clearing them is one click, because a bad fit degrades the
schedule silently and slowly.

**Watch for.** ts-fsrs ships an optimiser, but its API and weight count have moved between
majors. Pin it, and record the version beside the parameters — a `fsrs_params` written by
one weight vector and read by another is silent corruption of exactly the kind §6 exists
to prevent.

---

## 2. Documents: `.txt` / `.md`, then PDF text-layer

**What.** SPEC §12 (1): upload a file instead of pasting into a textarea. `.txt` and `.md`
first, then PDFs with a text layer, ≤50 pages.

**What P1–P4 learned.**

- The hard part is not parsing, it is **chunking**. `GENERATION_LIMITS.maxChars` is 20,000
  and a PDF chapter is far more than that, so a document is _n_ generations, not one — and
  `generations` is per-request, quota is per-generation (30/month), and the burst limiter
  allows 3 per 60 s. A 60-page PDF under today's rules is either a quota violation or a
  ten-minute wait.
- Which means this needs a **job**, not a longer request. Edge Functions have a wall-clock
  limit and the SSE stream is already the longest-lived thing in the app; a document is
  the first feature that cannot be modelled as one request holding one stream.
- Scanned PDFs have no text layer. Deciding that in the browser before uploading 20 MB is
  worth more than any server-side cleverness after.

**Before starting.** Generation has been live long enough to know the real per-generation
cost and failure rate (the `generations` table already records both), and there is a
decision on the quota shape for multi-chunk work — because "one document = 12 of your 30
monthly generations" is a product decision, not an implementation detail.

---

## 3. A set-a-new-password screen

**What.** Password recovery is half-built and it is the smallest real gap in the product.
Supabase can send a recovery link, `/auth/callback` (P4) exchanges it correctly, and the
user lands on `/dashboard` signed in — with nowhere to actually set a new password.
`/settings` has no password field.

**What P1–P4 learned.** The callback already distinguishes the flows it receives; routing
`type=recovery` somewhere other than the dashboard is a few lines. The work is the screen
and `supabase.auth.updateUser({ password })`, plus the ordinary care about a recovery
session being a _time-limited_ one.

**Before starting.** The first person who cannot get into their account. That is not a
joke about priorities: with one demo account and an owner who knows the password, this is
theoretical, and the moment there is a second real user it is not.

---

## 4. Split `src/lib/queries.ts`

**What.** P4 measured the eager bundle and found `ts-fsrs` (21.6 kB raw) in it, despite
`PracticePage` being lazy. The cause is module granularity, not the route split:
`queries.ts` is one 1,150-line module that both eager pages (`DashboardPage`, `DecksPage`)
and lazy ones import, so everything it reaches — including `fsrs.ts` — lands in the chunk
the login screen downloads.

**What P1–P4 learned.** The fix is a `src/lib/queries/` directory with a barrel re-export
(`decks.ts`, `cards.ts`, `practice.ts`, `progress.ts`, `keys.ts`), so no call site changes
and Rollup can leave `practice.ts` out of the eager chunk. Measured payoff: about 22 kB of
781 kB. It does not change whether the P4 target is met, which is why P4 recorded it here
rather than doing it — see the bundle table in [P4-ship.md](P4-ship.md).

**Before starting.** Either the file is being edited for another reason anyway (do it
then, not as its own change), or the eager bundle becomes a real complaint — which, given
the vendor floor documented in P4, means the dependency set changed, not the routes.

---

## 5. PWA and offline

**What.** SPEC §12 (6) settled v1 as desktop web only. Offline means a service worker, a
local queue of ratings, and reconciliation on reconnect.

**What P1–P4 learned.**

- **`review_card` is the reason this is hard, and also the reason it is possible.** It
  refuses a rating whose `expected_updated_at` does not match, so a replayed offline queue
  cannot silently overwrite a schedule — it gets `PT409` and the client must decide. That
  is a real conflict-resolution design, not a sync bug to paper over.
- FSRS is already pure and client-side (`src/lib/fsrs.ts` reads no clock it is not given),
  so rating offline computes the correct next state locally. Nothing about the scheduler
  needs to change.
- Generation cannot work offline at all, so the offline product is _practice_, and the
  app has to say so rather than showing a dead Create button.

**Before starting.** Somebody actually studies on a train. Until then this is a large,
permanently-owned surface — cache invalidation on a versioned bundle — bought for a
convenience nobody has asked for.

---

## 6. Shared decks

**What.** One user publishes a deck; another copies it into their own account.

**What P1–P4 learned.** RLS is the entire security boundary (SPEC §10), and every policy
in `…_rls.sql` is `auth.uid() = user_id`. Sharing is the first feature that breaks that
sentence, and it must not break it by relaxing those policies. The shape that keeps them
intact: a separate `published_decks` (or a `visibility` column plus a policy that permits
`select` on published rows only), and **copy on import** — the importing user gets their
own `cards` rows with fresh scheduling state, because a shared deck's FSRS state is
meaningless to anyone else's memory.

**Before starting.** There are enough users for one of them to want another's deck. Also
a moderation answer, because the moment a deck crosses accounts, untrusted LLM output
stops being "untrusted by the person who generated it" and becomes content one person
sends another. `dangerouslySetInnerHTML` is already blocked by lint; the harder question
is what a report button does.

---

## 7. Generated quiz mode

**What.** A quiz over existing cards — a run of _n_ questions with a score at the end —
rather than the open-ended due queue.

**What P1–P4 learned.** The tempting version is wrong. Cards are already MCQ-capable and
`review_card` already grades them, so a "quiz" that writes reviews is just practice with a
scoreboard, and it would corrupt the schedule: quiz answers are not spaced reviews, and
feeding them to FSRS moves intervals for reasons the model does not represent.

**Before starting.** A decision on whether quiz results touch the schedule at all. If they
do not (the honest answer), this is a new read of `cards` and a new session type that
writes nothing — small, and worth doing only if practice alone is not enough for the way
somebody actually revises.

---

## 8. Notes

**What.** SPEC §11's last item: free-text notes attached to a deck or a card, so the source
material lives beside the cards made from it.

**What P1–P4 learned.** `cards.source_excerpt` already stores the slice of text a card came
from, and the review gate already shows it. That covers most of what notes were wanted for.
Whatever remains is a text field, and the only real decision is rendering: Markdown means
sanitisation, and SPEC §10 says so explicitly.

**Before starting.** Someone asks for it after using the review gate for a while — the
excerpt may well have made it unnecessary.

---

## 9. Error reporting, analytics, CSP

**What.** P4 deliberately shipped error boundaries that only `console.error`, and no
third-party scripts of any kind.

**What P1–P4 learned.** The reasoning is recorded in P4 and still holds: a third-party
script on a page that renders untrusted LLM output is a decision with a security argument
attached. The related item is the one nobody asked for and everybody wants eventually — a
**Content-Security-Policy** on the Vercel deploy. `vercel.json` is the place, the app has
no inline scripts of its own, and a CSP is worth more than an error reporter here.

**Before starting.** A CSP: as soon as anyone is asked to trust the deployed URL with
anything. An error reporter: when a bug is reported that the console cannot explain, and
with a vendor whose script does not read the DOM.

---

---

## 10. A responsive layout

**What.** SPEC §12 (6) settled v1 as desktop web, and every screen is built for it: the app
shell is a six-link header at a fixed height, `/decks` and `/decks/:id` are tables, and the
landing page's sections are two-column grids that stack but were not designed stacked.

**What P1–P7 learned.** P7 is the phase that made this cost something. Until then the only
people who saw the app had already decided to use it and were sitting at a desk; a landing
page is a link somebody opens on a phone, from a message, once. It is also the first screen
in the product that has to _say_ so — the footer states there is no mobile layout, because
the alternative was a page that quietly looks broken on the device most likely to open it.

The good news is that P5–P7 removed most of what usually makes this expensive. There is one
token file, no hardcoded colours, no fixed pixel type scale, and `src/test/palette.test.ts`
means a responsive pass cannot introduce a stray colour on the way through. The work is
layout and the header, not a redesign.

**Before starting.** Somebody opens the deployed link on a phone and cannot read it — which
requires a deployed link, so this is downstream of the item below. If the honest answer stays
"this is a portfolio project people open on a laptop", the footer sentence is a better
product than a half-finished responsive pass.

**Watch for.** Practice is the screen that matters and the one most likely to be treated as a
narrow desktop layout. Four rating buttons in a row at 360 px is four tap targets under the
minimum size, and mis-tapping `Again` on a mature card damages its schedule — which is the
whole reason undo exists (SPEC §4.2).

---

## 11. The deployed origin

**What.** Not a custom domain — any origin at all, including the free Vercel one. Three
files are waiting on it: `public/sitemap.xml` and `public/robots.txt` each carry a
`__SITE_ORIGIN__` token, and `index.html` still has a relative `og:image` and no `og:url`.

**What P7 learned.** This is the one thing in the phase that could not be finished from
inside the repository, and it is smaller than it looks: the sitemap protocol requires a
fully-qualified `<loc>`, and several social scrapers will not resolve a relative image
against the page, so both are one string away from correct. P7 left an obvious token rather
than a plausible invented origin on purpose — a fake domain produces link previews that 404
and a sitemap that indexes nothing, and does it silently.

**Before starting.** The Vercel project is connected (the owner's list at the bottom of
[P4-ship.md](P4-ship.md)). Then it is one commit: replace the token in two files, make
`og:image` absolute, add `og:url`, and check the preview with any card validator.

---

## What is explicitly _not_ on this list

- **Per-deck analytics.** Settled at P3: `/progress` is account-wide, and the argument for
  it (a review log is one memory, not several) has not changed.
- **A custom domain, CDN tuning, multi-region.** Vercel's default domain serves v1 — which
  is exactly what item 11 above is waiting for. The distinction matters: a _custom_ domain is
  still not on this list, an _origin of any kind_ is now a real dependency of three files.

**Reversed 2026-08-13.** This list used to end with "**A redesign.** The product's look is
settled." It was not settled; it was never decided. P1–P4 shipped stock shadcn `neutral` with
the default blue because a palette was never the phase's job, and "settled" recorded the
absence of a decision as if it were one. The owner asked for an identity, which is a product
decision and not a backlog item — so it became **P5 / P6 / P7** (SPEC §11) rather than an
entry here. The identical line in [P4-ship.md](P4-ship.md) stands: it correctly describes what
P4 chose not to do, and a finished plan is a record, not a live document.
