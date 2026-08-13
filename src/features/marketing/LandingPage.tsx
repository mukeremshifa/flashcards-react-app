import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { ThemeChoice } from '@/app/ThemeChoice';
import { LogoLockup } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { GradeRampShowcase } from './showcase/GradeRamp';
import { ReviewCardShowcase } from './showcase/ReviewCard';
import { StagingRowsShowcase } from './showcase/StagingRows';

/**
 * The front door (P7).
 *
 * Until now `/` redirected into `/dashboard`, which bounced a signed-out visitor
 * to `/login` — so the entire pitch was a login card, and a stranger could not
 * find out what SynapseDeck is without first creating an account.
 *
 * **This module must not reach the data layer.** Not for size: for behaviour.
 * One `import { useDecks } from '@/lib/queries'` pulls in Supabase and TanStack
 * Query, and the moment a query hook renders, the page starts making requests on
 * behalf of somebody who has no session and has not asked for anything — a
 * marketing page that opens a websocket and 401s in the console is a bad first
 * impression and a slow one. The imports allowed here are `@/components/ui/*`,
 * `@/components/Logo`, `@/app/ThemeChoice`, `react-router-dom`, `lucide-react`
 * and this directory. `LandingPage.test.tsx` asserts that, because it is the
 * kind of rule that erodes through one convenient import at a time.
 *
 * **Its own header and footer, not `AppLayout`.** That shell is the signed-in
 * one: it navigates five authenticated routes and holds the account menu. What
 * it does share is the footer's sentence, because the claim is the same claim.
 * `ThemeChoice` is reused rather than rebuilt — this is the only screen in the
 * app with no account menu to hide the control inside.
 *
 * **The accent is spent once, on "Create account" in the hero**, and nowhere
 * else on the page. `--primary` is oklch(0.922 …) — roughly 1.2:1 against paper
 * — so an accent headline is invisible in the light theme and, in the dark one,
 * spends the whole budget on decoration. Headlines are ink on paper. The grade
 * ramp is exempt because it is a scale rather than an emphasis, and so is the
 * node in the mark (SPEC §12, _Closed at P6_). `src/test/palette.test.ts` will
 * not catch a violation of this — it checks that no literal colour is used, not
 * that a token is used correctly.
 *
 * **The `h1` is not free text.** `public/og-image.png` — the image every shared
 * link renders — is already rasterised with "Forgetting is the schedule." set in
 * the serif. If this heading says something else, the preview and the page
 * disagree and nobody finds out until the link is posted somewhere. Changing it
 * means changing the string in `scripts/build-brand-assets.mjs` and re-running
 * `npm run brand:assets` in the same commit.
 *
 * Two things the copy deliberately does not promise, both checked against
 * reality first: that pasting text will draft cards on *this* deployment
 * (`GROQ_API_KEY` is still unset — see the bottom of `docs/plans/P4-ship.md`),
 * and that any of it works on a phone (SPEC §12 (6): desktop web for v1). Both
 * are said plainly in the footer rather than left for someone to discover.
 */

/** What one review appends to the log. Field names as they exist in `reviews`. */
const REVIEW_LOG_FIELDS = [
  { field: 'grade', meaning: 'Again, Hard, Good or Easy' },
  { field: 'state_before / state_after', meaning: 'where the card sat either side' },
  {
    field: 'stability_before, difficulty_before',
    meaning: 'what the memory model believed about it',
  },
  {
    field: 'elapsed_days',
    meaning: 'how long it had really been, not how long it was meant to be',
  },
  { field: 'duration_ms', meaning: 'how long you looked at it' },
] as const;

function TextLink({ to, children }: { to: string; children: ReactNode }) {
  return (
    <Link
      to={to}
      className="text-foreground focus-visible:ring-ring rounded-sm underline underline-offset-4 outline-none focus-visible:ring-2"
    >
      {children}
    </Link>
  );
}

/**
 * A showcase and the sentence that carries its meaning. The drawing itself is
 * `aria-hidden` — it is an illustration of an interface, not an interface — so
 * this caption is the only version of it assistive technology gets.
 */
function Figure({ caption, children }: { caption: string; children: ReactNode }) {
  return (
    <figure className="space-y-3">
      {children}
      <figcaption className="text-muted-foreground text-sm leading-relaxed">
        {caption}
      </figcaption>
    </figure>
  );
}

