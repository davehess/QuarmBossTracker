-- Faction standing: track magnitude totals alongside hit counts.
--
-- Today the bot stores better_count / worse_count — number of "got better" /
-- "got worse" lines seen. Project Quarm emits varying magnitudes (Kael giant
-- kills tick Coldain by more than +1, quest turn-ins routinely +25 / +50),
-- and treating every line as a single hit hides that signal — a +8 row on
-- the page might be +96 points from 8 Kael giants or +400 from 8 quest
-- turn-ins, and they read identically (Uilnayar 2026-06-23).
--
-- Add better_total / worse_total bigint columns that the bot SUMS instead of
-- counting. Magnitude defaults to 0 (= "we don't have a delta for that line"
-- — older agents, lines without a numeric delta). Web shows whichever is
-- meaningful: magnitude if > 0, count as the fallback + tooltip.
alter table faction_standing
  add column if not exists better_total bigint not null default 0,
  add column if not exists worse_total  bigint not null default 0;

-- Updated bump RPC: sums magnitude on top of incrementing counts. Inputs
-- default to 0 if the agent didn't send them, so the old bot/agent path
-- continues to work unchanged (counts grow, totals stay 0).
create or replace function public.bump_faction_standing(p_rows jsonb)
returns integer
language plpgsql
as $$
declare
  r jsonb;
  n integer := 0;
begin
  for r in select * from jsonb_array_elements(p_rows) loop
    insert into public.faction_standing as fs
      (guild_id, character, faction, better_count, worse_count,
       better_total, worse_total,
       capped_max_at, capped_min_at, first_hit_at, last_hit_at, last_direction)
    values (
      r->>'guild_id',
      r->>'character',
      r->>'faction',
      coalesce((r->>'better')::int, 0),
      coalesce((r->>'worse')::int, 0),
      coalesce((r->>'better_total')::bigint, 0),
      coalesce((r->>'worse_total')::bigint,  0),
      (r->>'capped_max_at')::timestamptz,
      (r->>'capped_min_at')::timestamptz,
      (r->>'first_hit_at')::timestamptz,
      (r->>'last_hit_at')::timestamptz,
      (r->>'last_direction')::smallint
    )
    on conflict (guild_id, character, faction) do update set
      better_count   = fs.better_count + excluded.better_count,
      worse_count    = fs.worse_count  + excluded.worse_count,
      better_total   = fs.better_total + excluded.better_total,
      worse_total    = fs.worse_total  + excluded.worse_total,
      capped_max_at  = greatest(fs.capped_max_at, excluded.capped_max_at),
      capped_min_at  = greatest(fs.capped_min_at, excluded.capped_min_at),
      first_hit_at   = least(fs.first_hit_at, excluded.first_hit_at),
      last_hit_at    = greatest(fs.last_hit_at, excluded.last_hit_at),
      last_direction = case when excluded.last_hit_at >= fs.last_hit_at
                            then excluded.last_direction else fs.last_direction end,
      updated_at     = now();
    n := n + 1;
  end loop;
  return n;
end
$$;
