-- The old "Quests: public" switch also opened inventory + spellbook. The guild
-- lead, 2026-09-25, on graduating the split (web 1.8.8): "go ahead, make their
-- inventories private".
--
-- The 11 characters it applies to are exactly the ones with both flags on:
-- 20260925112702 set show_quests_publicly from the old flag, and nobody had
-- turned the new inventory switch on separately before this ran (checked:
-- 11 both-on, 0 inventory-only, 0 quests-only). Their quest pages stay public;
-- each owner can turn "Inventory page" back on from /me.
--
-- Applied after web 1.8.8 was serving, so production never showed those quest
-- pages as private under the old single-flag code.

update characters
   set show_inventory_publicly = false
 where show_inventory_publicly = true
   and show_quests_publicly = true;
