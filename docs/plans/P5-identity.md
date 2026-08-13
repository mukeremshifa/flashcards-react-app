# P5 — Identity

The app is finished and anonymous. It wears stock shadcn `neutral` with the default blue,
Poppins off the Google Fonts CDN, one 15 kB `logo-light.png` standing in for an entire icon
set, and the product name exists in exactly one place: the string `Flashcards` in the header.
P5 gives it a name, a token system, a mark, and a generated asset set — the foundation every
later surface change is measured against.

**Reference:** SPEC.md §1, §8.1, §8.4, §10, §11.
**Done when:** the app is SynapseDeck everywhere, `npm run brand:assets` regenerates every
icon and social card deterministically, and the only colour on a practice screen is the four
grade buttons.

## Preconditions

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- **305 tests across 21 files**, all green, on branch `dev`.
- No migrations are involved. `db:push`, `db:types` and `db:pg-version` do not enter into
  this phase at all — the schema is untouched.
- Baseline to beat, from P4: eager bundle **781.31 kB raw / 230.94 kB gzip**. Fonts are
  separate assets and do not count against it; a JS regression does.

## Out of scope — do not build these here

- **Per-screen layout work.** Every screen inherits the new tokens automatically, because
  nothing in `src/` hardcodes a colour. Re-laying out `PracticeSession`, `DashboardPage`, the
  progress cards or the generate flow is **P6**, and doing it here is how this phase stops
  being reviewable.
- **The landing page, and any change to the route table.** That is **P7**. `/` stays inside
  `ProtectedRoute` for now.
- **New shadcn primitives.** Ten exist. P6 adds what it turns out to need; adding a
  `dropdown-menu` today on the theory that a user menu is coming is speculation.
- **Splitting `src/lib/queries.ts`** (POST-V1 item 4) and **a CSP header** (POST-V1 item 9).
  The CSP belongs with P7, when there is a public URL to harden.
- **Animation.** The flip stays exactly as it is. No animation library.

## What already exists, and should be used rather than rebuilt

- `src/styles/globals.css` is the entire design system: `:root` / `.dark` custom properties
  mapped into utilities through `@theme inline`. **Keep that architecture.** P5 replaces
  values, not the mechanism.
- `src/app/theme.tsx` already does light/dark/system with a `matchMedia` listener and
  localStorage. It needs a key rename and nothing else.
- `Heatmap.tsx` derives its five levels with
  `color-mix(in oklab, var(--color-primary) N%, var(--color-muted))` rather than hardcoding
  green. It keeps working through the palette change and gets better.
- `scripts/check-pg-version.mjs` is the model for task 7's script: plain `.mjs`, a header
  comment explaining why it exists, exit codes that mean something.

## Tasks

### 1. The name — `index.html`, `package.json`, `README.md`, `src/app/theme.tsx`

`<title>` becomes `SynapseDeck`, the meta description is rewritten, `package.json` name
becomes `synapsedeck`, README h1 and SPEC h1 follow.

`src/app/theme.tsx` holds `STORAGE_KEY = 'flashcards.theme'`; it becomes `synapsedeck.theme`.
That discards every saved theme preference. With one demo account it costs nothing, and it is
the only moment it will ever be free — say so in the commit rather than leaving a key named
after a product that no longer exists.

Do not touch the `AppLayout` wordmark string. Task 6 deletes it.

### 2. Fonts, self-hosted — `src/styles/globals.css`, `index.html`

Add and import three packages: `@fontsource/dm-serif-display` (display, 400 only),
`@fontsource-variable/plus-jakarta-sans` (interface), `@fontsource-variable/jetbrains-mono`
(data).

Delete the Google Fonts `<link>` and both `preconnect` tags. They are the app's only
third-party network dependency, and P4's position (POST-V1 item 9) is that a page rendering
untrusted LLM output should not have one.

