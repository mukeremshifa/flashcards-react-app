import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';

import { LogoLockup } from '@/components/Logo';
import { Button } from '@/components/ui/button';
import { GradeRampShowcase } from './showcase/GradeRamp';
import { ReviewCardShowcase } from './showcase/ReviewCard';
import { StagingRowsShowcase } from './showcase/StagingRows';

/**
 * The front door (P7, revised after it).
 *
 * Until P7 `/` redirected into `/dashboard`, which bounced a signed-out visitor
 * to `/login` — so the entire pitch was a login card, and a stranger could not
 * find out what SynapseDeck is without first creating an account.
 *
 * **This module must not reach the data layer.** Not for size: for behaviour.
 * One `import { useDecks } from '@/lib/queries'` pulls in Supabase and TanStack
 * Query, and the moment a query hook renders, the page starts making requests on
 * behalf of somebody who has no session and has not asked for anything — a
 * marketing page that opens a websocket and 401s in the console is a bad first
 * impression and a slow one. The imports allowed here are `@/components/ui/*`,
 * `@/components/Logo`, `react-router-dom`, `lucide-react` and this directory.
 * `LandingPage.test.tsx` asserts that, because it is the kind of rule that
 * erodes through one convenient import at a time.
 *
 * **Its own header and footer, not `AppLayout`.** That shell is the signed-in
 * one: it navigates five authenticated routes and holds the account menu.
 *
 * **This is the one responsive screen in the app.** Everything behind the login
 * is still desktop web (SPEC §12 (6)); a landing page is not, because it is a
 * link somebody opens on a phone, from a message, once. Every layout here is
 * written mobile-first and designed down to 360 px: sections stack, the two-up
 * grids only exist from `lg`, and the header sheds the ghost "Sign in" below
 * `sm` because the hero repeats it two lines further down.
 *
 * **No theme control.** Every other screen puts one in the account menu; this
 * page has no account menu, and a three-state radio group in a marketing header
 * is a settings widget shown to somebody who has not decided to use the product
 * yet. A first-time visitor has nothing in `localStorage`, so `ThemeProvider`
 * resolves `system` and the page follows the machine. Somebody who already set
 * light or dark inside the app still gets their choice: the provider is above
 * the router, and this page simply does not offer a way to change it.
 *
 * **The accent is spent twice here, and that is deliberate.** SPEC §12 caps it
 * at once per screen; the exception is recorded there under _Changed after P7_.
 * Both spends are the same button — "Create account" in the header and in the
 * hero — so the rule's actual purpose (one obvious next thing to do) survives:
 * a visitor who scrolls past the hero still has the accent in the sticky-less
 * header above them. Everything else stays ink: `--primary` is oklch(0.922 …),
 * roughly 1.2:1 against paper, so an accent headline is invisible in the light
 * theme. The grade ramp is exempt because it is a scale rather than an emphasis,
 * and so is the node in the mark. `src/test/palette.test.ts` will not catch a
 * violation of this — it checks that no literal colour is used, not that a token
 * is used correctly.
 *
 * **The `h1` is not free text.** `public/og-image.png` — the image every shared
 * link renders — is already rasterised with "Forgetting is the schedule." set in
 * the serif. If this heading says something else, the preview and the page
 * disagree and nobody finds out until the link is posted somewhere. Changing it
 * means changing the string in `scripts/build-brand-assets.mjs` and re-running
 * `npm run brand:assets` in the same commit.
 *
 * **No em dash in anything a visitor reads.** Colons, full stops and commas
 * carry the same joins, and a test asserts the rendered text is free of them.
 * The rule is about copy, not about this comment.
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
 * A footer link. Internal destinations go through the router; an address and a
 * profile on another host cannot, so those are plain anchors. Muted until it is
 * hovered, because a footer of underlined links reads as a warning label.
 */
function FooterLink({ href, children }: { href: string; children: ReactNode }) {
  const className =
    'text-muted-foreground hover:text-foreground focus-visible:ring-ring rounded-sm underline-offset-4 transition-colors outline-none hover:underline focus-visible:ring-2';

  if (href.startsWith('/')) {
    return (
      <Link to={href} className={className}>
        {children}
      </Link>
    );
  }

  return (
    <a
      href={href}
      className={className}
      // mailto: hands off to a mail client; a tab target for it is a blank tab.
      {...(href.startsWith('mailto:')
        ? {}
        : { target: '_blank', rel: 'noreferrer noopener' })}
    >
      {children}
    </a>
  );
}

