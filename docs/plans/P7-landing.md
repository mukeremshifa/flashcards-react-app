# P7 — Landing

P6 finished the inside of the app. Every screen behind a session now reads as one product,
but there is still no way to find out what SynapseDeck is without creating an account: `/`
redirects to `/dashboard`, `/dashboard` bounces a signed-out visitor to `/login`, and the
login card is the entire pitch. P7 gives the product a front door.

This is the phase with the risk in it. It is the only one left that changes the route table
and what an anonymous request can reach — two things that are easy to get subtly wrong and
hard to notice afterwards.

**Reference:** SPEC.md §1, §8.2, §10 (Security, Performance), §11, §12 _Closed at P6_.
**Done when:** a stranger who has never heard of it understands the product before signing
up, and the page they land on makes no authenticated request to do it.

## Preconditions

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- **346 tests across 29 files**, all green, on branch `dev`.
- P6 is committed. In particular: the typographic rules in SPEC §12 _Closed at P6_ are what
  the landing page has to be built out of — the serif is for the wordmark, the page headline,
  and card questions; numbers are mono; the accent marks one thing per screen.
- `npm run brand:assets` leaves `public/` unchanged.
- **There is no bundle-size target, here or anywhere after this.** P4 was given 400 kB and
  recorded why it is unreachable with this dependency set; P5 and P6 then spent paragraphs
  justifying single-digit kB. The build takes the size it needs. What survives from all that
  is not a number but a boundary, and it is trap 3 below.

## The three traps, up front

Everything below assumes these are understood, because each one fails quietly.

1. **`src/app/routes.test.tsx` asserts `toHaveLength(6)` on the lazy imports.** That number
   is deliberate — it exists so a drop to zero cannot make the test pass by testing nothing.
   Adding a lazily-loaded landing page makes it 7. Update the number _and_ the comment that
   explains it in the same commit; do not delete the assertion.

2. **Moving `/` out of `ProtectedRoute` changes what an anonymous request can reach.** Today
   the index route is a `<Navigate>` inside the guarded layout, so `/` is effectively
   private. After P7 it is public. Nothing about RLS changes — the landing page must make no
   authenticated request at all — but the guard is now protecting one fewer path, and
   `PublicOnlyRoute` has to be considered: a signed-in user who opens `/` should land on the
   app, not on a marketing page for a product they already use.

3. **The landing page must not reach the data layer at all.** Not for size — for behaviour.
   One `import { useDecks } from '@/lib/queries'` pulls in Supabase and TanStack Query, and
   the moment a query hook is rendered the page starts making requests on behalf of a visitor
   who has no session and has not asked for anything. A marketing page that opens a websocket
   and 401s in the console is a bad first impression and a slow one. Import from
   `@/components/ui/*`, `@/components/Logo`, `@/app/ThemeChoice`, `react-router-dom` and
   `lucide-react`. Nothing from `@/lib/queries`, `@/lib/supabase`, or `@/features/*`.

## The identity, on a page that is mostly headline

P6 closed the visual system for screens with chrome around them. A landing page has none, so
three of its rules bite harder here than anywhere in the app.

- **The accent is a field, never a foreground.** `--primary` is `oklch(0.922 0.181 122.5)` —
  lightness 0.92, roughly 1.2:1 against paper. A chartreuse headline is invisible in the light
  theme and, in the dark one, spends the page's entire accent budget on decoration. Headlines
  are ink on paper or paper on ink; the accent goes on the primary call to action and stops.
  `src/test/palette.test.ts` will **not** catch a violation — it checks that no literal colours
  are used, not that a token is used correctly. This one is on the reviewer.

- **The headline is already written, and already shipped.** `public/og-image.png` — the image
  every shared link renders — reads _"Forgetting is the schedule."_ set in the serif over the
  grade ramp. If the page's `h1` says something different, the preview and the page disagree,
  and nobody finds out until the link is posted somewhere. Use it, or change both: the card's
  copy is a string in `scripts/build-brand-assets.mjs`, and `npm run brand:assets` regenerates
  it. Do not let them drift.

- **The grade ramp is the one signature graphic this brand has.** Red → `#D0F861` across the
  four FSRS grades, already on the social card, already on the rating buttons. It is the
  honest illustration of what the product does, it costs four `<div>`s, and it is exempt from
  the once-per-screen accent rule because it is a scale rather than an emphasis (SPEC §12
  _Closed at P6_). Reach for it before inventing a graphic.

## Out of scope — do not build these here

- **A blog, docs site, pricing page, or changelog.** One route, `/`, plus whatever metadata
  it needs. Anything with a second page in it is post-v1.
