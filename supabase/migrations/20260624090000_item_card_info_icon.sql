-- Add the EQ icon number to item_card_info so the inventory grid can render the
-- in-game item icon. icon is a stable numeric index into the EQ gequip sprite
-- set; the web renders <base>/item_<icon>.png with an onError fallback so an
-- unreachable host degrades to the text cell rather than a broken image.
-- (Uilnayar 2026-06-24.) Drop-first because the OUT-param row type changes.
drop function if exists item_card_info(integer[]);
create or replace function item_card_info(p_item_ids integer[])
returns table(
  item_id integer, name text, lore text, icon integer,
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
    i.id, i.name, nullif(regexp_replace(coalesce(i.lore,''), '^\*', ''), ''), i.icon,
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
