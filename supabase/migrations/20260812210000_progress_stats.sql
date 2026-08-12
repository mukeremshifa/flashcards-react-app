-- Aggregation for /progress (SPEC §4.4).
--
-- A year of reviews is up to ~70,000 rows for a serious user. Fetching them to
-- count them is the wrong shape and would not survive §10's performance budget,
-- so the heatmap's daily counts are grouped in Postgres and 365 rows come back
-- instead of 70,000.
--
-- `security invoker`, like every other function in this schema: RLS is the whole
-- security boundary (§5.7), and a definer function here would quietly become a
-- way to read someone else's review log.

-- ---------------------------------------------------------------------------
-- review_day_counts
-- ---------------------------------------------------------------------------
--
-- The day bucket is a transcription of `studyDayKey` in src/lib/day.ts:
--
--   (reviewed_at at time zone tz - interval '4 hours')::date
--
-- Reading the wall clock in the user's zone and then shifting back four hours
-- makes 04:00 local the start of the day (§6), so a session at 01:00 counts
-- towards the previous day. The subtraction happens on a `timestamp without time
-- zone`, which is plain arithmetic with no DST of its own — exactly what day.ts
-- does when it compares the local hour against 4. src/test/stats.test.ts asserts
-- the two agree, including across a DST transition, because that is the case
-- where a second implementation of "what day is it" disagrees invisibly.
--
-- An unknown zone name falls back to UTC rather than raising. That is the same
-- choice `resolveTimeZone` makes in the client: a profile can hold whatever a
-- past version wrote, and a bad zone should give a wrong-but-working heatmap
-- rather than a page that 500s.

create or replace function public.review_day_counts(p_timezone text, p_from timestamptz)
returns table (
  day date, reviews int, again int, hard int, good int, easy int, introduced int
)
language sql
stable
security invoker
set search_path = public
as $$
  with zone as (
    select coalesce(
      (select name from pg_timezone_names where name = p_timezone),
      'UTC'
    ) as tz
  )
  select
    ((r.reviewed_at at time zone z.tz) - interval '4 hours')::date,
    count(*)::int,
    count(*) filter (where r.rating = 1)::int,
    count(*) filter (where r.rating = 2)::int,
    count(*) filter (where r.rating = 3)::int,
    count(*) filter (where r.rating = 4)::int,
    -- What the daily new-card cap already counts in P1's queue: a review whose
    -- card was `new` beforehand is the moment that card was introduced.
    count(*) filter (where r.state_before = 'new')::int
  from public.reviews r
  cross join zone z
  where r.undone_at is null   -- an undone rating is history, never a metric
    and r.reviewed_at >= p_from
  group by 1
  order by 1
$$;

comment on function public.review_day_counts is
  'Reviews per study day (04:00 boundary, p_timezone) since p_from, split by '
  'rating, with the day''s new-card introductions. Undone ratings excluded.';

-- ---------------------------------------------------------------------------
-- Grants
-- ---------------------------------------------------------------------------
-- Supabase ships `alter default privileges in schema public grant all on
-- functions to anon, authenticated`, so a new function is executable by
-- signed-out callers the moment it is created, and `revoke ... from public`
-- does not touch that explicit grant. 20260812150000_revoke_anon_rpc.sql is the
-- precedent; this is the same door on a new function.
--
-- Nothing leaks either way — the function is `security invoker` and RLS shows an
-- anonymous caller no reviews to count — but an unauthenticated request should
-- not reach the function body at all.

revoke all on function public.review_day_counts(text, timestamptz) from public;

do $$
begin
  -- A fresh Postgres has no `anon`; src/test/pg-harness.ts creates one so this
  -- revoke is actually exercised rather than silently skipped.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.review_day_counts(text, timestamptz) from anon';
  end if;
end;
$$;

grant execute on function public.review_day_counts(text, timestamptz) to authenticated;
