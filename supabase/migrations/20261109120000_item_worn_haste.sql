-- 20261109120000_item_worn_haste.sql
-- Items whose WORN effect is an attack-speed spell, with the haste they add (the guild lead, 2026-11-09: "We should
-- be figuring out haste based on buffs too").
--
-- The server fills itembonuses.haste from an item's worn effect, taking the best one (EQMacEmu zone/bonuses.cpp:247 applies
-- the worn spell; SE_AttackSpeed at :1136-1148 keeps the highest `effect_value - 100`), and Mob::GetHaste (zone/mob.cpp:2887)
-- adds it for a client, only when the effect is a worn one (Worn.Type == ItemEffectWorn, 2; bonuses.cpp:245). So gear haste
-- = the largest SPA 11 value - 100 over the worn effects. A slow (base under 100) adds nothing and is left out.
-- ⚠ 105 of the 115 haste items share spell 998 "Haste": base 101, formula 102 (base + the item's worn level,
-- spell_effects.cpp:2581), max 150. The worn level is not in the mirror, so for a level formula the value is the item's own
-- `haste` (the client's figure, backfilled from the local peq DB; 41 for most), capped at max - 100. A fixed formula
-- (0 or 100) is the base itself.
--
-- Served to agents on the item-clickies payload as `worn_haste`. Tier 1 catalog data: readable like the eqemu_* tables.
-- Idempotent.

create or replace view public.item_worn_haste with (security_invoker = on) as
select i.id         as item_id,
       i.name       as item_name,
       i.worneffect as spell_id,
       s.name       as spell_name,
       max(case when coalesce((s.raw->'formula'->>(e.ord::int - 1))::int, 100) in (0, 100)
                then (s.raw->'base'->>(e.ord::int - 1))::int - 100
                else least(coalesce(i.haste, (s.raw->'base'->>(e.ord::int - 1))::int - 100),
                           coalesce(nullif((s.raw->'max'->>(e.ord::int - 1))::int, 0), 1000) - 100)
           end) as haste
  from eqemu_items i
  join eqemu_spells s on s.id = i.worneffect
 cross join lateral jsonb_array_elements_text(s.raw->'eff') with ordinality as e(eff, ord)
 where i.worneffect > 0
   and i.worntype = 2
   and e.eff = '11'
   and (s.raw->'base'->>(e.ord::int - 1))::int > 100
 group by i.id, i.name, i.worneffect, s.name;

grant select on public.item_worn_haste to anon, authenticated;