**Fix the latent bug while you are here.** `body` sets `font-family: Poppins`, but no
`--font-*` token exists in `@theme`, so Tailwind's `font-sans` utility still resolves to the
default stack — any element using `font-sans` silently drops the brand face. Define
`--font-sans`, `--font-serif` and `--font-mono` in `@theme`, and drive `body` from them.

### 3. The token rewrite — `src/styles/globals.css`

Replace the palette. Neutrals are **chroma 0 in both themes** — no tint toward the accent.

```
--radius 0.375rem   (from 0.625rem)

light   --background oklch(1 0 0)            --foreground oklch(0.145 0 0)
        --muted-foreground oklch(0.556 0 0)  --border oklch(0.9 0 0)
dark    --background oklch(0.13 0 0)         --card oklch(0.175 0 0)
        --foreground oklch(0.98 0 0)         --border oklch(0.275 0 0)

--primary            oklch(0.922 0.181 122.5) light / oklch(0.9 0.19 122.5) dark
--primary-foreground oklch(0.145 0 0)         both themes
--ring               oklch(0.145 0 0) light  / oklch(0.9 0.19 122.5) dark
```

`#D0F861` is `oklch(0.922 0.181 122.5)` — lightness 0.92, near-white. **It can never be text
or a thin stroke, only a field with ink on top.** That is the whole system, and it is why
`--ring` differs by theme: the accent is invisible against white, so the light focus ring is
ink.

**`--primary` is now near-white, so this is not a drop-in.** Grep `text-primary`,
`border-primary`, `ring-primary` and `bg-primary` across `src/` before assuming otherwise.
Anything using the primary as a foreground is now illegible and moves to `--foreground`.

### 4. The grade ramp — `src/styles/globals.css`, `src/features/practice/RatingButtons.tsx`

```
--grade-again oklch(0.6 0.21 25)     --grade-hard oklch(0.72 0.16 55)
--grade-good  oklch(0.82 0.16 92)    --grade-easy oklch(0.92 0.18 122.5)
```

Four unrelated hues become one sweep from alarm to the accent, because nothing binds them and
rating Easy is what the product exists to produce. Lightness climbs in even steps
(0.60 → 0.72 → 0.82 → 0.92), so the four stay separable with no colour vision at all — a
red-to-green sweep is the exact axis deuteranopia flattens, so value carries the information
and hue is the reward.

`RatingButtons.tsx` uses `variant="destructive"` for Again and `outline` for the other three;
it ignores the `--grade-*` tokens entirely, while `ForecastChart.tsx` and
`StateDistribution.tsx` use them. The comment in `globals.css` says these must mean the same
thing in both places, and today they do not. Wire the buttons to the ramp as filled fields
with ink labels. Keep the `<kbd>` 1–4 hints and the interval text.

### 5. FOUC — `index.html`

`theme.tsx` applies the `dark` class in an effect, so a dark-mode user gets a white flash on
every cold load. That was survivable against `oklch(0.145 0 0)`; against a near-pure-black
ground it is a strobe. Add an inline script in `<head>` that reads the same localStorage key
and sets the class before first paint.

It duplicates a constant, which is a real cost — so name it in a comment on both sides.

### 6. The mark as a component — `src/components/Logo.tsx`

`<LogoMark />` and `<LogoLockup />` as inline SVG. Two plates in `currentColor`, and the node
bridging the cleft in `var(--color-primary)`: the accent _is_ the signal crossing the gap,
which is both the right meaning and the only assignment that survives a white background.

Inline, so it themes for free, costs no request, and needs no dark-mode variant shipped. Use
it in `AppLayout`, `AuthPages`, `NotFoundPage` and `ErrorBoundary`.

### 7. Masters and the asset pipeline — `assets/brand/`, `scripts/build-brand-assets.mjs`

Hand-author the masters under `assets/brand/` (source, never shipped): `mark.svg`,
`mark-16.svg`, `lockup.svg`, `og.svg`. `mark-16.svg` is a separate drawing, not a resize — at
16 px the stagger dies first, so the plates thicken, the node is dropped, and the accent moves
onto the right plate to carry the idea.