- **Analytics of any kind.** P4 settled this for error reporting and the reasoning is
  identical: a third-party script on a page that also serves untrusted model output is a
  security decision v1 does not need to make (SPEC §10).
- **Screenshots of the app.** A PNG of a dashboard goes stale the first time a screen
  changes, cannot follow the theme, and has to be regenerated by hand every time. The product
  still has to be _shown_ — see task 2 — but it is shown with markup, not with pictures of
  markup.
- **Server-side rendering, prerendering, or a static export.** The app is a Vite SPA on
  Vercel with a catch-all rewrite. Changing that is a deployment-shaped decision, not a
  landing-page one, and every social scraper that matters reads the `<head>` in `index.html`,
  which is already static.
- **New colours, new faces, new components.** The system is closed; `src/test/palette.test.ts`
  will fail the build if it is reopened.
- **Touching the demo seed or the Edge Function.** Still the owner's, still blocked on
  `GROQ_API_KEY` — see the bottom of `P4-ship.md`.

## What already exists, and should be used rather than rebuilt

- `LogoMark` / `LogoLockup` (`src/components/Logo.tsx`) — the mark is inline SVG that
  inherits the theme, so it works on the landing page for free at any size.
- `ThemeChoice` (`src/app/ThemeChoice.tsx`) — the landing page is the first screen a stranger
  sees, and it is the only screen with no account menu to hide the control in. Reuse it;
  do not build a second toggle.
- The product's one marketing sentence lives in `index.html`'s `<meta name="description">`
  and, in longer form, at the top of `README.md`. `AuthPages.tsx`'s two `description` strings
  are panel copy for people who have already decided, not a pitch — do not mistake them for
  the tagline. Whatever the page ends up saying, the meta description has to agree with it.
- `index.html` already carries a full `<head>`: description, Open Graph, Twitter card,
  `theme-color` per scheme, and the pre-paint theme script. It has one recorded gap — the
  comment above the social tags says `og:image` and `og:url` must become **absolute** once a
  domain exists. That is a P7 task, not a P4 leftover.

## Tasks

Ordered so the app builds and runs after each.

### 1. The copy, before any markup

Write the page as sentences first, in the plan or in a scratch file, and only then build it.
A landing page assembled out of section components tends to end up with three headings that
say nothing because each was written to fill a box.

It has to answer four questions, in this order, and it is allowed to be short:

