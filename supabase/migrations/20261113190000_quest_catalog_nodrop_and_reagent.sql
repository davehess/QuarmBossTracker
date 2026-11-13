-- Quest tracker: correct the no-drop notes on the Binden and Secrets of the Planes entries, and add the talismans' reagent.
--
-- 1. The seed of 20261113150000 read `eqemu_items.nodrop` backwards. In our mirror the column is the server's raw flag made
--    boolean: TRUE means the item can be traded, FALSE means NO DROP (checked against known items: Cloak of Flames and
--    Flowing Black Silk Sash are true, the epics are false). So the notes called tradeable items "NO DROP" (Blue Diamond,
--    Rage Filled Gem, Symbol of the Diaku, Battle Worn Trinket, the three crafted hand-ins) and did not mark the ones that
--    are (every Binden part, the three plane gems, the named drops, the manuals, the Hope Stone).
-- 2. The talismans' click, Talisman Gate (spell 3046), takes you to the Plane of Knowledge and uses up one Quintessence of
--    Knowledge each time: the server's spell table lists it as the spell's component, and the server's item-click code
--    exempts only instant-cast and expendable items (the talismans cast in 20 seconds). The Quintessence is recipe 10066:
--    Tanaan Ginko and Erudition Vine in a Medicine Bag, alchemy (a shaman's combine), cannot fail.
--
-- Data only, idempotent: every statement sets a fixed text or appends a sentence once.

-- ── Secrets of the Planes: tradeable, not no-drop ────────────────────────────────────────────────────────────────
update quest_required_item r set notes = 'Tradeable. One for each of the three advanced manuals. Rare in many zones: Temple of Veeshan and Vex Thal about 5%, most planes about 3%.'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes (1/4)%' and r.item_id = 22503;
update quest_required_item r set notes = 'Tradeable. One for each of the three advanced manuals.'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and (q.name like 'Secrets of the Planes (2/4)%' or q.name like 'Secrets of the Planes (3/4)%') and r.item_id = 22503;
update quest_required_item r set notes = 'Tradeable. Decorin, Gindan and named in Drunder, the Fortress of Zek (2.5%).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 26697;
update quest_required_item r set notes = 'Tradeable. The Diaku in Drunder, the Fortress of Zek (2%).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id in (26709, 26710);
update quest_required_item r set notes = 'Beginner hand-in. Tradeable, so a brewer can make it for you (trivial 216; the combine can fail and makes three). Bloods from slarghilug and mephits in Nightmare and bubonians in Disease or the Crypt of Decay.'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 28787;
update quest_required_item r set notes = 'Beginner hand-in. Tradeable, so a potter can make it for you: three combines (the unfired stein is trivial 216 and can fail). Needs Valor Crystals (Plane of Valor, 10%) and a Lacquered Peridot.'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 29168;
update quest_required_item r set notes = 'Beginner hand-in. Tradeable, so a baker can make it for you (trivial 302; the combine can fail). Hobgoblin Meat from the hobgoblins in Nightmare (20%).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 29751;

-- ── Secrets of the Planes: these ARE no-drop ─────────────────────────────────────────────────────────────────────
update quest_required_item r set notes = 'Beginner hand-in. NO DROP. From Willamina, Plane of Knowledge, for New Sewing Needles.'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 28745;
update quest_required_item r set notes = 'NO DROP. The jord giants, Bastion of Thunder (10%).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 9421;
update quest_required_item r set notes = 'NO DROP. The vann giants, Bastion of Thunder (10%).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 9423;
update quest_required_item r set notes = 'NO DROP. The vind giants, Bastion of Thunder (10%).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 9424;
update quest_required_item r set notes = 'Intermediate hand-in. NO DROP. The Junk Beast, Plane of Innovation (always drops).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 29145;
update quest_required_item r set notes = 'Intermediate hand-in. NO DROP. Rallius Rattican, Plane of Disease (always drops).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 29133;
update quest_required_item r set notes = 'Intermediate hand-in. NO DROP. Vhaksiz the Shade, Plane of Nightmare (always drops).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 28801;
update quest_required_item r set notes = 'NO DROP. Drops in all four elemental planes: Air, Water, Fire and Earth (25% from most mobs).'
  from quest_catalog q where q.id = r.quest_id and q.guild_id = 'wolfpack' and q.name like 'Secrets of the Planes%' and r.item_id = 16258;
update quest_catalog set notes = notes || ' The manuals and Secrets of the Planes itself are NO DROP: every character does their own hand-ins.'
  where guild_id = 'wolfpack' and name = 'Secrets of the Planes (4/4)' and notes not like '%NO DROP%';

-- ── The Binden Concerrentia: every part is no-drop, and the click needs a reagent ───────────────────────────────
update quest_catalog set notes = notes || ' Every part and every talisman in this quest is NO DROP: each character loots their own.'
  where guild_id = 'wolfpack' and name like 'The Binden Concerrentia (%' and notes not like '%NO DROP%';
update quest_catalog set notes = notes || ' The talisman''s click, Talisman Gate, takes you to the Plane of Knowledge and uses up one Quintessence of Knowledge each time (tradeable: a shaman combines Tanaan Ginko and Erudition Vine, about 100 platinum together from Severg O''Danos in the Plane of Knowledge, in a Medicine Bag; it cannot fail).'
  where guild_id = 'wolfpack' and name like 'The Binden Concerrentia (%' and notes not like '%Quintessence of Knowledge%';
