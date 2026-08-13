# P6 — Surface

P5 gave the app a palette, three faces, a mark and an asset set. It did not lay anything out.
Every screen still has P1–P4's structure and now wears P5's tokens, which means the app is
consistent but not yet _designed_: card fronts are set in the interface face, the shell is a
wrapping row of nav links with no user menu, the progress cards are a stack of equal-weight
boxes, and the theme toggle cannot get back to `system`. P6 is the per-screen pass.

**Reference:** SPEC.md §4, §8.2, §8.4, §10, §11.
**Done when:** every screen reads as one product, the accent appears at most once per screen,
and the full keyboard path through practice still works.

## Preconditions

```bash
npm run typecheck && npm run lint && npm test && npm run build
```

- **324 tests across 24 files**, all green, on branch `dev`.
- P5 is committed: `src/styles/globals.css` holds the whole token system,
  `src/components/Logo.tsx` exports `LogoMark` / `LogoLockup`, and `npm run brand:assets`
  leaves `public/` unchanged when re-run.
- Baseline: eager bundle **782.16 kB raw / 231.19 kB gzip**. Layout work should not move it;
  if it does by more than a few kB, something imported a module it did not need.

## Out of scope — do not build these here

- **The landing page and every route change.** That is P7, and it is the phase with the risk
  in it: `/` moving out of `ProtectedRoute` breaks `src/app/routes.test.tsx`, which asserts
  `toHaveLength(6)` on lazy imports deliberately. P6 does not touch `routes.tsx`.
- **New colours.** The palette is closed. If a screen seems to need a fifth colour, it needs
  a different layout — the whole point of chroma-0 neutrals is that weight and space do the
  work colour used to.
- **Mobile layouts.** SPEC §12 (6) settled v1 as desktop web. Screens should not _break_
  narrow, but a responsive pass is not this phase.
- **Animation beyond what exists.** The flip stays CSS. No animation library.
- **Splitting `src/lib/queries.ts`** (POST-V1 item 4).

## What already exists, and should be used rather than rebuilt

- `EmptyState` (`src/components/EmptyState.tsx`) is used by nearly every page. Restyle it
  once rather than hand-rolling empty states per screen.
- The ten primitives in `src/components/ui/` already carry P5's radius and a solid 2px
  `focus-visible:ring-ring`. Extend them; do not fork them per feature.
- `RatingButtons.tsx` is the reference implementation for the grade ramp — filled field, ink
  label, mono interval. Charts should read the same tokens.
- `Heatmap.tsx` derives five levels by `color-mix`-ing `--color-primary` toward
  `--color-muted`; it needs no change, only checking that the lightest step is still visible
  on both grounds.

## Tasks

Ordered so the app builds and runs after each.

### 1. The shell — `src/app/AppLayout.tsx`

The nav is `flex flex-wrap gap-1` with six links and a theme button. Give it real structure:
the lockup, primary navigation, and an account control that is not a seventh peer link.

Two specific defects to fix, both noted at P5:

- **The theme toggle is one-way.** `ThemeToggle` flips light↔dark and can never return to
  `system`, even though `theme.tsx` supports all three and keeps a live `matchMedia`
  listener. Make the control expose the state it actually has.
- **The footer says `see docs/SPEC.md`**, which is a link to nothing for anyone who is not
  reading the repository.

### 2. Practice — `PracticeSession`, `CardFace`, `SessionSummary`

The screen the product lives or dies on.

- **Card fronts move to `font-serif`.** A question in DM Serif Display reads as something to
  think about; the same question in the interface face reads as a form label. Answers, hints
  and explanations stay in Plus Jakarta Sans — they are read, not weighed.
- Numbers — position in queue, intervals, stability — go to `font-mono`.
- **Do not touch the flip's mechanics.** SPEC §8.4: it is a `<button>` with `aria-expanded`,
  it must not become a keyboard trap, and `prefers-reduced-motion` is already handled
  globally in `globals.css`. Restyle it; do not reimplement it.
