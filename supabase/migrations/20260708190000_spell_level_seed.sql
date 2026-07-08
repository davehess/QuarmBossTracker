-- Spell level seed (Uilnayar 2026-07-08: "start building out the levels for
-- these spells 61-65").
--
-- The missing-spells page derives a spell's level from guild spellbooks, so any
-- spell nobody has scribed-and-uploaded shows as "Level unknown" — every PoP
-- 61-65 spell (not scribable until the 2026-10-01 unlock) plus any older spell
-- the current roster never uploaded. The eqemu_* mirror carries NO per-class
-- level data (spells.raw is effect-only; item required/recommended_level are 0),
-- so there is nothing to derive from. This table lets officers record the
-- canonical scribe level per spell.
--
-- SELF-HEALING: character_missing_spells COALESCEs the guild-scribed level
-- FIRST, this seed SECOND — so the moment a real druid scribes a PoP spell and
-- uploads, their actual level wins and the seed becomes irrelevant. The seed is
-- just a planning placeholder until then.

create table if not exists public.spell_level_seed (
  spell_id    integer primary key,
  level       integer not null check (level between 1 and 75),
  source      text    not null default 'officer',
  note        text,
  updated_by  text,
  updated_at  timestamptz not null default now()
);

alter table public.spell_level_seed enable row level security;
drop policy if exists spell_level_seed_read on public.spell_level_seed;
create policy spell_level_seed_read on public.spell_level_seed
  for select to authenticated using (true);
-- Writes are service-role only (the officer editor goes through the bot/web
-- service key after an isOfficer() check), so no write policy for authenticated.

-- Recompute character_missing_spells to coalesce the seed under scribed levels.
DROP FUNCTION IF EXISTS public.character_missing_spells(text, text, integer);

CREATE FUNCTION public.character_missing_spells(p_guild_id text, p_character text, p_class_bit integer)
RETURNS TABLE(spell_name text, scroll_item_id integer, spell_id integer,
              scribe_level integer, held_by text[], buyable boolean)
LANGUAGE sql STABLE
AS $function$
  with scribed as (
    select lower(spell_name) as nm
    from character_spellbook
    where guild_id = p_guild_id and lower(character_name) = lower(p_character)
  ),
  pool as (
    select distinct on (lower(regexp_replace(substring(i.name from 8), '\*+\s*$', '')))
      regexp_replace(substring(i.name from 8), '\*+\s*$', '')       as spell_name,
      i.id                                                          as scroll_item_id,
      (select s.id from eqemu_spells s
         where lower(s.name) = lower(regexp_replace(substring(i.name from 8), '\*+\s*$', ''))
         order by s.id limit 1)                                     as spell_id,
      exists(select 1 from eqemu_merchantlist m where m.item = i.id) as buyable
    from eqemu_items i
    where i.name like 'Spell: %'
      and (i.classes & p_class_bit) > 0
    order by lower(regexp_replace(substring(i.name from 8), '\*+\s*$', '')),
             (i.name like '%*%'),
             (not exists(select 1 from eqemu_merchantlist m where m.item = i.id)),
             i.id
  ),
  levels as (
    select lower(spell_name) as nm, min(spell_level) as lvl
    from character_spellbook
    where guild_id = p_guild_id and spell_level is not null
    group by lower(spell_name)
  ),
  holders as (
    select lower(regexp_replace(substring(ci.item_name from 8), '\*+\s*$', '')) as nm,
           array_agg(distinct ci.character_name order by ci.character_name) as names
    from character_inventory ci
    where ci.guild_id = p_guild_id and ci.item_name like 'Spell: %'
    group by lower(regexp_replace(substring(ci.item_name from 8), '\*+\s*$', ''))
  )
  select p.spell_name, p.scroll_item_id, p.spell_id,
         coalesce(l.lvl, sd.level)::integer as scribe_level,   -- scribed first, seed fallback
         coalesce(h.names, '{}') as held_by,
         p.buyable
  from pool p
  left join scribed sc on sc.nm = lower(p.spell_name)
  left join levels  l  on l.nm  = lower(p.spell_name)
  left join holders h  on h.nm  = lower(p.spell_name)
  left join spell_level_seed sd on sd.spell_id = p.spell_id
  where sc.nm is null
  order by coalesce(l.lvl, sd.level) nulls last, p.buyable desc, p.spell_name;
$function$;
