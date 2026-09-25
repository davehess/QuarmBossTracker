-- Quests and inventory get separate sharing switches (the guild lead, 2026-09-25:
-- "we should separate out inventory versus quests").
--
-- Until now one flag, characters.show_inventory_publicly, sat behind a /me
-- toggle labelled "Quests: public" and opened three pages to every member:
-- quests, inventory and spellbook. This adds the quest switch on its own:
--   • show_quests_publicly   → /character/<name>/quests
--   • show_inventory_publicly → /character/<name>/inventory and /spells (unchanged)
--
-- Additive only. Everyone who had the combined switch on keeps their quests
-- public. Their inventory switch is left as it is here, so production — which
-- still reads the old flag for all three pages until the new pages graduate from
-- beta — shows exactly what it showed before. Whether to turn those inventories
-- private at graduation (they only ever saw a switch labelled "Quests") is the
-- guild lead's call, recorded in docs/DECISIONS-2026-09-21.md.

alter table characters
  add column if not exists show_quests_publicly boolean not null default false;

update characters
   set show_quests_publicly = true
 where show_inventory_publicly = true
   and show_quests_publicly = false;
