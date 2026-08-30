-- item_catalog_droppable — the wishlist picker's universe.
--
-- Every item any catalogued NPC can drop, with the expansion it belongs to.
-- 11,099 rows / ~380 kB of JSON / ~130 kB gzipped, served to agents as an
-- ETag'd catalog they cache on disk (same shape as spell-catalog).
--
-- ⚠ Deliberately "everything droppable", NOT "everything our tracked bosses
-- drop". Hitya, 2026-08-30: include the Planes of Power items so people can
-- build a wishlist before the 2026-10-01 unlock. Only 12 PoP bosses are
-- registered in bosses_local today (against 407 Luclin) because the PoP board
-- gets built out AFTER unlock — so a boss-driven universe reached just 113 PoP
-- items out of 1,212. Keying on the drop table instead needs no boss
-- registration and cannot go stale when /addboss runs later.
--
-- era: eqemu_zone.expansion — 0 Classic · 1 Kunark · 2 Velious · 3 Luclin ·
-- 4 Planes of Power. Items carry no expansion column, so it is derived from
-- the dropping NPC's zone via the id = zoneid*1000 + n convention (the recipe
-- in docs/eqemu-catalog-cheatsheet.md). An item that drops in several eras
-- takes the EARLIEST — where a player first meets it. 22 rows resolve to no
-- zone and keep era NULL rather than being dropped from the picker.
create or replace view item_catalog_droppable as
select distinct on (i.id)
       i.id   as item_id,
       i.name as item_name,
       z.expansion as era
from eqemu_items i
join eqemu_npc_drops d on d.item_id = i.id
left join eqemu_zone z on z.zone_id = (d.npc_id / 1000)
order by i.id, z.expansion nulls last;

-- Tier 1 catalog data: same read scope as the eqemu_* mirrors it is built from.
grant select on item_catalog_droppable to anon, authenticated;
