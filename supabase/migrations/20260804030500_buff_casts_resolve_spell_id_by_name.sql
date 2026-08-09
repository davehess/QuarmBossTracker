-- Recover spell_id on landings the agent reported as "ambiguous".
--
-- When several spells share one landing message the agent picks a
-- representative, writes ITS NAME as spell_name, then sets spell_id = 0 rather
-- than "guessing wrong". But publishing the name and withholding the id are the
-- same claim, and every consumer that matters keys on the ID — the cure queue
-- resolves poison/disease COUNTERS (SPA 35/36) from the catalog, so a 0 means it
-- can never learn a debuff is curable.
--
-- Measured 2026-08-03: 28,842 of 83,770 landings (34.4%) carried spell_id 0
-- across 52 distinct names, and 50 of those names resolve to EXACTLY ONE catalog
-- row. Shadow Poison alone was observed 324 times on 36 targets and never
-- reached the cure queue despite carrying 5 poison counters (its SPA 36 sits in
-- effect slot 6, which effect_id_1..3 does not expose).
--
-- Only UNIQUE name matches are accepted. A name matching 2+ catalog rows stays 0
-- — genuine ambiguity a name cannot settle, ~1.4% of volume. Those are the cases
-- worth resolving from the target's own Mimic buff window or from the spell list
-- of the mob being fought (Hitya 2026-08-03); this pass does not guess.
--
-- ORDER MATTERS. buff_casts carries TWO partial unique indexes —
--   ambiguous: (guild_id, target, landing_text, cast_at) WHERE spell_id = 0
--   resolved:  (guild_id, target, spell_id,     cast_at) WHERE spell_id <> 0
-- so an ambiguous row that resolves can collide with a copy another observer
-- already reported resolved. Those 205 rows are redundant observations of the
-- same landing and are dropped first; the naive UPDATE fails on them.
--
-- Live path: index.js _resolveSpellIdByName applies the identical unique-name
-- rule at ingest, for every agent version.
--
-- Result on apply: 205 duplicates removed, 28,239 landings resolved; the
-- unresolved share fell from 34.4% to 0.5% (Ensnare and Ring of Winter, each a
-- true two-candidate name).

create temporary table _bc_fix on commit drop as
with uniq as (
  select lower(s.name) as lname, min(s.id) as id
  from public.eqemu_spells s
  group by lower(s.name)
  having count(*) = 1
)
select b.id, b.guild_id, b.target, b.cast_at, u.id as new_id
from public.buff_casts b
join uniq u on lower(btrim(b.spell_name)) = u.lname
where (b.spell_id = 0 or b.spell_id is null)
  and b.spell_name is not null;

-- 1) Drop ambiguous rows whose resolved identity already exists.
delete from public.buff_casts b
using _bc_fix c
where b.id = c.id
  and exists (
    select 1 from public.buff_casts r
    where r.spell_id <> 0
      and r.spell_id = c.new_id
      and r.guild_id = c.guild_id
      and r.target   = c.target
      and r.cast_at  = c.cast_at);

-- 2) Drop any that would now collide with EACH OTHER (keep the lowest id).
delete from public.buff_casts b
using (
  select id from (
    select c.id,
           row_number() over (partition by c.guild_id, c.target, c.new_id, c.cast_at
                              order by c.id) as rn
    from _bc_fix c
    where exists (select 1 from public.buff_casts x where x.id = c.id)
  ) r where r.rn > 1
) d
where b.id = d.id;

-- 3) Resolve the survivors.
update public.buff_casts b
set    spell_id = c.new_id
from   _bc_fix c
where  b.id = c.id
  and  (b.spell_id = 0 or b.spell_id is null);