- The keyboard path (`Space`, `1`–`4`, `E`, `U`) is bound on the container, not `document`,
  deliberately — P1 records why. Keep it that way and keep the visible focus ring.

### 3. Generate — `CreateFromTextPage`, `StagingList`, `ReviewGatePage`

The flagship flow, and the one a stranger judges. Three things carry it: the streaming
arrival of cards, the quota/estimate readout, and the gate's accept/reject rhythm. The gate's
`A`/`R`/`E` shortcuts are from P2 — surface them rather than hiding them in a tooltip.

`StagingList` is shared between the streaming view and the gate; it should not grow a second
layout, only a second state.

### 4. Progress — `ProgressPage` and its five cards

Currently five equal-weight boxes. Give the page a hierarchy: the streak and retention are
the answer, the heatmap is the evidence, the forecast and distribution are detail.

`ForecastChart` and `StateDistribution` read `--grade-*` and `--color-primary` — check both
against the ramp now that Easy _is_ the accent, and make sure the legend does not rely on
colour alone (P3 established that rule for the heatmap; it applies here too).

### 5. Decks — `DashboardPage`, `DecksPage`, `DeckDetailPage`, `CardEditor`

The dashboard's four `Stat` cards are the app's front page after sign-in and should carry
the most typographic weight in the product. `DeckDetailPage`'s card table is the densest
screen there is — it wants tabular numerals, a quieter row rhythm, and kind badges that do
not shout.

### 6. Auth and system states — `AuthPages`, `AuthCallbackPage`, `NotFoundPage`, `ErrorBoundary`, `EmptyState`

`AuthPages` and `NotFoundPage` already show the lockup from P5. Finish them: these are the
only screens a signed-out stranger sees until P7 exists, so they are the whole first
impression today.

`ErrorBoundary`'s fallback should look deliberate rather than like a broken page — it is the
one screen whose job is to be reassuring.

### 7. Tests

See the table below.

### 8. Write `docs/plans/P7-landing.md`

The repo rule, and P7 needs more care than most: it is the only phase here that changes the
route table, the bundle's shape, and what an anonymous request can reach.

## Acceptance criteria

- `npm run typecheck && npm run lint && npm test && npm run build` green.
- No hardcoded colour anywhere in `src/`: `grep -rE "#[0-9a-fA-F]{3,8}|rgb\(|hsl\(" src/`
  returns nothing, and neither does a grep for Tailwind palette names
  (`emerald-`, `slate-`, `blue-`, …). P5 removed the last two; they must not come back.
- Every screen in both themes has the accent in at most one place.
- Full keyboard path through a practice session with no mouse, focus visible at every step.
- `npm run brand:assets` still leaves `public/` unchanged.
- Eager bundle within a few kB of 782.16 kB raw.

## Tests to write

| Test                                                                                 | Failure it catches                                                                                   |
| ------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------- |
| No Tailwind palette class (`emerald-500`, `slate-700`, …) appears anywhere in `src/` | The exact regression P5 had to clean up: a screen reaching past the tokens for a colour              |
| Card fronts render inside an element carrying `font-serif`                           | The display face quietly disappearing from the one place in the app it earns its keep                |
| `PracticeSession`'s reveal control is a `<button>` with `aria-expanded`              | A restyle turning the flip into a `<div>` and taking the answer away from screen readers (SPEC §8.4) |
| The theme control can reach all three of light, dark and system                      | Shipping the one-way toggle again                                                                    |
| Progress legends name every series in text, not colour alone                         | A chart that stops carrying information in greyscale — the same rule P3 set for the heatmap          |

## Decisions to record

Into `SPEC.md`: a ✅ on the §11 P6 row, and into §12 anything P6 settles about hierarchy that
a later session would otherwise re-litigate — in particular where the serif is allowed to
appear, since that is the decision most likely to drift.

Into `docs/plans/README.md`: the board row.

**Git, per CLAUDE.md:** commit to `dev`. No merge, no push, no PR, nothing touching `main`.
No migrations are involved, so `db:push` does not enter into this phase.