/** One labelled column of footer links. */
function FooterColumn({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div>
      <p className="text-foreground text-xs tracking-wide uppercase">{title}</p>
      <ul className="mt-3 space-y-2 text-sm">{children}</ul>
    </div>
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
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-2 px-4 sm:h-16 sm:gap-3 sm:px-6">
          <Link
            to="/"
            aria-label="SynapseDeck home"
            className="focus-visible:ring-ring mr-auto shrink-0 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-offset-2"
          >
            <LogoLockup />
          </Link>

          {/* Below sm this is what gives the accent button room; the hero says
              "Already have one? Sign in" two lines further down anyway. */}
          <Button asChild variant="ghost" size="sm" className="hidden sm:inline-flex">
            <Link to="/login">Sign in</Link>
          </Button>
          <Button asChild size="sm">
            <Link to="/signup">Create account</Link>
          </Button>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 sm:px-6">
        {/* ---------------------------------------------------------- hero --- */}
        <section className="grid items-center gap-10 py-14 sm:gap-12 sm:py-16 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:py-20">
          <div className="max-w-xl">
            <h1 className="font-serif text-4xl leading-[1.05] tracking-tight text-balance sm:text-5xl lg:text-6xl">
              Forgetting is the schedule.
            </h1>

            <p className="text-muted-foreground mt-5 leading-relaxed sm:mt-6 sm:text-lg">
              Paste what you are studying. SynapseDeck drafts flashcards from it, you
              decide which ones are worth keeping, and a real spaced-repetition scheduler
              decides when you see each one again.
            </p>

            {/* Stacked below sm, and six units apart above it: the button and the
                sign-in prompt used to sit close enough to read as one control. */}
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
              <Button asChild size="lg" className="w-full sm:w-auto">
                <Link to="/signup">Create account</Link>
              </Button>
              <span className="text-muted-foreground text-sm">
                Already have one? <TextLink to="/login">Sign in</TextLink>
              </span>
            </div>

            <p className="text-muted-foreground mt-6 text-sm">
              Free, and your decks are private to you.
            </p>
          </div>

          <Figure caption="A card mid-review. Space reveals the answer, 1–4 rate it, and the whole loop is reachable from the keyboard.">
            <ReviewCardShowcase />
          </Figure>
        </section>

        {/* ------------------------------------------- what it does better --- */}
        <section className="border-t py-14 sm:py-20">
          <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
            Two things a stack of index cards cannot do
          </h2>

          <div className="mt-10 grid items-center gap-8 sm:mt-14 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-xl">
              <h3 className="text-xl font-semibold">The schedule</h3>
              <p className="text-muted-foreground mt-4 leading-relaxed">
                Every card carries its own stability and difficulty. Rating one is what
                sets the next interval: minutes for something you have just lost, months
                for something solid. The queue you practise is what is due today, not the
                deck from the top. The scheduler is FSRS, and the interval printed under
                each rating is the one that card actually gets.
              </p>
            </div>

            <Figure caption="Four ratings, one ramp: red through to the brand green. The same four colours mean the same four things on the buttons and in the charts.">
              <GradeRampShowcase />
            </Figure>
          </div>

          <div className="mt-14 grid items-center gap-8 sm:mt-20 lg:grid-cols-2 lg:gap-16">
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
                Three kinds of card come out of it: plain question and answer, cloze
                deletions, and multiple choice. Every one of them can be written by hand
                as well.
              </p>
            </div>
          </div>
        </section>

        {/* -------------------------------------------------- the numbers --- */}
        <section className="border-t py-14 sm:py-20">
          <div className="grid gap-8 lg:grid-cols-2 lg:gap-16">
            <div className="max-w-xl">
              <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
                Every number is counted, not estimated
              </h2>
              <p className="text-muted-foreground mt-5 leading-relaxed sm:mt-6">
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
                    <dt className="font-mono text-xs break-words sm:text-sm">{field}</dt>
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
        <section className="border-t py-14 sm:py-20">
          <div className="max-w-2xl">
            <h2 className="text-2xl font-semibold tracking-tight text-balance sm:text-3xl">
              Start with one deck
            </h2>
            <p className="text-muted-foreground mt-5 leading-relaxed sm:mt-6">
              Create an account and your first deck is a couple of minutes away. Decks and
              cards are private to the account that made them, and that is enforced in the
              database by row-level security rather than by a check in the app that a
              future bug could skip.
            </p>
            <div className="mt-8 flex flex-col items-start gap-4 sm:flex-row sm:items-center sm:gap-6">
              {/* Outline: the two accents on this page are both the same button,
                  and a third would make none of them the next thing to do. */}
              <Button asChild variant="outline" size="lg" className="w-full sm:w-auto">
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
        <div className="mx-auto w-full max-w-6xl px-4 py-10 sm:px-6 sm:py-12">
          <div className="flex flex-col gap-10 sm:flex-row sm:justify-between">
            <div>
              <LogoLockup />
              <p className="text-muted-foreground mt-3 max-w-xs text-sm leading-relaxed">
                Spaced repetition with a real scheduler, and a review log you can read
                back.
              </p>
            </div>

            {/* Stacked below sm: side by side, "github.com/mukeremshifa" is
                wider than half of a 360 px viewport and would wrap mid-link. */}
            <div className="grid gap-8 sm:grid-cols-2 sm:gap-16">
              <FooterColumn title="Product">
                <li>
                  <FooterLink href="/signup">Create account</FooterLink>
                </li>
                <li>
                  <FooterLink href="/login">Sign in</FooterLink>
                </li>
              </FooterColumn>

              <FooterColumn title="Contact">
                <li>
                  <FooterLink href="mailto:mukeemoha@gmail.com">
                    mukeemoha@gmail.com
                  </FooterLink>
                </li>
                <li>
                  <FooterLink href="https://github.com/mukeremshifa">
                    github.com/mukeremshifa
                  </FooterLink>
                </li>
              </FooterColumn>
            </div>
          </div>

          <div className="text-muted-foreground mt-10 flex flex-col gap-2 border-t pt-6 text-xs sm:flex-row sm:items-center sm:justify-between">
            <span>Built by mukeremshifa</span>
            {/* Computed, so the footer cannot be the thing that dates the site. */}
            <span>© {new Date().getFullYear()} SynapseDeck</span>
          </div>
        </div>
      </footer>
    </div>
  );
}
