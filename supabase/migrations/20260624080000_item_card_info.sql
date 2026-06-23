-- item_card_info — what the inventory page's hover card needs in one call.
-- Stats-only (no icons) per the agreed v1 scope: name, lore, slot bits, class +
-- race bitmasks (decoded client-side), the simulation-relevant numbers (AC, HP,
-- Mana, weapon damage/delay, attack, haste, weight, resists, price), and the
-- clicky link. eqemu_items does NOT mirror stat-attribute columns (astr/asta/
-- etc.) on Quarm, so those are intentionally absent — pqdi.cc/item/<id> handles
-- the full sheet. (Uilnayar 2026-06-23.)
create or replace function item_card_info(p_item_ids integer[])
returns table(
  item_id integer, name text, lore text,
  nodrop boolean, magic boolean, itemtype integer, slots bigint,
  classes integer, races integer,
  required_level integer, recommended_level integer,
  ac integer, hp integer, mana integer,
  damage integer, delay integer, attack integer, haste integer,
  mr integer, cr integer, dr integer, fr integer, pr integer,
  weight integer, price integer,
  clickeffect integer, clicktype integer, clicklevel integer
) language sql stable as $$
  select
    i.id, i.name, nullif(regexp_replace(coalesce(i.lore,''), '^\*', ''), ''),
    i.nodrop, i.magic, i.itemtype, i.slots,
    i.classes, i.races,
    i.required_level, i.recommended_level,
    i.ac, i.hp, i.mana,
    i.damage, i.delay, i.attack, i.haste,
    i.mr, i.cr, i.dr, i.fr, i.pr,
    i.weight, i.price,
    i.clickeffect, i.clicktype, i.clicklevel
  from eqemu_items i
  where i.id = any(p_item_ids);
$$;
grant execute on function item_card_info(integer[]) to service_role;
