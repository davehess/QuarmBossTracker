-- Per-character checksum columns so the Mimic auto-uploaders can dedup at the
-- bot: when an agent reruns scanInventoryFiles / scanSpellbookFiles and the
-- export's checksum matches the column, the bot returns skipped=unchanged
-- without touching character_inventory / character_spellbook. Mirrors the
-- existing quarmy_checksum column.
alter table characters add column if not exists inventory_checksum text;
alter table characters add column if not exists spellbook_checksum text;
