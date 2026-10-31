-- When did each of a character's three uploads last ARRIVE, as distinct from when its content last CHANGED.
-- The guild lead, 2026-10-31: "add last upload timestamp for spells, inventory, gear".
--
-- The three Mimic auto-uploaders (gear/Quarmy, inventory, spellbook) checksum-dedup at the bot and return early
-- on an unchanged file, writing nothing. So quarmy_synced_at and the tables' observed_at / updated_at have always
-- meant "last changed", and a character whose file has not changed in a month looked like it had stopped uploading.
--   <x>_checked_at  last time an accepted upload arrived, changed or not (written on the unchanged path too)
--   <x>_synced_at   last time the content actually changed (quarmy_synced_at already exists)
-- Mirrors quarmy_checksum / inventory_checksum / spellbook_checksum, which sit on the same row.
alter table characters add column if not exists quarmy_checked_at    timestamptz;
alter table characters add column if not exists inventory_checked_at timestamptz;
alter table characters add column if not exists spellbook_checked_at timestamptz;
alter table characters add column if not exists inventory_synced_at  timestamptz;
alter table characters add column if not exists spellbook_synced_at  timestamptz;

-- Backfill the two new synced_at columns from the snapshot tables. Both key a character by (guild_id, lower(name)),
-- the same as their unique indexes, and every row of a snapshot is written in one upload, so max(observed_at) is that
-- upload's time. Only fills a null, so a re-run never overwrites a value the bot has since written.
update characters c
   set inventory_synced_at = m.last_seen
  from (select guild_id, lower(character_name) as lname, max(observed_at) as last_seen
          from character_inventory group by guild_id, lower(character_name)) m
 where c.guild_id = m.guild_id
   and lower(c.name) = m.lname
   and c.inventory_synced_at is null;

update characters c
   set spellbook_synced_at = m.last_seen
  from (select guild_id, lower(character_name) as lname, max(observed_at) as last_seen
          from character_spellbook group by guild_id, lower(character_name)) m
 where c.guild_id = m.guild_id
   and lower(c.name) = m.lname
   and c.spellbook_synced_at is null;
