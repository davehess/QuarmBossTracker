-- who_directory_json() — the whole /who directory in ONE round trip.
--
-- The /who page needs the full catalog (~8.8k rows) for client-side filters,
-- but PostgREST caps any response at max-rows (1000), so the page drained the
-- view in ~9 SEQUENTIAL .range() pages — ~9 round trips of latency per load
-- (efficiency review 2026-07-07, MEDIUM). A jsonb_agg returns a single value,
-- which the row cap doesn't apply to. Ordered by the view's unique
-- character_key (same ordering the pagination used — see the Nosfearatu
-- duplicate-row bug, 2026-06-22).
create or replace function public.who_directory_json()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(jsonb_agg(w order by w.character_key), '[]'::jsonb)
  from who_directory w;
$$;

revoke all on function public.who_directory_json() from public;
revoke all on function public.who_directory_json() from anon;
grant execute on function public.who_directory_json() to authenticated;
grant execute on function public.who_directory_json() to service_role;
