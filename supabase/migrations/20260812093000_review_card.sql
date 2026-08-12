-- The atomicity guard for rating a card (SPEC §6), plus undo.
--
-- A rating is two writes: append a `reviews` row and reschedule the `cards` row.
-- Done separately from the browser, a dropped connection between them leaves the
-- user with a review that was logged but never applied (or the reverse), and the
-- corruption is invisible until the schedule quietly stops making sense. So both
-- writes happen inside one function, under a row lock.
--
-- Both functions are `security invoker`: RLS is the security boundary (§5.7) and
-- a definer function here would quietly become a way around it.
--
-- Error codes, chosen so the client can tell the cases apart. PostgREST turns a
-- `PTxxx` SQLSTATE into HTTP status xxx, and src/lib/queries.ts matches on them:
--   PT404  card not found — or not yours; RLS already made those the same thing
--   PT409  the card moved since it was shown (two tabs rating the same card)
--   22023  malformed p_next payload
--   PT403  an attempt to rewrite the append-only part of the review log

-- ---------------------------------------------------------------------------
-- Schema additions
-- ---------------------------------------------------------------------------

-- Which (re)learning step a card sits on. Without this column ts-fsrs restarts
-- every learning card at step 0 on every review, so a card rated Good repeatedly
-- loops on the 10-minute step and never graduates to a real interval. It is
-- scheduling state, so it belongs beside the other scheduling columns (§5.3).
alter table public.cards
  add column learning_steps int not null default 0 check (learning_steps >= 0);

-- The rest of the pre-review snapshot. §5.4 already stored state/stability/
-- difficulty before; undo also has to put back `due`, `last_review`, the step
-- index and the elapsed counter, and none of those are derivable after the fact
-- once a later review has been undone.
alter table public.reviews
  add column due_before timestamptz,
  add column last_review_before timestamptz,
  add column elapsed_days_before int not null default 0,
  add column learning_steps_before int not null default 0,
  -- An undone rating is real history: it is not deleted, it is tombstoned, so
  -- P3's retention math can exclude it and a future FSRS optimiser can decide
  -- for itself whether to.
  add column undone_at timestamptz;

-- No rows exist in any environment yet; the backfill is here so this migration
-- stays safe if that ever stops being true.
update public.reviews set due_before = reviewed_at where due_before is null;
alter table public.reviews alter column due_before set not null;

comment on column public.reviews.undone_at is
  'Set when the user undid this rating. The row stays: the log is append-only.';

-- The daily new-card cap counts today's introductions (§6). Partial, because
-- introductions are a small and shrinking fraction of the log.
create index reviews_new_intro_idx on public.reviews (user_id, reviewed_at desc)
  where state_before = 'new' and undone_at is null;

-- ---------------------------------------------------------------------------
-- The one exception to the append-only rule
-- ---------------------------------------------------------------------------
--
-- §5.7 gives `reviews` no UPDATE policy at all, which also makes it impossible to
-- set `undone_at`. Rather than reach for `security definer` — which would hand
-- undo a way past RLS for every other column too — the log gets a narrow update
-- policy and a trigger that permits exactly one field to change.

create policy reviews_undo on public.reviews
  for update using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

create or replace function public.reviews_tombstone_only()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (to_jsonb(new) - 'undone_at') <> (to_jsonb(old) - 'undone_at') then
    raise exception 'reviews are append-only; only undone_at may be set'
      using errcode = 'PT403';
  end if;
  -- Undo once. Clearing the tombstone would let a bad rating be laundered out of
  -- the history the optimiser learns from.
  if old.undone_at is not null and new.undone_at is distinct from old.undone_at then
    raise exception 'this review was already undone'
      using errcode = 'PT403';
  end if;
  return new;
end;
$$;

create trigger reviews_tombstone_only
  before update on public.reviews
  for each row execute function public.reviews_tombstone_only();

-- ---------------------------------------------------------------------------
-- review_card
-- ---------------------------------------------------------------------------

create or replace function public.review_card(
  p_card_id uuid,
  p_rating smallint,
  p_duration_ms int,
  p_expected_updated_at timestamptz,
  p_next jsonb
)
returns public.cards
language plpgsql
security invoker
set search_path = public
as $$
declare
  -- Exactly what src/lib/fsrs.ts SchedulingUpdate produces. RLS checks who you
  -- are, never what you sent, so the shape is validated here key by key.
  c_allowed constant text[] := array[
    'fsrs_state', 'stability', 'difficulty', 'due', 'last_review',
    'scheduled_days', 'elapsed_days', 'learning_steps'
  ];
  v_key text;
  v_card public.cards;
  v_state public.fsrs_state;
  v_stability double precision;
  v_difficulty double precision;
  v_due timestamptz;
  v_last_review timestamptz;
  v_scheduled_days int;
  v_elapsed_days int;
  v_learning_steps int;
