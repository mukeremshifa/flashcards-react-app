import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Kbd } from '@/components/ui/kbd';

/**
 * A card mid-review, drawn rather than photographed.
 *
 * P7 ruled out screenshots: a PNG of the practice screen goes stale the first
 * time that screen changes, cannot follow the theme, and has to be regenerated
 * by hand forever. So the product is shown with markup — the same tokens, the
 * same type rules, the same shapes as `PracticeSession` — which means it follows
 * light and dark for free and stays sharp at any zoom.
 *
 * **It is a copy of that markup, deliberately, and not an import of it.** The
 * live component reaches TanStack Query, the Supabase client and `ts-fsrs`
 * through its props and hooks; importing it would pull the authenticated data
 * layer onto a page a stranger loads with no session (P7 trap 3). The cost of
 * copying is that this can drift from the real screen. That is the right trade
 * for an illustration: a stale drawing is a cosmetic bug, and a marketing page
 * that 401s in the console is not.
 *
 * Inert on purpose. Every control is a `<div>` wearing a button's classes rather
 * than a `<button>`, and the whole figure is `aria-hidden` — a real button here
 * would be a tab stop that does nothing, and a screen reader reading out "Show
 * answer" on a page with no card is worse than silence. The caption beside it,
 * in `LandingPage`, is what carries the meaning.
 */
export function ReviewCardShowcase() {
  return (
    <div
      aria-hidden
      className="pointer-events-none w-full max-w-xl space-y-5 select-none"
    >
      <div className="text-muted-foreground flex items-center justify-between text-xs">
        <span>
          <span className="text-foreground font-mono tabular-nums">14</span> left ·{' '}
          <span className="font-mono tabular-nums">4</span> done
        </span>
        <Badge variant="outline">Review</Badge>
      </div>

      {/* Ink, not the accent — the same reasoning as the real progress bar. */}
      <div className="bg-muted h-1 overflow-hidden rounded-full">
        <div className="bg-foreground h-full w-[22%] rounded-full" />
      </div>

      <Card className="py-8">
        <CardContent className="space-y-6 px-8">
          {/* A card question: one of the three places the serif is allowed
              (SPEC §12, Closed at P6). */}
          <p className="font-serif text-2xl leading-snug">
            Why does a spaced-repetition scheduler need to know when you last saw a card,
            and not only how many times you have seen it?
          </p>

          <div className="bg-secondary text-secondary-foreground flex h-10 items-center justify-center gap-2 rounded-md text-sm font-medium">
            Show answer <Kbd className="ml-1">Space</Kbd>
          </div>
        </CardContent>
      </Card>

      <p className="text-muted-foreground flex items-center justify-end gap-1.5 text-xs">
        <Kbd>Space</Kbd> reveals · <Kbd>1</Kbd>–<Kbd>4</Kbd> rate
      </p>
    </div>
  );
}
