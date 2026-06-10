-- Concurrent raids: store rosters PER UPLOADER instead of one flat row per
-- member. With pk (guild,name), two raids running at once (each with its own
-- Mimics uploading Zeal type-5 snapshots) merged into one fake mega-raid on
-- /raid and in the buff queue. Each uploader now keeps their own full
-- snapshot; readers cluster snapshots that share members into distinct raids
-- (Raid 1 / Raid 2 tabs) and the buff queue scopes to the buffer's own raid.
--
-- The table is an ephemeral live view (15-min read window, 10s heartbeats) —
-- clearing it during the key change loses nothing.

delete from public.raid_roster;

alter table public.raid_roster
  alter column uploaded_by_discord_id set default '';
update public.raid_roster set uploaded_by_discord_id = '' where uploaded_by_discord_id is null;
alter table public.raid_roster
  alter column uploaded_by_discord_id set not null;

alter table public.raid_roster drop constraint if exists raid_roster_pkey;
alter table public.raid_roster
  add primary key (guild_id, uploaded_by_discord_id, name);
