-- 20261005010000_zone_map_lines.sql
-- Cache of the flat wall lines the members-only spectator map draws, one row per zone.
--
-- Why it exists: the lines are DERIVED data. /api/spectator/map slices a zone's EQEmu server
-- collision mesh (web/lib/zoneMap/slice.ts) the first time anyone asks for the zone and stores the
-- result here, so every later request is a single row read instead of a 1-2 MB download from GitHub
-- plus a slice. Each row is ~70 KB of jsonb (a few thousand [x1,y1,x2,y2,band] segments); at most
-- ~178 Quarm-era zones, so ~12 MB worst case, which is nothing against the 8 GB database. Rows are
-- never pruned; a zone can be re-sliced by deleting its row.
--
-- Licence: the source meshes are EQEmu/maps (https://github.com/EQEmu/maps), GPLv2-or-later,
-- "Copyright (C) 2004-2009 EQEmulator.NET, AX-Classic, and ProjectEQ". The segments are derived
-- from them and carry the same licence, which is why `source` and `license` are required columns
-- and the API echoes the source on every response.
--
-- Coordinates are in the SERVER frame (the same axes as eqemu_spawn2 x/y). raid_roster / pipe
-- (loc_x, loc_y) are server (y, x), so the page swaps when plotting a raider.
--
-- Signed-in members may read it; writes are the web route's only (service_role bypasses RLS), so
-- there is deliberately no insert/update/delete policy. Idempotent.

create table if not exists public.zone_map_lines (
  zone_short   text        primary key,
  source       text        not null,
  license      text        not null,
  bands        jsonb       not null,
  segs         jsonb       not null,
  bounds       jsonb       not null,
  seg_count    int         not null,
  generated_at timestamptz not null default now()
);

alter table public.zone_map_lines enable row level security;

drop policy if exists zone_map_lines_read on public.zone_map_lines;
create policy zone_map_lines_read on public.zone_map_lines
  for select to authenticated using (true);
