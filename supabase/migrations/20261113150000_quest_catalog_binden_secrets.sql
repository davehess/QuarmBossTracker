-- Quest tracker: The Binden Concerrentia and Secrets of the Planes (the guild lead, 2026-11-13: "add the The Binden
-- Concerrentia and Secrets of the Planes quests to the quests pages").
--
-- Pure DATA for the existing officer-edited catalog (quest_catalog + quest_required_item, migration 20260624010000);
-- officers can change any row at /admin/quests. Idempotent: a quest is seeded only when no quest of that name exists
-- for the guild.
--
-- Every hand-in, reward and combine below is read from the server's own scripts and tables (never a guide):
--   potranquility/Jimlok_Keylifter.lua, poknowledge/Tabben_Bromal.lua, potranquility/Elder_Clinka.lua
--   recipes 9983 (Sealed Parts Box), 9874 (Locked Parts Box), 9980 (Sealed Lined Case): all three cannot fail
--   drop zones and chances from eqemu_npc_drops, item names from eqemu_items (checked 2026-11-13)
--
-- Shape: one catalog quest per stage, as the Vex Thal key is seeded. A stage's reward is the item you hold when the
-- stage is done; the next stage consumes it. The tracker reads a character's VISIBLE inventory, so a part already
-- combined or handed in reads as "not seen", not "never had".

do $$
declare
  qid bigint;
begin
  -- ── The Binden Concerrentia, stage 1 of 3 ────────────────────────────────────────────────────────────────────
  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'The Binden Concerrentia (1/3) — Small Clockwork Talisman') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'The Binden Concerrentia (1/3) — Small Clockwork Talisman', 'other',
            'Plane of Tranquility / Plane of Knowledge', 'https://www.pqdi.cc/item/28284',
            'Loot a Tiny Bottle and Note from the festering rats in the Plane of Justice and give it to Jimlok Keylifter (Plane of Tranquility) for the Strange Jeweler''s Schematic. Give that to Tabben Bromal (Plane of Knowledge): he returns it with a Small parts kit. Combine the four parts in the kit (it cannot fail) and give him the Sealed Parts Box for the Small Clockwork Talisman and a Small Parts Container.',
            70, true, 28284, 'Small Clockwork Talisman')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28277, 'Tiny Bottle and Note',        1, true,  10, 'Starts the quest. A festering rat, Plane of Justice (10%). Handed to Jimlok Keylifter.'),
      ('wolfpack', qid, 28278, 'Strange Jeweler''s Schematic', 1, true,  20, 'From Jimlok Keylifter. Tabben Bromal hands it back with the kit.'),
      ('wolfpack', qid, 28279, 'Tri-coated Metal Casing',     1, false, 30, 'A defective clockwork, Plane of Innovation (8%).'),
      ('wolfpack', qid, 28280, 'Size C Spring',               1, false, 40, 'A corroded or erratic model, Plane of Innovation (8%).'),
      ('wolfpack', qid, 28281, 'Creeping Silk Strands',       1, false, 50, 'Virulent spiders, Plane of Nightmare (10%), or the bile piles, Plane of Disease (8%).'),
      ('wolfpack', qid, 28282, 'Congealed Bile-based Ooze',   1, false, 60, 'The same spiders in Nightmare (10%) or bile piles in Disease (8%).'),
      ('wolfpack', qid, 28283, 'Sealed Parts Box',            1, true,  70, 'The four parts combined in the Small parts kit. Handed to Tabben Bromal.');
  end if;

  -- ── The Binden Concerrentia, stage 2 of 3 ────────────────────────────────────────────────────────────────────
  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'The Binden Concerrentia (2/3) — Powered Clockwork Talisman') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'The Binden Concerrentia (2/3) — Powered Clockwork Talisman', 'other',
            'Plane of Knowledge — Tabben Bromal', 'https://www.pqdi.cc/item/28290',
            'With the Small Parts Container from stage 1 on you, tell Tabben Bromal you are "ready to write down" the parts. Combine the four parts and the Small Clockwork Talisman in the container (it cannot fail) and give him the Locked Parts Box for the Powered Clockwork Talisman (15 charges of Talisman Gate) and The Talisman Schematic.',
            71, true, 28290, 'Powered Clockwork Talisman')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28284, 'Small Clockwork Talisman', 1, false, 10, 'The reward of stage 1. Goes into the combine.'),
      ('wolfpack', qid, 28285, 'Dense Hammered Casing',    1, false, 20, 'The Diaku in Drunder, the Fortress of Zek (10%).'),
      ('wolfpack', qid, 28286, 'Crystalline Carapace',     1, false, 30, 'Crystalline and lucid arachnae, Plane of Valor (8%).'),
      ('wolfpack', qid, 28287, 'Fiery Power Source',       1, false, 40, 'Sun guardians, sentries and protectors of Ro, Tower of Solusek Ro (10%).'),
      ('wolfpack', qid, 28288, 'Strands of Living Chain',  1, false, 50, 'The parylyx spiders, Plane of Torment (50%).'),
      ('wolfpack', qid, 28289, 'Locked Parts Box',         1, true,  60, 'The four parts and the talisman combined in the Small Parts Container. Handed to Tabben Bromal.');
  end if;

  -- ── The Binden Concerrentia, stage 3 of 3 ────────────────────────────────────────────────────────────────────
  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'The Binden Concerrentia (3/3)') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'The Binden Concerrentia (3/3)', 'other',
            'Plane of Tranquility — Elder Clinka', 'https://www.pqdi.cc/item/28296',
            'Give The Talisman Schematic to Elder Clinka for a Small Lined Case. Combine the Powered Clockwork Talisman with one living fragment from each elemental plane in the case (it cannot fail) and give her the Sealed Lined Case. The Binden Concerrentia is a neck item: 75 HP and mana, +15 to five stats and all resists, and unlimited Talisman Gate.',
            72, true, 28296, 'The Binden Concerrentia')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28291, 'The Talisman Schematic',      1, true,  10, 'From stage 2. Handed to Elder Clinka for the Small Lined Case.'),
      ('wolfpack', qid, 28290, 'Powered Clockwork Talisman',  1, false, 20, 'The reward of stage 2. Goes into the combine.'),
      ('wolfpack', qid, 28292, 'A Living Fragment of Air',    1, false, 30, 'A Temple Guardian, Plane of Air (9%).'),
      ('wolfpack', qid, 28293, 'A Living Fragment of Water',  1, false, 40, 'The triloun, Plane of Water (9%).'),
      ('wolfpack', qid, 28294, 'A Living Fragment of Fire',   1, false, 50, 'The jopal, Plane of Fire (8%).'),
      ('wolfpack', qid, 28295, 'A Living Fragment of Earth',  1, false, 60, 'Earthcrafted assassins and Vekerchiki, Plane of Earth (9%).'),
      ('wolfpack', qid, 28297, 'Sealed Lined Case',           1, true,  70, 'The talisman and four fragments combined in the Small Lined Case. Handed to Elder Clinka.');
  end if;

  -- ── Secrets of the Planes ─────────────────────────────────────────────────────────────────────────────────────
  -- Three manual lines of three hand-ins each, then one hand-in to Tenada Jeried. Scripts, all in poknowledge/:
  --   Combat  Zauvudd_Gigoth.lua -> Xasri_Virek.lua    -> Gwiraba_Gelrid.lua
  --   Stealth Winon_Glahar.lua   -> Leramas_Feston.lua -> Ethoach_Trokith.lua
  --   Magic   Acomar_Lothwol.lua -> Cadelid_Etord.lua  -> Zalil_Nyvin.lua
  --   Finish  Tenada_Jeried.lua (the three advanced manuals and a Hope Stone, handed in together)
  -- Each beginner hand-in takes a Planar Traveler's Manual (Willamina.lua, for New Sewing Needles; the errand runs
  -- Oracle_Cador.lua -> Mirao_Frostpouch.lua -> Bolcen_Tendag.lua -> Willamina.lua), so three are needed in all.
  -- The crafted hand-ins (recipes 7775, 9117, 1997) are NO DROP and their combines can fail. The first and last
  -- hand-in of each line check for level 20 or higher.
  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'Secrets of the Planes (1/4) — Advanced Combat Manual') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'Secrets of the Planes (1/4) — Advanced Combat Manual', 'other',
            'Plane of Knowledge — Zauvudd Gigoth, Xasri Virek, Gwiraba Gelrid', 'https://www.pqdi.cc/item/28791',
            'Three hand-ins in the Plane of Knowledge. Beginner: a Planar Blood Brew and a Planar Traveler''s Manual to Zauvudd Gigoth. Intermediate: the Beginner Combat Manual and the Junk Beast Power Source to Xasri Virek. Advanced: the Intermediate Combat Manual, a Blue Diamond, a Rage Filled Gem and a Sandstorm Gem to Gwiraba Gelrid. The Planar Traveler''s Manual comes from Willamina for New Sewing Needles, and each of the three manual lines uses one up.',
            80, true, 28791, 'Advanced Combat Manual')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28745, 'Planar Traveler''s Manual',   1, true,  10, 'Beginner hand-in. From Willamina, Plane of Knowledge, for New Sewing Needles.'),
      ('wolfpack', qid, 28787, 'Planar Blood Brew',           1, true,  20, 'Beginner hand-in. NO DROP: brew it yourself (trivial 216; the combine can fail and makes three). Bloods from slarghilug and mephits in Nightmare and bubonians in Disease or the Crypt of Decay.'),
      ('wolfpack', qid, 28788, 'Beginner Combat Manual',      1, true,  30, 'From Zauvudd Gigoth. Handed to Xasri Virek.'),
      ('wolfpack', qid, 29145, 'Junk Beast Power Source',     1, true,  40, 'Intermediate hand-in. The Junk Beast, Plane of Innovation (always drops).'),
      ('wolfpack', qid, 28790, 'Intermediate Combat Manual',  1, false, 50, 'From Xasri Virek. Handed to Gwiraba Gelrid.'),
      ('wolfpack', qid, 22503, 'Blue Diamond',                1, false, 60, 'NO DROP. One for each of the three advanced manuals. Rare in many zones: Temple of Veeshan and Vex Thal about 5%, most planes about 3%.'),
      ('wolfpack', qid, 26697, 'Rage Filled Gem',             1, false, 70, 'NO DROP. Decorin, Gindan and named in Drunder, the Fortress of Zek (2.5%).'),
      ('wolfpack', qid, 9421,  'Sandstorm Gem',               1, false, 80, 'The jord giants, Bastion of Thunder (10%).');
  end if;

  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'Secrets of the Planes (2/4) — Advanced Stealth Manual') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'Secrets of the Planes (2/4) — Advanced Stealth Manual', 'other',
            'Plane of Knowledge — Winon Glahar, Leramas Feston, Ethoach Trokith', 'https://www.pqdi.cc/item/28794',
            'Three hand-ins in the Plane of Knowledge. Beginner: a Planar Peridot Encrusted Stein and a Planar Traveler''s Manual to Winon Glahar. Intermediate: the Beginner Stealth Manual and Rattican''s Head to Leramas Feston. Advanced: the Intermediate Stealth Manual, a Blue Diamond, a Blizzard Gem and a Symbol of the Diaku to Ethoach Trokith.',
            81, true, 28794, 'Advanced Stealth Manual')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28745, 'Planar Traveler''s Manual',        1, true,  10, 'Beginner hand-in. From Willamina, Plane of Knowledge, for New Sewing Needles.'),
      ('wolfpack', qid, 29168, 'Planar Peridot Encrusted Stein',   1, true,  20, 'Beginner hand-in. NO DROP: pottery, three combines (the unfired stein is trivial 216 and can fail). Needs Valor Crystals (Plane of Valor, 10%) and a Lacquered Peridot.'),
      ('wolfpack', qid, 28792, 'Beginner Stealth Manual',          1, true,  30, 'From Winon Glahar. Handed to Leramas Feston.'),
      ('wolfpack', qid, 29133, 'Rattican''s Head',                 1, true,  40, 'Intermediate hand-in. Rallius Rattican, Plane of Disease (always drops).'),
      ('wolfpack', qid, 28793, 'Intermediate Stealth Manual',      1, false, 50, 'From Leramas Feston. Handed to Ethoach Trokith.'),
      ('wolfpack', qid, 22503, 'Blue Diamond',                     1, false, 60, 'NO DROP. One for each of the three advanced manuals.'),
      ('wolfpack', qid, 9423,  'Blizzard Gem',                     1, false, 70, 'The vann giants, Bastion of Thunder (10%).'),
      ('wolfpack', qid, 26709, 'Symbol of the Diaku',              1, false, 80, 'NO DROP. The Diaku in Drunder, the Fortress of Zek (2%).');
  end if;

  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'Secrets of the Planes (3/4) — Advanced Magic Manual') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'Secrets of the Planes (3/4) — Advanced Magic Manual', 'other',
            'Plane of Knowledge — Acomar Lothwol, Cadelid Etord, Zalil Nyvin', 'https://www.pqdi.cc/item/28797',
            'Three hand-ins in the Plane of Knowledge. Beginner: a Hobgoblin Surprise and a Planar Traveler''s Manual to Acomar Lothwol. Intermediate: the Beginner Magic Manual and the Heart of Vhaksiz to Cadelid Etord. Advanced: the Intermediate Magic Manual, a Blue Diamond, a Tornado Gem and a Battle Worn Trinket to Zalil Nyvin.',
            82, true, 28797, 'Advanced Magic Manual')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28745, 'Planar Traveler''s Manual',   1, true,  10, 'Beginner hand-in. From Willamina, Plane of Knowledge, for New Sewing Needles.'),
      ('wolfpack', qid, 29751, 'Hobgoblin Surprise',          1, true,  20, 'Beginner hand-in. NO DROP: bake it yourself (trivial 302; the combine can fail). Hobgoblin Meat from the hobgoblins in Nightmare (20%).'),
      ('wolfpack', qid, 28795, 'Beginner Magic Manual',       1, true,  30, 'From Acomar Lothwol. Handed to Cadelid Etord.'),
      ('wolfpack', qid, 28801, 'Heart of Vhaksiz',            1, true,  40, 'Intermediate hand-in. Vhaksiz the Shade, Plane of Nightmare (always drops).'),
      ('wolfpack', qid, 28796, 'Intermediate Magic Manual',   1, false, 50, 'From Cadelid Etord. Handed to Zalil Nyvin.'),
      ('wolfpack', qid, 22503, 'Blue Diamond',                1, false, 60, 'NO DROP. One for each of the three advanced manuals.'),
      ('wolfpack', qid, 9424,  'Tornado Gem',                 1, false, 70, 'The vind giants, Bastion of Thunder (10%).'),
      ('wolfpack', qid, 26710, 'Battle Worn Trinket',         1, false, 80, 'NO DROP. The Diaku in Drunder, the Fortress of Zek (2%).');
  end if;

  if not exists (select 1 from quest_catalog where guild_id = 'wolfpack'
                 and name = 'Secrets of the Planes (4/4)') then
    insert into quest_catalog (guild_id, name, category, zone, pqdi_quest_url, notes, display_order, active,
                               reward_item_id, reward_item_name)
    values ('wolfpack', 'Secrets of the Planes (4/4)', 'other',
            'Plane of Knowledge — Tenada Jeried', 'https://www.pqdi.cc/item/28798',
            'Tell Tenada Jeried you are "interested in learning", then hand him the three advanced manuals and a Hope Stone together. Secrets of the Planes: 20 AC, 100 HP and mana, +15 to six stats, +10 all resists, +15 attack, with the Conservation of Solusek focus.',
            83, true, 28798, 'Secrets of the Planes')
    returning id into qid;
    insert into quest_required_item (guild_id, quest_id, item_id, item_name, quantity, optional, display_order, notes) values
      ('wolfpack', qid, 28791, 'Advanced Combat Manual',   1, false, 10, 'From Gwiraba Gelrid (part 1).'),
      ('wolfpack', qid, 28794, 'Advanced Stealth Manual',  1, false, 20, 'From Ethoach Trokith (part 2).'),
      ('wolfpack', qid, 28797, 'Advanced Magic Manual',    1, false, 30, 'From Zalil Nyvin (part 3).'),
      ('wolfpack', qid, 16258, 'Hope Stone',               1, false, 40, 'Drops in all four elemental planes: Air, Water, Fire and Earth (25% from most mobs).');
  end if;
end $$;