- What is it? (Spaced repetition over cards written from your own material.)
- What does it do that a pile of index cards does not? (The schedule, and the review gate.)
- Why should the numbers be believed? (Everything is counted from the review log — SPEC §13
  (4). This is the product's one distinctive honesty claim; it is already in the footer.)
- What happens if I click? (An account, free, decks private to you.)

Two claims to check against reality before writing them down: generation needs
`GROQ_API_KEY` on the deployed project, which is still outstanding, and there is no mobile
layout (SPEC §12 (6)). Do not promise either.

### 2. `src/features/marketing/LandingPage.tsx`

A new feature directory, because it is not part of any existing one and putting it in
`src/app/` would suggest it is shell.

Its own header — the lockup, `ThemeChoice`, and sign-in / sign-up links — rather than
`AppLayout`, which is the signed-in shell and is where the account menu lives. Its own
footer, carrying the same review-log sentence the app's footer does.

Keyboard and focus rules are the same as everywhere else: real `<a>`/`<button>` elements,
visible focus rings, one accent for the primary call to action and nothing else.

**How the product gets shown.** Not screenshots, and not hand-drawn SVG either: build the
visuals as ordinary presentational components with hardcoded props, in
`src/features/marketing/showcase/`. A card front mid-review, a few staged rows arriving from
the generator, the grade ramp. They are built from the same tokens and the same type rules as
the real screens, so they follow the theme, stay sharp at any zoom, cost no image bytes, and
cannot go stale in the way a picture does — but they are inert, and they import nothing from
`@/features/*`. Copy the markup; do not import the live components, or trap 3 comes back in
through the side door.

### 3. The route table — `src/app/routes.tsx`

The change itself is small and the consequences are not:

- `/` becomes a public route rendering the landing page, outside `ProtectedRoute`.
- Decide and record what a **signed-in** visitor to `/` sees. `PublicOnlyRoute` would send
  them to `/dashboard`, which is probably right, and is a one-line decision that will look
  arbitrary later if the reasoning is not written down.
- The landing page is lazy, so a signed-in user's first load does not pay for marketing they
  will never see. That makes the lazy count 7 — see trap 1.
- `/dashboard`, `/decks`, and everything else stay exactly as they are.

### 4. Metadata and the domain

Make `og:image` and `og:url` absolute in `index.html`, per the comment already sitting above
them. This needs the deployed domain, which is the owner's to supply — if it is not known
when P7 runs, leave the tags relative, and say so explicitly in the acceptance notes rather
than inventing a URL.

`public/robots.txt` already exists — P5 wrote it, and it already says the sitemap arrives
with this phase. Add `sitemap.xml` (one file; not a build step for a single route) and check
that the `Allow` rule still matches the route table. The app's authenticated routes are behind
a client-side guard, so they are not secret, but they are not worth crawling either.

### 5. What loads when

Not a size exercise — a correctness one. Two questions worth answering deliberately:

- **Is the landing page lazy?** It should be, so a signed-in user's first load does not
  fetch marketing they will never see.
- **Do the auth pages stay eager?** P4 made them eager because they were the first screen a
  signed-out visitor saw. After P7 they are not; `/` is. Whichever way it goes, say why in
  SPEC §12 — it is a one-line change that will look arbitrary in six months.

Record the build output in the acceptance notes as an observation. It is a fact about the
app, not a bar it has to clear.

### 6. Tests

See the table below.

### 7. Write `docs/plans/P8-*.md`, or close the board

P7 is the last phase in SPEC §11 before Post-v1. If nothing follows it, the last task is to
say so in `docs/plans/README.md` and move the remaining work into `POST-V1.md` — a board that
ends with an unexplained blank row is worse than one that says "done".

## Acceptance criteria

- `npm run typecheck && npm run lint && npm test && npm run build` green.
- `/` renders for a visitor with no session, makes **zero** network requests (check the
  network panel, not just the test), and links to both sign-in and sign-up.
- A signed-in visitor to `/` ends up wherever §3 decided, and that decision is in SPEC §12.
- `src/test/palette.test.ts` still passes — no new colours, no literal hex.
- `npm run brand:assets` still leaves `public/` unchanged.
- Every screen still passes the P6 rules: one accent per screen, serif only where SPEC §12
  allows, numbers in mono.

## Tests to write

| Test                                                                                                      | Failure it catches                                                                                            |
| --------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| `/` renders the landing page with no session and no redirect                                              | The index route being left inside `ProtectedRoute`, so the front door bounces every stranger to `/login`      |
| `/` sends a visitor **with** a session to the app                                                         | A returning user landing on marketing copy for a product they already pay attention to                        |
| The landing module imports nothing from `@/lib/queries`, `@/lib/supabase` or `@/features/*` (bar its own) | A marketing page firing authenticated requests, and 401s in the console, for a visitor who has no session     |
| `routes.test.tsx` still resolves every lazy import, with the count updated to 7                           | The `toHaveLength` guard being deleted rather than updated — after which a renamed page fails only at runtime |
| The landing page's sign-in and sign-up links point at `/login` and `/signup`                              | The one job of the page, broken by a typo that no other test would ever exercise                              |

## Decisions to record

Into `SPEC.md`: a ✅ on the §11 P7 row; §8.2's route list updated so `/` is no longer
described as a redirect; and into §12, what a signed-in visitor to `/` sees and why, plus
whether the auth pages stayed eager.

Into `docs/plans/README.md`: the board row, and the note about what is left after P7.

**Git, per CLAUDE.md:** commit to `dev`. No merge, no push, no PR, nothing touching `main`.
No migrations are involved, so `db:push` does not enter into this phase.

---

## Acceptance notes — executed 2026-08-13

**Gate:** `npm run typecheck && npm run lint && npm test && npm run build` green.
**355 tests across 31 files** (346/29 before), on `dev`. `npm run brand:assets` still leaves
`public/` unchanged.

### The three traps

1. `routes.test.tsx` — `toHaveLength(6)` became `toHaveLength(7)`, and the comment above it
   now reads "Six split routes at P4 task 4, seven since P7 made the landing page lazy… update
   it, never delete it." The assertion is intact.
2. `/` is out of `ProtectedRoute` and under `PublicOnlyRoute`. A signed-in visitor goes to
   `/dashboard`; the reasoning is in SPEC §12 _Closed at P7_ and in the route table's comment.
   No RLS change, no migration.
3. The data-layer boundary holds, and is now checked twice — see _Tests_ below.

### Task 4 — the domain, unresolved and recorded

No Vercel project is connected, so **`og:image` is still relative and there is still no
`og:url`**, per the escape hatch in task 4. Rather than leave that as a comment nobody reads:

- `index.html`'s social comment now says P7 checked, why nothing changed, and names the three
  edits that land together when a domain exists.
- `public/sitemap.xml` is new — one entry, hand-written, `<loc>__SITE_ORIGIN__/</loc>`. The
  protocol requires a fully-qualified `<loc>`, so an origin is unavoidable; an obvious token
  fails loudly, whereas an invented origin would index nothing and say nothing about why.
- `public/robots.txt` announces the sitemap with the same token.
- POST-V1 item 11 carries the follow-up with its trigger.

**`robots.txt` also changed shape.** Checking the `Allow` rule against the route table found
P5's per-route list had already drifted — `/account`, `/login` and `/signup` were never in it.
It is now `Allow: /$` plus a blanket `Disallow: /`, which is both self-maintaining and more
accurate: `vercel.json` rewrites everything to one `index.html`, so a crawled `/dashboard` is a
duplicate of `/` at a second address, not a new document.

### Task 5 — what loads when, measured

| Chunk                | Raw       | Gzip      |
| -------------------- | --------- | --------- |
| `index-*.js` (eager) | 788.44 kB | 232.70 kB |
| `LandingPage-*.js`   | 11.87 kB  | 3.55 kB   |
| `ForecastChart-*.js` | 369.25 kB | 108.46 kB |
| `index-*.css`        | 55.30 kB  | 13.76 kB  |

An observation, not a bar. The landing page is **lazy**: it is 11.9 kB a signed-in user never
renders, and referencing it lazily grew the eager chunk by 0.31 kB (788.13 → 788.44).

The auth pages **stay eager**, for a new reason rather than P4's. Measured by building both
ways: splitting them moves 4.79 kB raw / 1.59 kB gzip out of 788 kB, because `react-hook-form`,
Zod and the Supabase client all stay eager for other reasons. That is 1.6 kB saved once for a
signed-in user, against a chunk fetch on the single most important click in the funnel — the
sign-up button a stranger has just decided to press. Recorded in SPEC §12.

### Tests

Seven new, across three files:

| Test                                                            | File                        |
| --------------------------------------------------------------- | --------------------------- |
| `/` renders the landing page with no session and no redirect    | `routes.test.tsx`           |
| `/` sends a visitor with a session to the app                   | `routes.test.tsx`           |
| every lazy import resolves, count 7                             | `routes.test.tsx`           |
| sign-in links → `/login`, sign-up links → `/signup`             | `LandingPage.test.tsx`      |
| the `h1` still matches the string in `build-brand-assets.mjs`   | `LandingPage.test.tsx`      |
| the module graph reaches no data layer and no other feature     | `LandingPage.test.tsx`      |
| `/` fires zero requests with the real client and real providers | `landing-requests.test.tsx` |

Two are stronger than the plan asked for, deliberately:

- **The import check is transitive.** A direct `import … from '@/lib/queries'` is not how this
  will break; an innocuous import of a component that has one is. The test walks the graph and
  also fails on `@supabase/supabase-js`, `@tanstack/react-query`, `ts-fsrs` and `recharts`
  anywhere in it. Verified by inserting a violation into a _showcase_ file — two assertions
  failed, naming both the file and the packages.
- **"Zero network requests" is asserted, not eyeballed.** The plan said to check the network
  panel. `landing-requests.test.tsx` renders `Providers` + `AppRoutes` with the real Supabase
  client and `fetch`/`WebSocket` replaced by spies that reject, which covers the shell as well
  as the page — `AuthProvider` still mounts above every route, so "does the page import
  Supabase" was never the whole question. Verified non-vacuous by planting a stored session,
  which makes it fail on the token refresh.

### Copy, and the two claims that were checked

> **Superseded on 2026-08-14, in the two places marked below.** The owner revised the page
> after the board closed: it is responsive now, so the mobile disclosure was false and the
> footer that carried it was replaced; and the accent is deliberately spent twice. What is
> below is the record of what P7 shipped and why — the current rules are SPEC §12,
> _Changed after P7_. Do not restore either of these from this file.

Written as sentences first. The `h1` is the string already rasterised into `og-image.png`, and
a test now keeps them together. Neither unavailable thing is promised: the footer says plainly
that there is no mobile layout yet and that drafting cards from text needs a provider key on
the deployment — both stated rather than left to be discovered.

**The accent appears once**, on the hero's Create account button. The header's and the closing
section's are `outline`; secondary links are ink with an underline. The grade ramp is the one
exemption (a scale, not an emphasis), which is why the showcase rows are two _basic_ cards — a
revealed cloze blank and a revealed MCQ answer are both accent fields, and either would have
spent the budget twice inside an illustration.

### Left for the owner

Unchanged from P4 and still blocking nothing in this phase: `GROQ_API_KEY` / `GENERATION_MODEL`
as function secrets, `npm run fn:deploy`, the demo seed, and connecting Vercel. The domain is
now also what POST-V1 item 11 waits on. Nothing here was merged, pushed, or opened as a PR.
