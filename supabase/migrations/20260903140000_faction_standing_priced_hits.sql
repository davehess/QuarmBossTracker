-- faction_standing: count the hits whose point value we actually resolved.
--
-- Hitya, 2026-09-03: "this is still inaccurate. We should have how many
-- positive and negative hits total in parentheses for raised and lowered, and
-- the raised/lowered should specifically call out how much the faction has been
-- raised or lowered."
--
-- The page showed +228 for Heart of Seru where it had shown +586 an hour
-- earlier. Neither number was wrong; they were different UNITS. The cell
-- rendered better_total when it was non-zero and better_count otherwise, both
-- formatted "+N" -- and bot 3.1.118 had just started pricing new hits, so the
-- cell silently switched from 586 hits to 228 points with no change in shape.
--
-- Showing points AND hits side by side fixes the unit problem but opens a
-- worse one: "+228 (586 hits)" reads as 586 hits totalling 228 points, when in
-- truth 114 of them were priced and 472 have no known value. Anyone doing
-- repair arithmetic off that line gets a wrong answer. So this records how many
-- hits in each direction were priced, and the page says "points from 114 of
-- 586 hits" and marks the total as a floor rather than a sum.
--
-- Additive like every other counter here. Idempotent: if not exists.
alter table faction_standing
  add column if not exists better_priced integer not null default 0,
  add column if not exists worse_priced  integer not null default 0;

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
       better_total, worse_total, better_priced, worse_priced,
       capped_max_at, capped_min_at, first_hit_at, last_hit_at, last_direction)
    values (
      r->>'guild_id',
      r->>'character',
      r->>'faction',
      coalesce((r->>'better')::int, 0),
      coalesce((r->>'worse')::int, 0),
      coalesce((r->>'better_total')::bigint, 0),
      coalesce((r->>'worse_total')::bigint,  0),
      coalesce((r->>'better_priced')::int, 0),
      coalesce((r->>'worse_priced')::int,  0),
      (r->>'capped_max_at')::timestamptz,
      (r->>'capped_min_at')::timestamptz,
      (r->>'first_hit_at')::timestamptz,
      (r->>'last_hit_at')::timestamptz,
      (r->>'last_direction')::smallint
    )
    on conflict (guild_id, character, faction) do update set
      better_count   = fs.better_count  + excluded.better_count,
      worse_count    = fs.worse_count   + excluded.worse_count,
      better_total   = fs.better_total  + excluded.better_total,
      worse_total    = fs.worse_total   + excluded.worse_total,
      better_priced  = fs.better_priced + excluded.better_priced,
      worse_priced   = fs.worse_priced  + excluded.worse_priced,
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
