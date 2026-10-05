-- 20261005020000_raid_track_minutes.sql
-- One row per guild per UTC minute of where the raid was standing, so a raid can be replayed later on
-- wolfpack.quest/spectator.
--
-- Why it exists: raid_roster keeps only the LATEST row per (guild, uploader, raider), so the moment a
-- raider moves the last position is gone. Every Mimic uploader posts the roster every ~4 s with ~50
-- members, ~25 uploaders at once, which is far too much to keep row by row. utils/raidTrack.js folds
-- those uploads into one sample per raider every few seconds (RAID_TRACK_STEP_S, default 3) and writes
-- the finished minute here as ONE row: ~20 frames of ~50 raiders, a few KB of compact JSON.
--
-- `data` is TEXT, not jsonb, on purpose: it is a long array of small integers, which Postgres stores
-- about 3x smaller as text under TOAST compression than as jsonb. Format (v 1):
--   { v: 1, step_s: <frame spacing>,
--     who:   [[name, class, group, level], ...],          index i; last-seen values in the minute
--     zones: ['zoneshort', ...],                           index zi; a raider with no known zone has zi -1
--     f: [[dt, i,x,y,z,h,hp,zi,  i,x,y,z,h,hp,zi, ...], ...] }   one array per frame
--   dt = whole seconds since minute_at (0-59); x/y/z/h are integers; hp is a whole percent, -1 unknown;
--   h is -1 when the heading was not sent (a real heading is 0-512).
--
-- The frame: x = raid_roster.loc_x and y = raid_roster.loc_y EXACTLY as received. The zone map is in the
-- SERVER frame, which is these two swapped, so the web's serverXY (web/lib/spectator.ts) does the swap
-- when it plots a raider; nothing is swapped on the way in. A raider who is in a different zone from the
-- uploader arrives as (0, 0, 0) and is never recorded.
--
-- Zones: raid_roster has no zone column, so the bot stamps one per sample at flush time from
-- character_live_state (the raider's own live zone, else the zone most of that uploader's raiders are
-- in, else the zone most of the raid is in), mapped to eqemu_zone.short_name.
--
-- Privacy: a character with characters.exclude_from_stats = true is never written.
--
-- Retention: every raid is kept (the guild lead, 2026-10-05), and the Tower archive keeps its own copy
-- forever (scripts/lib/archive-merge.sql). RAID_TRACK_RETENTION_DAYS turns a nightly sweep on, which
-- deletes only minutes Tower already holds. The sweep filters on minute_at, which is why that column
-- leads its own index: the threat-snapshot sweep never worked because its predicate had no usable
-- index and the delete seq-scanned the table.
--
-- Access: service_role only. RLS is on with no policy, so neither anon nor authenticated can read it;
-- the spectator route reads with the service key after its own signed-in check. Idempotent.

create table if not exists public.raid_track_minutes (
  guild_id   text        not null,
  minute_at  timestamptz not null,   -- start of the UTC minute
  night_key  text,                   -- utils/raidNight.js nightKey(minute_at)
  raiders    integer     not null default 0,
  frames     integer     not null default 0,
  zones      text[]      not null default '{}',
  data       text        not null,   -- compact JSON, see the format above
  created_at timestamptz not null default now(),
  primary key (guild_id, minute_at)
);

create index if not exists raid_track_minutes_minute_at_idx on public.raid_track_minutes (minute_at);
create index if not exists raid_track_minutes_night_idx on public.raid_track_minutes (guild_id, night_key);

alter table public.raid_track_minutes enable row level security;
