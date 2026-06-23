-- Correct mis-seeded faction/stack turn-ins (Uilnayar 2026-06-24):
--   • Ice Giant Toes (16540) are NOT a Kael faction turn-in — Kael uses
--     Storm/Frost Giant Toes. Ice Giant Toes feed Nivold Predd (Paineel) and
--     Vira (Temple of Solusek Ro).
--   • Red/White Dragon Scales (11622/11602) are epic components, not a
--     Skyshrine faction turn-in, and do NOT stack.
-- The authoritative turn-ins for all three live in scripted_npc_turnins, so the
-- inventory-driven discovery panel surfaces them correctly — we just retire the
-- wrong curated quest_catalog rows (deactivate, reversible).
update quest_catalog set active = false
where guild_id = 'wolfpack'
  and is_stack_turnin = true
  and (
    (name ilike 'Kael giant turn-in%'
       and id in (select quest_id from quest_required_item where item_id = 16540))
    or (name ilike 'Skyshrine turn-in%'
       and id in (select quest_id from quest_required_item where item_id in (11622, 11602)))
  );
