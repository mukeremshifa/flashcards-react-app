-- Close the RPCs to signed-out callers.
--
-- 20260812093000_review_card.sql ended with `revoke all … from public`, believing
-- that shut the door. It did not: Supabase ships
--   alter default privileges in schema public grant all on functions to anon, …
-- so every new function in `public` picks up an explicit EXECUTE grant for `anon`,
-- and revoking from the PUBLIC pseudo-role leaves that grant untouched. Verified
-- against the live project: an anonymous POST to /rest/v1/rpc/review_card reached
-- the function body and came back with a validation error rather than a 401.
--
-- Nothing leaked — both functions are `security invoker`, `auth.uid()` is null for
-- an anonymous caller, and RLS therefore shows them no card to rate or undo. But
-- an unauthenticated request should not be able to enter a mutation function at
-- all, and a comment claiming a protection that is not there is worse than no
-- comment.

do $$
begin
  -- The harness in src/test/pg-harness.ts stubs only the roles it needs, and a
  -- fresh Postgres has no `anon`. Guarded so this migration applies in both.
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on function public.review_card(uuid, smallint, int, timestamptz, jsonb) from anon';
    execute 'revoke all on function public.undo_last_review(uuid) from anon';
  end if;
end;
$$;