begin
  if p_rating is null or p_rating not between 1 and 4 then
    raise exception 'rating must be 1..4, got %', p_rating using errcode = '22023';
  end if;

  if p_next is null or jsonb_typeof(p_next) <> 'object' then
    raise exception 'p_next must be a json object' using errcode = '22023';
  end if;

  foreach v_key in array c_allowed loop
    if not (p_next ? v_key) or jsonb_typeof(p_next -> v_key) = 'null' then
      raise exception 'p_next is missing %', v_key using errcode = '22023';
    end if;
  end loop;

  for v_key in select jsonb_object_keys(p_next) loop
    if not (v_key = any (c_allowed)) then
      raise exception 'p_next has unexpected key %', v_key using errcode = '22023';
    end if;
  end loop;

  v_state         := (p_next ->> 'fsrs_state')::public.fsrs_state;
  v_stability     := (p_next ->> 'stability')::double precision;
  v_difficulty    := (p_next ->> 'difficulty')::double precision;
  v_due           := (p_next ->> 'due')::timestamptz;
  v_last_review   := (p_next ->> 'last_review')::timestamptz;
  v_scheduled_days := (p_next ->> 'scheduled_days')::int;
  v_elapsed_days  := (p_next ->> 'elapsed_days')::int;
  v_learning_steps := (p_next ->> 'learning_steps')::int;

  -- A review always leaves the card with memory state; `new` after a rating
  -- would violate cards_state_consistency further down anyway, but the message
  -- is more useful here.
  if v_state = 'new' then
    raise exception 'a reviewed card cannot return to state new' using errcode = '22023';
  end if;

  -- Lock first, then compare. Another tab holding the same card blocks here and
  -- loses the version check below rather than racing past it. RLS has already
  -- restricted this to the caller's own rows.
  select * into v_card from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'card % not found', p_card_id using errcode = 'PT404';
  end if;

  if v_card.status <> 'active' then
    raise exception 'card % is % and is not in any queue', p_card_id, v_card.status
      using errcode = '22023';
  end if;

  -- The stale-rating guard: two tabs open on the same card, both showing the
  -- schedule as it was before the first of them rated it.
  if p_expected_updated_at is null or v_card.updated_at <> p_expected_updated_at then
    raise exception 'card % changed since it was loaded', p_card_id
      using errcode = 'PT409',
            hint = 'Reload the queue; this card was already rated elsewhere.';
  end if;

  insert into public.reviews (
    user_id, card_id, rating, duration_ms,
    state_before, stability_before, difficulty_before,
    due_before, last_review_before, elapsed_days_before, learning_steps_before,
    elapsed_days, scheduled_days,
    state_after, stability_after, difficulty_after
  ) values (
    v_card.user_id, v_card.id, p_rating, p_duration_ms,
    v_card.fsrs_state, v_card.stability, v_card.difficulty,
    v_card.due, v_card.last_review, v_card.elapsed_days, v_card.learning_steps,
    -- How long actually passed before this review, and the interval the card was
    -- carrying when it arrived — the two numbers an optimiser replays from.
    v_elapsed_days, v_card.scheduled_days,
    v_state, v_stability, v_difficulty
  );

  update public.cards set
    fsrs_state = v_state,
    stability = v_stability,
    difficulty = v_difficulty,
    due = v_due,
    last_review = v_last_review,
    scheduled_days = v_scheduled_days,
    elapsed_days = v_elapsed_days,
    learning_steps = v_learning_steps,
    reps = v_card.reps + 1,
    -- Counted here rather than taken from the client: every Again is a lapse.
    lapses = v_card.lapses + (case when p_rating = 1 then 1 else 0 end)
  where id = v_card.id
  returning * into v_card;

  return v_card;
end;
$$;

comment on function public.review_card is
  'Log a rating and reschedule the card in one transaction. Raises PT409 if the '
  'card changed since the client loaded it, PT404 if it is not the caller''s.';

-- ---------------------------------------------------------------------------
-- undo_last_review
-- ---------------------------------------------------------------------------
--
-- Undo is not a nicety (SPEC §4.2): mis-hitting `1` on a mature card throws away
-- months of interval. It restores the snapshot the review stored, and tombstones
-- the review rather than deleting it.

create or replace function public.undo_last_review(p_card_id uuid)
returns public.cards
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_card public.cards;
  v_review public.reviews;
begin
  select * into v_card from public.cards where id = p_card_id for update;
  if not found then
    raise exception 'card % not found', p_card_id using errcode = 'PT404';
  end if;

  select * into v_review
  from public.reviews
  where card_id = p_card_id and undone_at is null
  order by reviewed_at desc, id desc
  limit 1
  for update;

  if not found then
    raise exception 'card % has no review to undo', p_card_id using errcode = 'PT404';
  end if;

  update public.reviews set undone_at = now() where id = v_review.id;

  update public.cards set
    fsrs_state = v_review.state_before,
    stability = v_review.stability_before,
    difficulty = v_review.difficulty_before,
    due = v_review.due_before,
    last_review = v_review.last_review_before,
    -- reviews.scheduled_days is the interval the card carried *into* that review.
    scheduled_days = v_review.scheduled_days,
    elapsed_days = v_review.elapsed_days_before,
    learning_steps = v_review.learning_steps_before,
    -- review_card added exactly one rep, and one lapse if the rating was Again.
    reps = greatest(v_card.reps - 1, 0),
    lapses = greatest(
      v_card.lapses - (case when v_review.rating = 1 then 1 else 0 end), 0
    )
  where id = v_card.id
  returning * into v_card;

  return v_card;
end;
$$;

comment on function public.undo_last_review is
  'Restore the card to its state before the most recent rating and tombstone '
  'that review. The review row itself is never deleted.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Signed-out callers gain nothing by calling these (RLS shows them no cards),
-- but there is no reason to leave the door open.

revoke all on function public.review_card(uuid, smallint, int, timestamptz, jsonb) from public;
revoke all on function public.undo_last_review(uuid) from public;

grant execute on function public.review_card(uuid, smallint, int, timestamptz, jsonb)
  to authenticated;
grant execute on function public.undo_last_review(uuid) to authenticated;
