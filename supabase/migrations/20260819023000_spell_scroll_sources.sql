-- Spell-scroll sources (Hitya 2026-08-18: the spellbook page's PQDI links —
-- "those don't work. We should say where it's from"). merchant_id joins the
-- mirrored merchantlist to actual vendors; the column fills on the next
-- forced sync-quarm run (the dump has always carried it — we just never
-- picked it).

alter table eqemu_npc_types add column if not exists merchant_id integer;
create index if not exists eqemu_npc_types_merchant_idx
  on eqemu_npc_types (merchant_id) where merchant_id is not null;

-- One call per page render: every vendor and every dropper for a set of
-- scroll item ids, with the zone resolved through the spawn tables (the
-- denormalized npc_types.zone_short is NULL by long-standing doctrine).
create or replace function spell_scroll_sources(p_item_ids integer[])
returns table (item_id integer, kind text, npc_id integer, npc_name text, zone_short text, zone_long text)
language sql stable as $$
  select ml.item::integer as item_id, 'merchant'::text as kind,
         n.id as npc_id, n.name as npc_name,
         s2.zone_short, z.long_name as zone_long
  from eqemu_merchantlist ml
  join eqemu_npc_types n on n.merchant_id = ml.merchantid
  left join eqemu_spawnentry se on se.npc_id = n.id
  left join eqemu_spawn2 s2 on s2.spawngroup_id = se.spawngroup_id
  left join eqemu_zone z on z.short_name = s2.zone_short
  where ml.item = any(p_item_ids)
  group by ml.item, n.id, n.name, s2.zone_short, z.long_name
  union all
  select d.item_id, 'drop'::text, d.npc_id, d.npc_name,
         d.zone_short, z.long_name
  from eqemu_npc_drops d
  left join eqemu_zone z on z.short_name = d.zone_short
  where d.item_id = any(p_item_ids)
  group by d.item_id, d.npc_id, d.npc_name, d.zone_short, z.long_name
$$;
