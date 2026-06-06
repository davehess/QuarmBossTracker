-- loot_observations + winner_character / dkp_amount / raid_id
--
-- A re-run of /backfillopendkploot was double-inserting because the dedup key
-- (source, npc_id, item_id, posted_at) (a) compared posted_at strings across
-- JS Date.toISOString() ("2025-02-27T12:00:00.000Z") and PostgREST's pretty-
-- print ("2025-02-27 12:00:00+00") which never match, and (b) couldn't tell
-- two legit awards of the same item in one raid apart. Adding the OpenDKP
-- winner + DKP + raid_id gives us a true award identity for dedup; the new
-- code uses Date.parse() on both sides of the key compare so format drift
-- stops being an issue.
alter table public.loot_observations
  add column if not exists winner_character text,
  add column if not exists dkp_amount       int,
  add column if not exists raid_id          int;
create index if not exists loot_observations_raid_idx
  on public.loot_observations (guild_id, raid_id) where raid_id is not null;
