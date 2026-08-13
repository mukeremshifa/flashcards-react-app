-- Row Level Security (SPEC §5.7).
--
-- One rule for every table: you may touch a row only if you own it. There are no
-- exceptions in v1 — no shared decks, no admin bypass, no service-role writes.
-- The Edge Function calls Supabase with the caller's JWT precisely so these
-- policies apply to generated inserts too.

alter table public.profiles    enable row level security;
alter table public.decks       enable row level security;
alter table public.cards       enable row level security;
alter table public.reviews     enable row level security;
alter table public.generations enable row level security;

-- Also apply RLS to the table owner. Without this, anything connecting as the
-- owning role (including some migration/tooling paths) silently bypasses every
-- policy, which is exactly the mistake the isolation test is meant to catch.
alter table public.profiles    force row level security;
alter table public.decks       force row level security;
alter table public.cards       force row level security;
alter table public.reviews     force row level security;
alter table public.generations force row level security;

-- profiles: keyed by id, not user_id.
create policy profiles_select on public.profiles
  for select using ((select auth.uid()) = id);
create policy profiles_update on public.profiles
  for update using ((select auth.uid()) = id) with check ((select auth.uid()) = id);
-- No insert policy: rows are created by the on_auth_user_created trigger
-- (security definer). No delete policy: profiles die with the auth user.

-- decks
create policy decks_select on public.decks
  for select using ((select auth.uid()) = user_id);
create policy decks_insert on public.decks
  for insert with check ((select auth.uid()) = user_id);
create policy decks_update on public.decks
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
create policy decks_delete on public.decks
  for delete using ((select auth.uid()) = user_id);

-- cards. The deck_id check stops a user from parking a card in someone else's
-- deck: owning the card row is necessary but not sufficient.
create policy cards_select on public.cards
  for select using ((select auth.uid()) = user_id);
create policy cards_insert on public.cards
  for insert with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.decks d
      where d.id = deck_id and d.user_id = (select auth.uid())
    )
  );
create policy cards_update on public.cards
  for update using ((select auth.uid()) = user_id)
  with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.decks d
      where d.id = deck_id and d.user_id = (select auth.uid())
    )
  );
create policy cards_delete on public.cards
  for delete using ((select auth.uid()) = user_id);

-- reviews: insert and select only. The log is append-only by policy, not just by
-- convention — no update or delete policy exists, so neither is possible.
create policy reviews_select on public.reviews
  for select using ((select auth.uid()) = user_id);
create policy reviews_insert on public.reviews
  for insert with check (
    (select auth.uid()) = user_id
    and exists (
      select 1 from public.cards c
      where c.id = card_id and c.user_id = (select auth.uid())
    )
  );

-- generations: the client may read its own history (quota display) but must not
-- write it — only the Edge Function does, and it writes through this same policy
-- set using the caller's JWT.
create policy generations_select on public.generations
  for select using ((select auth.uid()) = user_id);
create policy generations_insert on public.generations
  for insert with check ((select auth.uid()) = user_id);
create policy generations_update on public.generations
  for update using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
