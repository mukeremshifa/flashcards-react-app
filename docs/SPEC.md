# Flashcards + LLM — Product & Technical Specification

**Status:** v1 · **Owner:** Mukerem Shifa · **Spec'd** 2026-08-11 · **Last revised** 2026-08-12

Phase progress and per-phase execution plans live in [plans/](plans/).

A centralised flashcards app that uses an LLM to generate cards from text (and later
documents), then drills them with real spaced repetition and honest progress tracking.

---

## 1. Product intent

**One-line:** Paste what you're studying, get good flashcards, and get drilled on them at
the right time.

**Why this project exists (secondary but real):** it is the bridge between an existing React
frontend skillset and existing LLM experience. Design decisions therefore favour
_learning-valuable_ over _shortest-path_, but never at the cost of shipping.

**The bet:** the hard part of flashcards is not the flip animation — it is (a) generating
cards that are actually worth reviewing, and (b) scheduling them so review effort converts
into retention. Everything in v1 serves those two things.

### Non-goals for v1

- OCR / scanned documents / handwriting.
- Public deck marketplace or social features.
- Mobile apps (responsive web only).
- Note generation, summaries, or open-ended tutoring ("study buddy" is post-v1).
- Collaborative editing.

---

## 2. Decisions locked

| Axis          | Decision                                               | Consequence                                                  |
| ------------- | ------------------------------------------------------ | ------------------------------------------------------------ |
| Backend       | **Supabase** — Postgres + Auth + RLS + Edge Functions  | One service; provider key never touches the browser          |
| v1 slice      | **Paste text → generate → review gate → SRS practice** | Documents deferred to Phase 2                                |
| Scheduler     | **FSRS** (via `ts-fsrs`)                               | Requires a per-review log table from day one                 |
| Language      | **TypeScript** (migrate; strict-ish) + **Zod**         | Shared schemas across LLM parse / DB / forms                 |
| Card types    | **basic + cloze + MCQ** (discriminated union)          | Content varies by type; scheduling state does not            |
| LLM provider  | **Groq, free tier** (OpenAI-compatible API)            | $0 marginal cost; rate limits replace cost as the constraint |
| Generation UX | **Streaming** — cards appear one at a time             | SSE from Edge Function; NDJSON on the wire                   |
| Tenancy       | **Open signup, private decks**                         | Needs RLS + per-user generation quota + rate limit           |
| Styling       | **Tailwind v4 + shadcn/ui**                            | Existing `src/ui/*` styled-components are replaced           |

### Honest scope note

Those eight choices together are more than one sprint. The phasing in §11 exists so there is
a usable app at the end of Phase 1 rather than eight half-built layers. If schedule pressure
appears, cut in this order: MCQ type → streaming (fall back to batch + skeletons) → progress
dashboard depth. Do **not** cut the review gate or the review log.

---

## 3. Users

- **Primary (P0):** self-directed learner studying from text they already have — lecture
  notes, articles, textbook passages. Wants cards without typing them.
- **Secondary (P1):** anyone landing from a portfolio link. Needs a seeded demo account so
  the app is not an empty shell on first load.

Not designed for: teachers assigning decks to classes; teams sharing decks.

---

## 4. Core flows

### 4.1 Generate (the flagship flow)

1. User pastes text (100 – 20,000 chars) into `/create/text`.
2. Chooses: number of cards (3–50), allowed card types, difficulty/depth, deck title
   (auto-suggested from the text).
3. Client shows an estimated size (characters, plus an approximate token figure) and
   remaining monthly quota before submitting. The estimate is advisory; the Edge
   Function enforces the real limits (§7.5).
4. Submit → Edge Function streams cards back. Each card appears in a **staging list** as it
   arrives, with skeleton rows for the ones still coming.
5. **Review gate:** user edits, rejects, or accepts individual cards. Bulk accept-all.
6. Accept → cards move from `draft` to `active` and enter the FSRS `new` queue.

**Why a review gate:** LLM-generated cards are ~80% good. Reviewing a bad card for months is
worse than not having it. The gate is the single highest-leverage quality feature in the
product, and it is cheap to build.

