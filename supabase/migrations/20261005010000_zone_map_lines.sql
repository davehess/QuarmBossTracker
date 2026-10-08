-- 20261005010000_zone_map_lines.sql
-- Cache of the two map layers the members-only spectator map draws, one row per zone.
--
-- Why it exists: both layers are fetched from public sources and DERIVED/parsed, and the first request
-- for a zone does that work (a 1-2 MB EQEmu mesh download plus a slice, and a few Zeal text files).
-- /api/spectator/map stores the result here, so every later request is a single row read. A row is
-- ~70 KB for the EQEmu walls plus ~100 KB for the Brewall art (the largest zone is ~440 KB); at most ~180
-- Quarm-era zones, so ~30 MB worst case, which is nothing against the 8 GB database. Rows are never
-- pruned; a zone can be re-fetched by deleting its row.
--
-- The two layers (each nullable: null means that source has no map for the zone):
--   bands, segs, bounds, seg_count, source, license
--       EQEmu wall lines sliced from the server collision mesh (EQEmu/maps, base/<zone>.map).
--       Licence: GPLv2-or-later, "Copyright (C) 2004-2009 EQEmulator.NET, AX-Classic, and
--       ProjectEQ". The segments are derived from it and carry the same licence, which is why
--       `source` and `license` are stored beside them.
--   brewall
--       {lines, labels, bounds}: Brewall's EverQuest maps as shipped in Zeal's public repo
--       (coastalredwood/Zeal, Zeal/zone_map_src/map_files). This is third-party map art with NO STATED
--       LICENCE. It is kept in this members-only table, served only through the Discord-gated
--       sign-in, and never committed to this public repo (the guild lead's call, 2026-10-05).
--
-- Coordinates are in the SERVER frame (the same axes as eqemu_spawn2 x/y) for both layers; Brewall's
-- files store negated x/y and are flipped on the way in. raid_roster / pipe (loc_x, loc_y) are
-- server (y, x), so the page swaps when plotting a raider.
--
-- Read access: service_role only. RLS is on and there is deliberately NO policy for `authenticated`.
-- The sign-in callback is what checks guild membership, and a Discord account can sign in to the
-- Supabase project directly and get an `authenticated` session without ever passing it, so an
-- `authenticated` read policy would hand the Brewall art to any Discord user. The route reads with the
-- service key after its own signed-in check. Writes are the route's only. Idempotent.

create table if not exists public.zone_map_lines (
  zone_short   text        primary key,
  source       text,
  license      text,
  bands        jsonb,
  segs         jsonb,
  bounds       jsonb,
  seg_count    int,
  brewall      jsonb,
  generated_at timestamptz not null default now()
);

alter table public.zone_map_lines enable row level security;

-- An earlier draft of this migration granted `authenticated` a read policy; make sure none survives.
drop policy if exists zone_map_lines_read on public.zone_map_lines;
