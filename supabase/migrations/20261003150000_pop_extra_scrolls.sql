-- pop_extra_scrolls(guild) — PoP reward scrolls that a raider is holding AND has already scribed.
-- The guild lead, 2026-10-03: "extra PoP spells. when someone does a turnin for their new spells
-- and gets one they already have, put that into an officer only list so we can help direct who
-- needs it."
--
-- PHASE 1, from data we already hold. No turn-in log line has been captured yet, so we cannot see
-- the moment a trainer hands over a duplicate. What we CAN see: a reward scroll sitting in a
-- character's inventory export whose spell that same character's spellbook export already
-- lists. That is an extra: it cannot be scribed, so it can go to someone who still needs it.
--
-- How the three joins work:
--   • Which items are PoP reward scrolls: character_inventory.item_id against
--     pop_parchment_pools.scroll_item_id (the 225 PoK-trainer rewards). An id join, because the
--     inventory export carries the item id.
--   • "Already has it": the scroll's spell name against the holder's character_spellbook. By NAME,
--     not id: eqemu_items has no scroll-to-spell column in the mirror (no scrolleffect), so the
--     same name match pop_spell_needs uses is the only link. Both sides drop the prefix and any
--     trailing '*' (the pool view already does; the spellbook side is stripped here because a
--     starred name would otherwise miss).
--   • Who needs it: pop_spell_needs() itself, filtered to the spell, so the order is exactly the
--     first-dibs order /pop shows: highest level first (unknown level last), then class level,
--     then name. Not re-derived here; a second copy of that rule would drift.
--
-- Opt-outs: a holder with exclude_from_stats or exclude_inventory set is skipped (their bags are
-- not ours to list), and so is a needer with exclude_inventory (pop_spell_needs already drops
-- exclude_from_stats; a spellbook uploaded before an opt-out would otherwise still count).
--
-- One row per extra scroll (a holder with two copies in two bags is two rows). `needers` is a
-- jsonb array of {name, class, level}, empty when nobody on record still needs the spell.
--
-- STALENESS: a scroll the holder scribed after their last inventory export still shows here until
-- the next export. The spellbook's observed_at is returned so the page can say so: the spellbook
-- upload replaces the whole book, so a spellbook newer than the bags is the case to double-check.
--
-- Read-only. Inventories and spellbooks are guild data, so only the service role (the site's
-- server, behind requireOfficer) may call it. PUBLIC holds EXECUTE on a new function by default,
-- so it is revoked first (the precedent that only grants, guild_held_spell_needs, is callable by
-- anon in the live ACL; RLS on its tables is all that keeps it empty).

create or replace function public.pop_extra_scrolls(p_guild_id text)
returns table(
  holder_name text, holder_class text,
  scroll_item_id integer, scroll_name text, spell_name text,
  slot_label text, quantity integer,
  inventory_observed_at timestamptz, spellbook_observed_at timestamptz,
  needers jsonb)
language sql
stable
set search_path = public
as $$
  with reward as (   -- one row per reward scroll id; spell_name is already stripped of prefix and '*'
    select distinct pp.scroll_item_id, pp.spell_name
    from pop_parchment_pools pp
  ),
  extras as (
    select ci.character_name as holder_name, c.class as holder_class,
           r.scroll_item_id, ci.item_name as scroll_name, r.spell_name,
           ci.slot_label, ci.quantity,
           ci.observed_at as inventory_observed_at, sb.observed_at as spellbook_observed_at
    from character_inventory ci
    join reward r on r.scroll_item_id = ci.item_id
    join characters c
      on c.guild_id = ci.guild_id and lower(c.name) = lower(ci.character_name)
    cross join lateral (   -- the holder's own spellbook row(s) for this spell
      select max(b.observed_at) as observed_at
      from character_spellbook b
      where b.guild_id = ci.guild_id
        and lower(b.character_name) = lower(ci.character_name)
        and lower(regexp_replace(b.spell_name, '\*+\s*$', '')) = lower(r.spell_name)
    ) sb
    where ci.guild_id = p_guild_id
      and sb.observed_at is not null                       -- they already have the spell
      and coalesce(c.deleted, false) = false
      and coalesce(c.exclude_from_stats, false) = false
      and coalesce(c.exclude_inventory, false) = false
  ),
  needers as (
    select lower(n.spell_name) as nm,
           jsonb_agg(
             jsonb_build_object('name', n.character_name, 'class', n.char_class, 'level', n.char_level)
             -- pop_spell_needs's own order: level desc (unknown last), class level desc, name
             order by n.char_level desc nulls last, n.spell_level desc, n.character_name
           ) as list
    from pop_spell_needs(p_guild_id) n
    where lower(n.spell_name) in (select lower(e.spell_name) from extras e)
      and not exists (
        select 1 from characters nc
        where nc.guild_id = p_guild_id
          and lower(nc.name) = lower(n.character_name)
          and coalesce(nc.exclude_inventory, false))
    group by lower(n.spell_name)
  )
  select e.holder_name, e.holder_class, e.scroll_item_id, e.scroll_name, e.spell_name,
         e.slot_label, e.quantity, e.inventory_observed_at, e.spellbook_observed_at,
         coalesce(nd.list, '[]'::jsonb) as needers
  from extras e
  left join needers nd on nd.nm = lower(e.spell_name)
  order by e.spell_name, e.holder_name, e.slot_label;
$$;

revoke all on function public.pop_extra_scrolls(text) from public, anon, authenticated;
grant execute on function public.pop_extra_scrolls(text) to service_role;