**Draft persistence:** drafts are written to the DB server-side as they stream (status
`draft`), not held only in React state. A refresh mid-generation must not burn a paid
generation. Rejecting deletes the row; abandoning leaves a resumable draft deck.

### 4.2 Practice

1. `/practice/:deckId`, or `/practice` for the all-decks due queue.
2. Queue = cards where `due <= now()`, ordered by due, with new cards interleaved subject to
   a per-day new-card cap (default 20).
3. Show front → user self-reveals → rates **Again / Hard / Good / Easy** (FSRS's 4 grades).
4. Each rating writes a `reviews` row and updates the card's FSRS state in one transaction.
5. Session summary: count reviewed, rating breakdown, next-due forecast.

Keyboard-first: `Space` reveal, `1`–`4` rate, `E` edit, `U` undo last.

**Undo** is required, not a nicety — mis-hitting `1` on a mature card damages its schedule.
Undo restores the pre-review FSRS snapshot from the `reviews` row, which is why that row
stores state _before_ as well as after.

### 4.3 Manage

- `/decks` — list, search, card counts, due counts, per-deck stats.
- `/decks/:id` — card table with inline edit, type filter, bulk delete, manual add.
- Manual card creation must exist for every card type. The LLM is an accelerator, not the
  only input path.

### 4.4 Progress

`/progress` — real data only, no invented XP:

- Reviews-per-day heatmap (365 days).
- Current and longest streak (a day counts with ≥1 review).
- Retention: % of reviews graded ≥ Hard, windowed 7/30/90 days, split by card state.
- Due forecast: next 30 days, stacked bar.
- Card state distribution: new / learning / review / relearning.
- Mean stability and difficulty, and their trend.

---

## 5. Data model

Postgres on Supabase. Every table has `id uuid default gen_random_uuid()`, `created_at`,
`updated_at`, and `user_id uuid references auth.users not null`. RLS on **every** table.

### 5.1 Enums

```sql
create type card_kind   as enum ('basic', 'cloze', 'mcq');
create type card_status as enum ('draft', 'active', 'suspended', 'archived');
create type fsrs_state  as enum ('new', 'learning', 'review', 'relearning');
create type deck_status as enum ('generating', 'draft', 'active', 'failed');
create type gen_source  as enum ('text', 'document', 'manual');
```

### 5.2 `decks`

```sql
create table decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text,
  status deck_status not null default 'active',
  source gen_source not null default 'manual',
  new_cards_per_day int not null default 20 check (new_cards_per_day between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on decks (user_id, updated_at desc);
```

`new_cards_per_day` is **not read in v1.** The daily cap is one number per account
(`profiles.daily_new_limit`), because a per-deck cap on top of an account cap needs a rule
for how the two interact, and no such rule is obvious enough to guess at. The column stays
for when there is a reason to answer that question.

### 5.3 `cards` — content plus scheduling state

The key structural decision: **content varies by card type; scheduling state does not.** The
FSRS scheduler reads and writes only the scheduling columns and never inspects `payload`.
That keeps the scheduler type-agnostic forever, so adding a fourth card type later touches
rendering and validation but not scheduling.

```sql
create table cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  deck_id uuid not null references decks on delete cascade,

  -- content (discriminated union; shape validated by Zod at every boundary)
  kind    card_kind not null,
  payload jsonb     not null,

  status card_status not null default 'active',

  -- provenance: which chunk of source text produced this card
  source_excerpt text,

  -- FSRS scheduling state
  fsrs_state     fsrs_state       not null default 'new',
  stability      double precision,
  difficulty     double precision,
  due            timestamptz      not null default now(),
  last_review    timestamptz,
  reps           int              not null default 0,
  lapses         int              not null default 0,
  scheduled_days int              not null default 0,
  elapsed_days   int              not null default 0,
  learning_steps int              not null default 0,  -- which (re)learning step

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- cheap structural guard; Zod does the real validation
  constraint payload_shape check (
    case kind
      when 'basic' then payload ? 'front' and payload ? 'back'
      when 'cloze' then payload ? 'text'
      when 'mcq'   then payload ? 'stem'  and payload ? 'options'
    end
  )
);

-- the queue query; make it fast
create index on cards (user_id, status, due) where status = 'active';
create index on cards (deck_id, status);
```

**Payload shapes (Zod, shared between client and Edge Function):**

```ts
const Basic = z.object({
  kind: z.literal('basic'),
  front: z.string().min(1).max(1000),
  back: z.string().min(1).max(2000),
});

// Anki-style cloze markers: "The mitochondrion is the {{c1::powerhouse}} of the cell."
const Cloze = z.object({
  kind: z.literal('cloze'),
  text: z
    .string()
    .min(1)
    .max(2000)
    .regex(/\{\{c\d+::[^}]+\}\}/),
  hint: z.string().max(200).optional(),
});

const Mcq = z.object({
  kind: z.literal('mcq'),
  stem: z.string().min(1).max(1000),
  options: z
    .array(z.object({ text: z.string().min(1).max(500), correct: z.boolean() }))
    .min(3)
    .max(5)
    .refine(o => o.filter(x => x.correct).length === 1, 'exactly one correct option'),
  explanation: z.string().max(1000).optional(),
});

export const CardPayload = z.discriminatedUnion('kind', [Basic, Cloze, Mcq]);
```

> **Cloze caveat:** one cloze _note_ containing `{{c1}}` and `{{c2}}` conventionally becomes
> two scheduled cards. v1 simplification: **one cloze marker group per card row**. If the
> model emits multiple groups, split into separate rows at ingest. This avoids a note-vs-card
> distinction that would complicate the schema for little v1 benefit — revisit if it bites.

### 5.4 `reviews` — append-only log

This table is the reason FSRS was chosen. It powers scheduling, every progress metric,
undo, and any future FSRS parameter optimisation.

It is append-only, with exactly one exception: `undo_last_review` sets `undone_at`. A
narrow UPDATE policy plus a trigger make that the only column any update may touch, and it
may be set once — so the log body is immutable by mechanism rather than by convention.

The `*_before` columns hold the **complete** pre-review snapshot, which is what makes undo
exact. Storing only state, stability and difficulty (as first drafted) leaves `due` and the
learning-step index unrecoverable, and an undo that restores the interval but not the
memory state looks correct while quietly damaging the schedule.

```sql
create table reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  card_id uuid not null references cards on delete cascade,

  rating      smallint    not null check (rating between 1 and 4), -- 1 Again .. 4 Easy
  reviewed_at timestamptz not null default now(),
  duration_ms int,

  -- FSRS state BEFORE this review (enables undo + offline optimiser)
  state_before          fsrs_state       not null,
  stability_before      double precision,
  difficulty_before     double precision,
  due_before            timestamptz not null,
  last_review_before    timestamptz,
  elapsed_days_before   int not null default 0,
  learning_steps_before int not null default 0,
  elapsed_days      int not null,   -- days that passed before THIS review
  scheduled_days    int not null,   -- the interval the card carried into it

  -- state AFTER
  state_after      fsrs_state       not null,
  stability_after  double precision,
  difficulty_after double precision,

  -- Set when the user undid this rating. The row is never deleted: an undone
  -- rating is real history, and the optimiser decides for itself whether to use
  -- it. P3's retention math excludes rows where this is set.
  undone_at timestamptz
);
create index on reviews (user_id, reviewed_at desc);
create index on reviews (card_id, reviewed_at desc);
```

### 5.5 `generations` — audit and quota source of truth

```sql
create table generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  deck_id uuid references decks on delete set null,
  source gen_source not null,
  model text not null,
  input_chars int not null,
  input_tokens int,
  output_tokens int,
  cards_requested int not null,
  cards_returned int not null default 0,
  cards_accepted int,
  cost_usd numeric(10,6),
  status text not null default 'running',  -- running | succeeded | failed | refused
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);
create index on generations (user_id, created_at desc);
```

Quota is **counted from this table**, not tracked in a mutable counter — no drift, and it
doubles as the cost dashboard.

### 5.6 `profiles`

```sql
create table profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text,
  timezone text not null default 'UTC',  -- day boundaries for streaks/heatmap
  daily_new_limit int not null default 20,
  fsrs_params jsonb,                     -- null = library defaults
  created_at timestamptz not null default now()
);
```

Created by a trigger on `auth.users` insert. `timezone` matters: a streak computed in UTC is
wrong for most users and produces "broken streak" bug reports.

### 5.7 RLS

Uniform policy per table — one rule, no exceptions:

```sql
alter table decks enable row level security;
create policy owner_all on decks
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
```

Repeated for `cards`, `reviews`, `generations`, and `profiles` (`auth.uid() = id`).
`reviews` is the one narrowing: SELECT and INSERT as usual, no DELETE at all, and an UPDATE
policy that a trigger restricts to the `undone_at` tombstone.

The Edge Function calls Supabase **with the caller's JWT**, not the service role key, so RLS
applies to generated inserts too. The service role key is not used in v1 at all — if a future
job needs it, it stays server-side and writes an explicit `user_id`.

---

## 6. Scheduling (FSRS)

**Library:** `ts-fsrs` — TypeScript-native, implements current FSRS, and its review-log shape
matches §5.4. Hand-rolling FSRS is a fun weekend and a long-term liability; SM-2 was rejected
for worse scheduling at similar effort.

**Where it runs:** client-side on rating, wrapped in a single Postgres RPC that inserts the
`reviews` row and updates `cards` atomically. Reason for one RPC: a partial write (review
logged but card not rescheduled, or the reverse) silently corrupts a user's schedule and
stays invisible until much later.

```sql
create function review_card(p_card_id uuid, p_rating smallint, p_duration_ms int,
                            p_expected_updated_at timestamptz, p_next jsonb)
  returns cards ...
-- Locks the card, inserts the reviews row from its current state, then applies p_next.
-- security invoker so RLS applies. Raises PT409 if the card's updated_at has moved
-- (two tabs), PT404 if the card is not the caller's, and validates every p_next key
-- explicitly — RLS checks who you are, never what you sent.

create function undo_last_review(p_card_id uuid) returns cards ...
-- Restores the newest non-undone review's *_before snapshot onto the card and
-- tombstones that review. Also security invoker.
```

Design points:

- **Day boundary** = 04:00 in the user's `profiles.timezone` — standard SRS convention, so
  late-night studying belongs to the previous day.
- **New-card interleaving:** due reviews first; new cards mixed in up to the daily cap.
  Reviews are never starved by new cards.
- **Suspend/bury:** `status = 'suspended'` removes a card from queues without deleting it.
- **Fuzz** enabled (a `ts-fsrs` option) so cards created together do not clump forever.
  ts-fsrs seeds it from the card, so the same card previewed twice gives the same answer —
  which is what lets the rating buttons promise "Good → 4d" and then honour it.
- **Short-term (re)learning steps** stay enabled — the library default. That requires
  persisting `cards.learning_steps`: without it every learning card restarts at step 0 on
  each review, so a card rated Good repeatedly loops on the 10-minute step and never
  graduates. The alternative, `enable_short_term: false`, was rejected because it retires
  the `learning` and `relearning` states entirely, and §4.4 reports a distribution over all
  four.
- **Lapses** count every `Again`. ts-fsrs counts one only from the `review` state; the
  simpler rule is the app's, enforced in `review_card`, and `lapses` is a display counter
  that the FSRS model never reads. What matters is that it is counted in exactly one place.
- **Parameter optimisation** is post-v1, but the log makes it possible without migration. It
  needs roughly 1,000 reviews to be meaningful, so expect to enable it months in.

---

## 7. Generation pipeline

### 7.1 Shape

```
Browser  ──POST /functions/v1/generate-cards (JWT)──▶  Supabase Edge Function (Deno)
                                                        │ 1 authenticate (JWT → user)
                                                        │ 2 validate input (Zod)
                                                        │ 3 quota + rate-limit check
                                                        │ 4 char-budget check → hard ceiling
                                                        │ 5 insert decks(status=generating)
                                                        │      + generations(status=running)
                                                        │ 6 Groq streaming call (SSE)
   ◀──text/event-stream (one event per card)──────────  │ 7 per card: Zod → insert draft
                                                        │            → emit SSE event
                                                        │ 8 finalise generations row
```

### 7.2 Provider, model, and parameters

**Provider: Groq, free tier.** Groq exposes an OpenAI-compatible REST API, so the Edge
Function talks to it over plain `fetch` (no SDK needed for one streaming endpoint) or via
the `openai` package with `baseURL` overridden.

```ts
// supabase/functions/generate-cards/index.ts  (Deno)
const GROQ_URL = 'https://api.groq.com/openai/v1/chat/completions';

const response = await fetch(GROQ_URL, {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${Deno.env.get('GROQ_API_KEY')}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    model: Deno.env.get('GENERATION_MODEL'), // pinned at deploy, not hardcoded
    stream: true,
    stream_options: { include_usage: true }, // usage arrives in the final chunk
    temperature: 0.4, // low: card writing wants consistency, not flair
    max_tokens: 4096,
    messages: [
      { role: 'system', content: CARD_SYSTEM_PROMPT },
      { role: 'user', content: buildUserTurn(params) },
    ],
  }),
  signal: AbortSignal.timeout(60_000),
});
```

**The model is a deploy-time env var, not a literal.** Groq's free-tier roster and its
per-model rate limits change often enough that hardcoding a name here would be stale
before P2 ships. The P2 task is: read the current model list and free-tier limits from
Groq's own console/docs, pick the strongest instruction-following model that supports
JSON-mode output, pin it in `GENERATION_MODEL`, and record the choice with a date in the
P2 plan. Every `generations` row already stores `model`, so a later switch is auditable.

Notes that matter and are easy to get wrong:

- **No provider-side token counting.** Groq has no `count_tokens` endpoint, so the
  pre-flight ceiling in §7.5 is enforced on **characters**, with a conservative
  chars-per-token divisor for the _display_ estimate only. Never present the estimate as
  exact, and never let it be the thing that enforces the limit.
- **No Anthropic-style prompt caching.** Do not design around a cached system-prefix
  discount. Keep the system prompt stable anyway — it makes output consistent and makes
  regressions attributable to the prompt version — but budget as if every request pays
  full input cost.
- **`temperature` and `top_p` are available and useful here** (unlike the Claude models
  originally specced). Start low (~0.3–0.5): high temperature on a strict NDJSON contract
  buys nothing but malformed lines.
- **JSON mode is a belt, not a substitute for Zod.** If the pinned model supports
  `response_format: { type: 'json_object' }`, note that it constrains output to a _single_
  JSON object, which conflicts with the NDJSON-per-line contract in §7.3. Either leave
  `response_format` unset and rely on the prompt plus per-line Zod validation, or switch
  that model to batch mode with a `{"cards":[…]}` object. Decide per model at P2; do not
  assume both work at once.
- **Rate limits are the real constraint, not cost.** A free-tier 429 is normal operating
  behaviour, not an exception. Read `retry-after`, surface `rate_limited` to the client
  (§7.3), and never retry a streaming generation silently — the user is watching a
  half-filled staging list.
- **Refusals and truncation.** Check `finish_reason` on the final chunk: `length` means
  the model hit `max_tokens` mid-card and the last NDJSON line must be discarded rather
  than salvaged. A content refusal surfaces as a normal completion whose body is prose
  instead of JSON — zero valid lines with a non-empty response is the signal, and it
  records `status='refused'` on the `generations` row.

> **Provider portability.** Nothing above leaks into the client: the browser only ever
> sees the SSE contract in §7.3. Swapping Groq for another provider later is a change to
> one Edge Function and one env var, which is the main reason the streaming translation
> lives server-side rather than calling the provider from React.

### 7.3 Wire format: NDJSON in, SSE out

The model is instructed to emit **one JSON object per line** (NDJSON), not a single JSON
array. The Edge Function splits on newline, Zod-validates each line, inserts it, and re-emits
it as an SSE event.

**Why NDJSON rather than schema-enforced structured output:** with a streamed JSON _array_,
nothing is validatable until the array closes, so incremental delivery needs a partial JSON
parser and a malformed tail can lose the whole batch. NDJSON makes each line independently
parseable and independently discardable — one bad card is dropped and logged while the other
19 still land. The trade-off is losing `output_config.format` schema enforcement; Zod-per-line
recovers the guarantee at the point it actually matters, before the DB write. If line
adherence proves unreliable in testing, the fallback is
`output_config: { format: { type: 'json_schema', schema } }` in batch mode with skeleton
loaders — a contained change.

**SSE events.** The client uses `fetch` + `ReadableStream`, not `EventSource`: EventSource
cannot send an `Authorization` header or POST a body.

```
event: meta   data: {"deckId":"…","generationId":"…","expected":20}
event: card   data: {"id":"…","kind":"basic","payload":{…},"index":0}
event: card   data: {"id":"…","kind":"cloze","payload":{…},"index":1}
event: warn   data: {"index":7,"reason":"validation_failed"}
event: done   data: {"returned":19,"inputTokens":4102,"outputTokens":1876}
event: error  data: {"code":"quota_exceeded","message":"…"}
```

The client must handle: mid-stream disconnect (the deck is left `generating`; a resume view
reads the drafts already persisted), `warn` (a skipped card), and `error` arriving after some
cards already landed.

### 7.4 Prompt design (system prompt outline)

- Role: write flashcards a serious student would keep.
- **Atomicity** — one fact per card; split compound facts.
- **Answer-independence** — the front must be answerable without seeing sibling cards.
- No trivia extracted from formatting, page numbers, or the author's asides.
- Cloze only where a definition, term, or date sits in a natural sentence.
- MCQ distractors must be plausible and wrong for a _reason_ — no filler options. Expect this
  to be the weakest generated type; the review gate is the mitigation.
- Quote the `source_excerpt` each card came from, so the review gate can show provenance.
- Output contract: one JSON object per line. No prose, no markdown fences, no array wrapper.

Prompt text is version-controlled at `supabase/functions/_shared/prompts/cards.v1.ts`, and
the version string is recorded on each `generations` row so quality regressions are
attributable.

### 7.5 Rate-limit and abuse control

On Groq's free tier the marginal cost of a generation is **$0**, so the thing being
protected is no longer a bill — it is the shared rate limit and the app's own stability.
Reframe accordingly: a single user pasting 50 documents does not cost money, it exhausts
the per-key quota and takes the feature down for everyone.

The `generations.cost_usd` column stays (nullable, left `null` on the free tier) so that
moving to a paid provider later needs no migration.

Controls, all enforced in the Edge Function, never client-side:

1. **Input cap** — 20,000 chars per request, hard-rejected before any API call.
2. **Character ceiling** — `MAX_INPUT_CHARS` (default 32,000) checked before dispatch.
   Groq has no `count_tokens` endpoint, so this is a character budget; the token figure
   shown in the UI is an estimate and is never the enforcement mechanism.
3. **Monthly quota** — default **30 generations per user per month**, counted from
   `generations`. Worst case ≈ $3.60/user/month on Opus 5.
4. **Rate limit** — max 3 generations per 60s, and 1 concurrent per user.
5. **Global kill switch** — `GENERATION_ENABLED` env var, plus a monthly org-wide spend
   ceiling checked before each call.
6. Quota state is returned on every generate response so the UI can show remaining budget
   rather than failing at submit time.

---

## 8. Frontend

### 8.1 Stack

| Concern        | Choice                          | Note                                                |
| -------------- | ------------------------------- | --------------------------------------------------- |
| Build          | Vite (existing)                 | keep                                                |
| Language       | TypeScript                      | migrate `.jsx` → `.tsx` as files are rewritten      |
| Styling        | Tailwind v4 + shadcn/ui         | `@tailwindcss/vite` plugin, `@import "tailwindcss"` |
| Routing        | react-router 7 (existing)       | keep; add a protected-route wrapper                 |
| Server state   | TanStack Query                  | cache, optimistic rating, retries                   |
| Forms          | react-hook-form + `zodResolver` | reuses the §5.3 Zod schemas                         |
| Toasts         | `sonner`                        | replaces `react-hot-toast` (shadcn default)         |
| Charts         | Recharts                        | the heatmap is a hand-rolled CSS grid               |
| Icons          | `lucide-react`                  | replaces `react-icons`                              |
| SRS            | `ts-fsrs`                       |                                                     |
| Backend client | `@supabase/supabase-js`         | replaces `axios` + `json-server`                    |
| Tests          | Vitest + Testing Library        | see §10                                             |

### 8.2 Routes

```
/login  /signup  /auth/callback
/                       → redirect to /dashboard
/dashboard              due today, streak, quick-practice, recent decks
/decks                  deck list
/decks/:id              card table, inline edit, manual add
/create/text            paste → generate (streaming)
/create/review/:deckId  review gate for drafts
/practice               all-decks due queue
/practice/:deckId       single-deck queue
/progress               heatmap, retention, forecast
/settings               daily limits, timezone, model pref, quota usage
/account
*                       404
```

### 8.3 State ownership

- **Server state** (decks, cards, queue, stats) → TanStack Query, keyed `['deck', id]`,
  `['queue', deckId]`, `['stats', window]`.
- **Session-local** (current card index, revealed flag, the staging list during generation) →
  component state or a small reducer. Not Query.
- **Rating is optimistic:** advance the UI immediately; roll back and toast on RPC failure.
  Practice must feel instant or nobody uses it.

### 8.4 Accessibility and input

- Full keyboard path through practice; visible focus rings.
- The flip is a `<button>` with `aria-expanded`, not a div — the answer must be reachable by
  a screen reader, and the card must not become a keyboard trap.
- Respect `prefers-reduced-motion` for the flip animation.
- Cloze blanks announced as "blank" rather than rendered as bare underscores.

---

## 9. Repo reset

### Delete

- `src/ui/*` — all styled-components files (superseded by Tailwind + shadcn).
- `src/GlobalStyles.js`.
- `src/data/data-sample-cards.json` — replaced by a real seed migration.
- `src/features/Create/UseCreateFromText.js` (empty file), `src/pages/Questions.jsx`.
- `src/pages/PracticeCards.jsx` — rewritten. Its data fetching is broken today: it writes to
  a local `var` inside an effect with no dependency array, so it renders nothing.
- Dependencies: `styled-components`, `json-server`, `axios`, `react-icons`,
  `react-hot-toast`.
- The `server` npm script.

### Keep

`vite.config.js`, `eslint.config.js`, `.prettierrc`, `index.html`, `public/logo-light.png`,
`react-router-dom`, `react-hook-form`. The page and route _structure_ is a good starting map
even though the contents are rewritten.

### Target layout

```
src/
  app/            router, providers (Query, auth, theme)
  components/ui/  shadcn primitives
  features/
    auth/  decks/  cards/  generate/  practice/  progress/
  lib/
    supabase.ts  fsrs.ts  schemas.ts  queries.ts  format.ts
  types/          generated Supabase types
supabase/
  migrations/     *.sql
  functions/
    generate-cards/
    _shared/      prompts/, schemas.ts, quota.ts, sse.ts
docs/SPEC.md
```

`src/lib/schemas.ts` is imported by both the client and the Edge Function — one Zod definition
of a card, validated at the LLM boundary, the form boundary, and the DB boundary. This is the
concrete payoff of the TypeScript decision.

---

## 10. Non-functional requirements

**Security**

- `GROQ_API_KEY` lives only in Supabase function secrets: never in client env, never in
  the repo. `.env.local` gitignored; `.env.example` committed.
- Only `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` reach the browser.
  Supabase's modern key system (`sb_publishable_…` / `sb_secret_…`) is used rather than
  the legacy `anon` / `service_role` JWTs, which are deprecated at the end of 2026.
- **The secret key is never used.** It maps to `service_role` (`BYPASSRLS`), so it would
  void every policy in §5.7. `src/lib/env-schema.ts` fails startup if a client env value
  starts with `sb_secret_`, and a test asserts that.
- RLS on every table, verified by a test that queries as user B for user A's rows.
- Card content is rendered as **text, never via `dangerouslySetInnerHTML`** — generated
  content is untrusted input. Markdown support, if added later, needs sanitisation.
- Zod-validate every Edge Function input; never trust a client-sent `user_id`.

**Performance**

- Practice queue fetch under 300ms p95 (indexed per §5.3).
- Rating → next card under 100ms perceived (optimistic update).
- Time-to-first-card in generation under 5s. This is what streaming buys.

**Testing** — thin, but aimed at what breaks silently:

- Unit: the FSRS wrapper (each rating from each state), cloze parser/renderer, Zod schemas
  against real and malformed LLM output, streak and retention math across timezone
  boundaries.
- Integration: RLS isolation; `review_card` RPC atomicity.
- One E2E happy path (Playwright, optional): signup → generate (mocked) → accept → practice →
  rate.
- **Explicitly not tested:** styling, animation.

**Reliability**

- Every generation failure recorded on the `generations` row with a reason.
- An interrupted generation is resumable from persisted drafts.
- No destructive action without confirmation (delete deck, bulk delete cards).

---

## 11. Phasing

| Phase                        | Deliverable                                                                                                                                            | Done when                                                                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| **P0 — Reset** ✅ done       | TS + Tailwind v4 + shadcn scaffold; deletions done; migrations for §5 + RLS, verified against in-process Postgres; route shell                         | ✅ build + typecheck + 38 tests green; RLS isolation test passes                     |
| **P0b — Cloud link** ✅ done | Project linked (`cnlnsaamiujselyuowzx`, eu-west-1, PG 17.6); migrations pushed; types generated; modern publishable/secret key mode                    | ✅ RLS verified live: anonymous reads return `[]`, anonymous insert rejected `42501` |
| **P1 — Core loop** ✅ done   | Auth; deck and card CRUD (all 3 types, manual); FSRS practice + `review_card` RPC; undo; keyboard controls; settings; empty states                     | ✅ 156 tests green; simulated week schedules correctly; undo restores exactly        |
| **P2 — Generation**          | Edge Function; NDJSON→SSE streaming; staging + review gate; `generations` audit; quota + rate limit                                                    | Paste text → 20 cards streamed → accept → practice                                   |
| **P3 — Progress**            | Heatmap, streak, retention, due forecast, state distribution; timezone-correct                                                                         | Dashboard reflects real review history                                               |
| **P4 — Ship**                | Deploy (Vercel + Supabase cloud); demo seed account; empty states; error boundaries; README                                                            | A stranger can sign up and get value                                                 |
| **Post-v1**                  | Documents (txt/md, then PDF text-layer, chunking, background jobs); FSRS parameter optimisation; PWA/offline; shared decks; generated quiz mode; notes | —                                                                                    |

**P1 before P2 is deliberate.** The LLM is the exciting part; the scheduler is the part that
must be right. Building generation on top of an unproven scheduler means debugging both at
once.

---

## 12. Resolved questions

All settled as of 2026-08-12. Kept here as a decision record rather than deleted, so the
reasoning behind each is recoverable later.

| #   | Question                   | Resolution                                                                                                 |
| --- | -------------------------- | ---------------------------------------------------------------------------------------------------------- |
| 1   | Document formats (post-v1) | `.txt`/`.md` first, then PDF text-layer, ≤50 pages                                                         |
| 2   | Model / provider           | **Groq free tier.** Specific model pinned at P2 from Groq's live roster, via `GENERATION_MODEL` — see §7.2 |
| 3   | Deployment target          | Vercel for the SPA, Supabase cloud for the backend                                                         |
| 4   | Timeline                   | None. Phases are ordered, not dated                                                                        |
| 5   | Cloze multi-group          | One deletion group per card; multi-group notes split at ingest (`splitClozeGroups`)                        |
| 6   | Offline / PWA              | Desktop web only for v1                                                                                    |
| 7   | MCQ grading                | Auto-grade into FSRS (correct → Good, wrong → Again), with a manual override                               |

### Still genuinely open

- **Which Groq model.** Deliberately unresolved: the free-tier roster and its rate limits
  move, so this is a P2 task done against Groq's current documentation, not a guess made
  now. Both the model name and the date it was checked get recorded in the P2 plan.
- **Free-tier rate limits.** The concrete requests/min and tokens/min figures that
  `MAX_INPUT_CHARS` and the per-user rate limiter should be tuned against. Same reason,
  same time.

---

## 13. Success criteria for v1

1. A study text becomes 15 or more usable cards in under a minute, with the first card
   visible in under 5 seconds.
2. Fewer than 20% of generated cards are rejected at the review gate.
3. The scheduler is trustworthy enough to use daily for a month without manual correction.
4. Progress numbers are derived entirely from the review log — nothing invented.
5. Monthly LLM spend stays under a set ceiling with no manual intervention.
