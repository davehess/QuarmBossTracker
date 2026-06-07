-- opendkp_loot dedup index — PostgREST on_conflict can't match the existing
-- partial-coalesce expression index (opendkp_loot_dedup), so the bot's
-- upsert call has been 400'ing on every sync:
--   "there is no unique or exclusion constraint matching the ON CONFLICT
--    specification"
--
-- Add a plain unique index over the columns PostgREST sees directly. Use
-- NULLS NOT DISTINCT so rows where game_item_id IS NULL still dedup against
-- each other (PG 15+ behavior, Supabase is 15+).

create unique index if not exists opendkp_loot_dedup_plain
  on opendkp_loot (raid_id, game_item_id, character_name, dkp)
  nulls not distinct;