export function LandingPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <header className="border-b">
        <div className="mx-auto flex h-16 w-full max-w-6xl items-center gap-3 px-4">
          <Link
            to="/"
            aria-label="SynapseDeck home"
            className="focus-visible:ring-ring mr-auto shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <LogoLockup />
          </Link>

          <ThemeChoice className="mr-2" />
          <Button asChild variant="ghost" size="sm">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild variant="outline" size="sm">
            <Link to="/signup">Create account</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4">
        {/* ---------------------------------------------------------- hero --- */}
        <section className="grid items-center gap-12 py-20 lg:grid-cols-[1.05fr_1fr] lg:gap-16">
          <div className="max-w-xl">
            <h1 className="font-serif text-5xl leading-[1.05] tracking-tight text-balance lg:text-6xl">
              Forgetting is the schedule.
            </h1>

            <p className="text-muted-foreground mt-6 text-lg leading-relaxed">
              Paste what you are studying. SynapseDeck drafts flashcards from it, you
              decide which ones are worth keeping, and a real spaced-repetition scheduler
              decides when you see each one again.
            </p>

            <div className="mt-8 flex flex-wrap items-center gap-4">
              {/* The one accent on this page. */}
              <Button asChild size="lg">
                <Link to="/signup">Create account</Link>
              </Button>
              <span className="text-muted-foreground text-sm">
                Already have one? <TextLink to="/login">Sign in</TextLink>
              </span>
            </div>

            <p className="text-muted-foreground mt-4 text-sm">
              Free, and your decks are private to you.
            </p>
          </div>

          <Figure caption="A card mid-review. Space reveals the answer, 1–4 rate it, and the whole loop is reachable from the keyboard.">
            <ReviewCardShowcase />
          </Figure>
        </section>

        {/* ------------------------------------------- what it does better --- */}
        <section className="border-t py-20">
          <h2 className="text-3xl font-semibold tracking-tight">
            Two things a stack of index cards cannot do
          </h2>

          <div className="mt-14 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-xl">
              <h3 className="text-xl font-semibold">The schedule</h3>
              <p className="text-muted-foreground mt-4 leading-relaxed">
                Every card carries its own stability and difficulty. Rating one is what
                sets the next interval — minutes for something you have just lost, months
                for something solid — so the queue you practise is what is due today
                rather than the deck from the top. The scheduler is FSRS, and the interval
                printed under each rating is the one that card actually gets.
              </p>
            </div>

            <Figure caption="Four ratings, one ramp: red through to the brand green. The same four colours mean the same four things on the buttons and in the charts.">
              <GradeRampShowcase />
            </Figure>
          </div>

          <div className="mt-20 grid items-center gap-10 lg:grid-cols-2 lg:gap-16">
            <Figure caption="The review gate, mid-generation. Cards stream in as they are written; none of them is scheduled until you say so.">
              <StagingRowsShowcase />
            </Figure>

            <div className="max-w-xl lg:order-first">
              <h3 className="text-xl font-semibold">The review gate</h3>
              <p className="text-muted-foreground mt-4 leading-relaxed">
                Drafted cards do not land in a deck. They land in a gate, one row each,
                and stay there until you accept, edit, or throw each one away. A generator
                that writes twenty cards and files all twenty is a generator that fills
                next week with cards you would never have written yourself.
              </p>
              <p className="text-muted-foreground mt-4 leading-relaxed">
                Three kinds of card come out of it — plain question and answer, cloze
                deletions, and multiple choice — and every one of them can be written by
                hand as well.
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- the numbers --- */}
        <section className="border-t py-20">
          <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-xl">
              <h2 className="text-3xl font-semibold tracking-tight">
                Every number is counted, not estimated
              </h2>
              <p className="text-muted-foreground mt-6 leading-relaxed">
                Each rating appends a row to a review log: the grade, the scheduler state
                before it, and the state after. Nothing is overwritten, and an undo leaves
                a tombstone rather than removing the row.
              </p>
              <p className="text-muted-foreground mt-4 leading-relaxed">
                The streak, the heatmap, retention and the due forecast are all read back
                out of that log. If the app cannot count something, it does not show a
                number for it.
              </p>
            </div>

            <div>
              <p className="text-muted-foreground text-xs tracking-wide uppercase">
                What one review writes
              </p>
              <dl className="mt-4 divide-y rounded-lg border">
                {REVIEW_LOG_FIELDS.map(({ field, meaning }) => (
                  <div key={field} className="px-4 py-3">
                    <dt className="font-mono text-sm">{field}</dt>
                    <dd className="text-muted-foreground mt-1 text-sm leading-relaxed">
                      {meaning}
                    </dd>
                  </div>
                ))}
              </dl>
            </div>
          </div>
        </section>

        {/* ------------------------------------------------------- closing --- */}
        <section className="border-t py-20">
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-tight">Start with one deck</h2>
            <p className="text-muted-foreground mt-6 leading-relaxed">
              Create an account and your first deck is a couple of minutes away. Decks and
              cards are private to the account that made them, and that is enforced in the
              database by row-level security rather than by a check in the app that a
              future bug could skip.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-4">
              {/* Outline, not the accent — the hero already spent it. */}
              <Button asChild variant="outline" size="lg">
                <Link to="/signup">Create account</Link>
              </Button>
              <span className="text-muted-foreground text-sm">
                or <TextLink to="/login">sign in</TextLink>
              </span>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t">
        <div className="text-muted-foreground mx-auto w-full max-w-6xl space-y-3 px-4 py-8 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-foreground font-serif text-sm">SynapseDeck</span>
            <span>
              Every number here is counted from your own review log — nothing is
              estimated.
            </span>
          </div>
          {/* The two claims P7 said to check before making them. Neither is true
              yet, so neither is promised above. */}
          <p className="max-w-3xl leading-relaxed">
            Desktop web for now — there is no mobile layout yet. Drafting cards from text
            needs a model provider key configured on the deployment; writing them by hand
            never does.
          </p>
        </div>
      </footer>
    </div>
  );
}