Then `scripts/build-brand-assets.mjs`, wired as `npm run brand:assets`, rendering with
`@resvg/resvg-js` fed the actual font files out of `node_modules/@fontsource*`. Passing
`fontFiles` explicitly is the point: text rendered through system fontconfig produces a social
card that differs between a laptop and CI, and nobody notices until someone shares the link.

Committed to `public/`: `favicon.svg` (internal `prefers-color-scheme` swap), `favicon.ico`
(16/32/48), `apple-touch-icon.png` (180, opaque tile), `icon-192.png`, `icon-512.png`,
`icon-512-maskable.png` (80% safe zone — a separate crop), `og-image.png` (1200×630),
`og-image-square.png` (1200×1200), `logo-mark.svg`, `logo-lockup.svg`, plus `site.webmanifest`
and `robots.txt`.

Committing the outputs means the deploy never needs the toolchain, which is how
`logo-light.png` already works. Delete `logo-light.png`.

### 8. Head metadata — `index.html`

Icon links, `og:*`, `twitter:card`, canonical, and two `theme-color` metas media-queried for
light and dark. One public route and a static `index.html` is the whole SEO surface; no
per-route meta machinery.

### 9. UI primitives — `src/components/ui/*`

A radius, border and focus-ring pass across the ten existing primitives. `button.tsx`'s
`default` variant becomes the accent field with an ink label. Nothing new.

### 10. Tests

See the table below.

### 11. Write `docs/plans/P6-surface.md`

The repo rule. Author it against the codebase P5 actually left behind, not against this file.

## Acceptance criteria

- `npm run typecheck && npm run lint && npm test && npm run build` green.
- `npm run brand:assets` twice in a row leaves `git status --porcelain public/` empty.
- No occurrence of `Flashcards` as a product name in `src/`, `index.html` or `package.json`.
- Grepping `src/` for hex colours and `rgb(` / `hsl(` returns nothing: every colour still goes
  through a token.
- A practice screen in either theme has colour in exactly one place — the grade buttons.
- A cold load in dark mode over a throttled connection shows no white flash.
- The `dist/` eager bundle stays within a few kB of 781.31 kB raw; fonts arrive as separate
  assets.

## Tests to write

| Test                                                                                | Failure it catches                                                                      |
| ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------- |
| Token parity: every custom property declared in `:root` is also declared in `.dark` | A half-finished theme that renders one theme's text on the other theme's ground         |
| Every neutral token parses to chroma 0                                              | A tint creeping back into the greys, which is the one thing this palette is not         |
| Grade-ramp lightness strictly increases again → hard → good → easy                  | Someone "fixing" a grade colour and destroying greyscale separability without seeing it |
| `RatingButtons` renders a distinct `--grade-*` token per button                     | Exactly the regression that exists today, reintroduced                                  |
| Every icon path in `index.html` and `site.webmanifest` exists in `public/`          | A rename that silently 404s the favicon, which no other test would notice               |

SPEC §10 says styling and animation are explicitly not tested, and these do not test either —
they assert _contracts_ about the token file that a human cannot re-check on every edit.

## Decisions to record

Into `SPEC.md`: the name, in the h1 and §1; the three font packages and two asset devDeps in
the §8.1 stack table; **P5 / P6 / P7** rows in the §11 phasing table, and a ✅ on P4, whose row
still lacks one; and into §12 — the accent with its never-as-text rule, the type pairing, and
the grade ramp with the greyscale argument.

Into `docs/plans/README.md`: three board rows.

Into `docs/plans/POST-V1.md`: delete _"A redesign. The product's look is settled."_ from the
"explicitly not on this list" section, and record where it was reversed. Leave the identical
line in `P4-ship.md` alone — it correctly describes P4's scope, and a completed plan is a
record rather than a live document.
