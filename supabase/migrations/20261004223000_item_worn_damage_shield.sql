-- 20261004223000_item_worn_damage_shield.sql
-- Items whose WORN effect carries a damage shield, with the shield per hit (the guild lead, 2026-10-04:
-- "Missing my additional DS from my neck slot. It only gets added when you have other damage shield").
--
-- The Talisman of Vah Kerrath's worn effect, Blessing of Vah Kerrath, has SPA 59 (damage shield) at
-- base -8 in its fifth slot, so the indexed effect_id_1..3 columns miss it. This reads every slot of
-- raw.eff. A negative base is a shield; a positive one heals the attacker (the Mark of the Plague Lords
-- case) and is left out. Worn effects here are formula 100 (fixed), so the shield is |base|, capped by
-- the slot's max when one is set.
--
-- The item's shield only adds on top of a damage-shield SPELL (EQMacEmu zone/attack.cpp
-- Mob::DamageShield returns early when the spell shield is 0), so the agent adds it only then. The flat
-- eqemu_items.damageshield column is not read: the server never reads it, and it is NULL on almost
-- every item.
--
-- Two items on 2026-10-04: Talisman of Vah Kerrath (8) and Shroud of Eternity (5). Served to agents on
-- the item-clickies payload as `worn_ds`. Tier 1 catalog data: readable like the eqemu_* tables.
-- Idempotent.

create or replace view public.item_worn_damage_shield with (security_invoker = on) as
select i.id         as item_id,
       i.name       as item_name,
       i.worneffect as spell_id,
       s.name       as spell_name,
       least(abs((s.raw->'base'->>(e.ord::int - 1))::int),
             coalesce(nullif(abs((s.raw->'max'->>(e.ord::int - 1))::int), 0),
                      abs((s.raw->'base'->>(e.ord::int - 1))::int))) as ds
  from eqemu_items i
  join eqemu_spells s on s.id = i.worneffect
 cross join lateral jsonb_array_elements_text(s.raw->'eff') with ordinality as e(eff, ord)
 where i.worneffect > 0
   and e.eff = '59'
   and (s.raw->'base'->>(e.ord::int - 1))::int < 0;

grant select on public.item_worn_damage_shield to anon, authenticated;
