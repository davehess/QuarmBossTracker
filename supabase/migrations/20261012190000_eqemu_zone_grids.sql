-- eqemu_zone_grids — the server's pather routes, one row per zone (the guild lead, 2026-10-12: "the pathers
-- are also ones to select. did we find their path data?"). The Quarm dump carries them as `grid`
-- (22,824 rows) and `grid_entries` (711,517 waypoints); eqemu_spawn2.pathgrid names the grid a spawn point
-- walks, and a grid id is only unique inside its zone, so the key here is the zone.
--
-- Stored as ONE jsonb document per zone instead of 711k plain rows: nothing ever reads a single waypoint, a
-- whole zone's routes are read together (the bot's GET /api/agent/zone-spawns), and database size is the
-- cost that only ever grows (CLAUDE.md, Supabase). Weekly sync builds the document
-- (scripts/sync-from-eqmac.js, buildZoneGrids) and upserts the rows.
--
--   grids = { "<gridid>": { "type": int, "type2": int, "pts": [[x, y, z, pause], ...] } }
--
-- pts are ordered by grid_entries.number, x/y/z rounded to 1 decimal (the server's frame, as stored in
-- spawn2), pause in seconds. type is the grid's movement kind (0 circular, 3 patrol back-and-forth,
-- 4/6 one-way, 1/2/5/8/9 random waypoint); type2 is kept verbatim.
--
-- Tier 1 catalog convention: readable by anon + authenticated, written by the service role only.

create table if not exists public.eqemu_zone_grids (
  zoneid      integer primary key,        -- eqemu_zone.zone_id (the dump's grid.zoneid)
  zone_short  text,                       -- eqemu_zone.short_name; null when the dump names a zone the mirror lacks
  grids       jsonb not null,
  updated_at  timestamptz not null default now()
);

create index if not exists eqemu_zone_grids_zone_short_idx on public.eqemu_zone_grids (zone_short);

alter table public.eqemu_zone_grids enable row level security;
drop policy if exists eqemu_zone_grids_read on public.eqemu_zone_grids;
create policy eqemu_zone_grids_read on public.eqemu_zone_grids for select to anon, authenticated using (true);
grant select on public.eqemu_zone_grids to anon, authenticated;
grant all on public.eqemu_zone_grids to service_role;
