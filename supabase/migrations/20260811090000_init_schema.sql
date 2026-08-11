-- Initial schema: decks, cards, reviews, generations, profiles.
-- Implements SPEC.md §5.1–§5.6. RLS is applied in a separate migration so that
-- policy changes are reviewable on their own.

-- ---------------------------------------------------------------------------
-- Enums (§5.1)
-- ---------------------------------------------------------------------------
create type public.card_kind   as enum ('basic', 'cloze', 'mcq');
create type public.card_status as enum ('draft', 'active', 'suspended', 'archived');
create type public.fsrs_state  as enum ('new', 'learning', 'review', 'relearning');
create type public.deck_status as enum ('generating', 'draft', 'active', 'failed');
create type public.gen_source  as enum ('text', 'document', 'manual');

-- ---------------------------------------------------------------------------
-- updated_at trigger helper
-- ---------------------------------------------------------------------------
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------------
-- profiles (§5.6)
-- ---------------------------------------------------------------------------
create table public.profiles (
  id uuid primary key references auth.users on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 100),
  -- Streaks and the review heatmap are computed against this zone. Computing them
  -- in UTC silently breaks streaks for most of the world.
  timezone text not null default 'UTC',
  daily_new_limit int not null default 20 check (daily_new_limit between 0 and 500),
  -- null = use the ts-fsrs defaults; populated later by the optimiser (post-v1).
  fsrs_params jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute function public.touch_updated_at();

-- Every auth user gets a profile row; the app never has to cope with its absence.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, display_name)
  values (new.id, nullif(new.raw_user_meta_data ->> 'display_name', ''))
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- decks (§5.2)
-- ---------------------------------------------------------------------------
create table public.decks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  title text not null check (char_length(title) between 1 and 200),
  description text check (description is null or char_length(description) <= 2000),
  status public.deck_status not null default 'active',
  source public.gen_source not null default 'manual',
  new_cards_per_day int not null default 20 check (new_cards_per_day between 0 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index decks_user_updated_idx on public.decks (user_id, updated_at desc);

create trigger decks_touch_updated_at
  before update on public.decks
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- cards (§5.3)
-- Content varies by kind; scheduling state does not. The scheduler touches only
-- the scheduling columns and never reads `payload`.
-- ---------------------------------------------------------------------------
create table public.cards (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  deck_id uuid not null references public.decks on delete cascade,

  kind public.card_kind not null,
  payload jsonb not null,

  status public.card_status not null default 'active',

  -- Which slice of the source text produced this card; shown in the review gate.
  source_excerpt text check (source_excerpt is null or char_length(source_excerpt) <= 2000),

  -- FSRS state
  fsrs_state public.fsrs_state not null default 'new',
  stability double precision check (stability is null or stability > 0),
  difficulty double precision check (difficulty is null or (difficulty >= 1 and difficulty <= 10)),
  due timestamptz not null default now(),
  last_review timestamptz,
  reps int not null default 0 check (reps >= 0),
  lapses int not null default 0 check (lapses >= 0),
  scheduled_days int not null default 0 check (scheduled_days >= 0),
  elapsed_days int not null default 0 check (elapsed_days >= 0),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Cheap structural guard only. Zod (src/lib/schemas.ts) does the real validation
  -- at the app boundary; this exists so a bad direct INSERT cannot land garbage.
  constraint cards_payload_shape check (
    case kind
      when 'basic' then payload ? 'front' and payload ? 'back'
      when 'cloze' then payload ? 'text'
      when 'mcq'   then payload ? 'stem' and payload ? 'options'
    end
  ),
  -- A reviewed card must carry FSRS state; a new one must not pretend to.
  constraint cards_state_consistency check (
    (fsrs_state = 'new' and last_review is null)
    or (fsrs_state <> 'new' and stability is not null and difficulty is not null)
  )
);

-- The practice-queue query (§10 perf budget). Partial index: only active cards
-- are ever queued, and they are a small fraction of the table over time.
create index cards_queue_idx on public.cards (user_id, due)
  where status = 'active';
create index cards_deck_status_idx on public.cards (deck_id, status);
create index cards_deck_due_idx on public.cards (deck_id, due)
  where status = 'active';

create trigger cards_touch_updated_at
  before update on public.cards
  for each row execute function public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- reviews (§5.4) — append-only
-- ---------------------------------------------------------------------------
create table public.reviews (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  card_id uuid not null references public.cards on delete cascade,

  rating smallint not null check (rating between 1 and 4),  -- 1 Again .. 4 Easy
  reviewed_at timestamptz not null default now(),
  duration_ms int check (duration_ms is null or duration_ms >= 0),

  -- State BEFORE this review. Undo restores from here, and an FSRS parameter
  -- optimiser needs it to replay history.
  state_before public.fsrs_state not null,
  stability_before double precision,
  difficulty_before double precision,
  elapsed_days int not null,
  scheduled_days int not null,

  -- State AFTER.
  state_after public.fsrs_state not null,
  stability_after double precision,
  difficulty_after double precision
);

create index reviews_user_time_idx on public.reviews (user_id, reviewed_at desc);
create index reviews_card_time_idx on public.reviews (card_id, reviewed_at desc);

-- ---------------------------------------------------------------------------
-- generations (§5.5) — audit trail and the quota source of truth
-- ---------------------------------------------------------------------------
create table public.generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users on delete cascade,
  deck_id uuid references public.decks on delete set null,
  source public.gen_source not null,
  model text not null,
  prompt_version text,
  input_chars int not null check (input_chars >= 0),
  input_tokens int,
  output_tokens int,
  cards_requested int not null check (cards_requested > 0),
  cards_returned int not null default 0 check (cards_returned >= 0),
  cards_accepted int check (cards_accepted is null or cards_accepted >= 0),
  cost_usd numeric(10, 6),
  status text not null default 'running'
    check (status in ('running', 'succeeded', 'failed', 'refused')),
  error text,
  created_at timestamptz not null default now(),
  finished_at timestamptz
);

-- Quota is counted from this table, so the count must be cheap.
create index generations_user_time_idx on public.generations (user_id, created_at desc);
