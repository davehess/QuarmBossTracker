-- zone_outline(zone) — a rough map of a zone drawn from the server's own placement data, for the
-- PoP guide's step maps (the guild lead, 2026-09-29: "the pop guide page needs some love. more detail,
-- maps, who to turn things into…").
--
-- No map files are borrowed: every placed spawn point, door, ground spawn and object in the zone is
-- snapped to a grid (about 56 cells across the zone's 1st–99th percentile extent, so a stray far-away
-- point cannot shrink the rest), and the occupied cell centres are the outline. Doors that lead to
-- another zone (the Plane of Knowledge books, the Bastion of Thunder stone in Storms) come back
-- separately as zone-in markers. Coordinates are EQ's own x/y; /loc and Zeal's /map print Y then X.
--
-- Read-only and small (a few hundred points); the site caches it per zone for a day.

create or replace function public.zone_outline(p_zone text, p_cells int default 56)
returns jsonb
language sql
stable
set search_path = public
as $$
  with zn as (select zone_id from eqemu_zone where short_name = p_zone limit 1),
  pts as (
    select x, y from eqemu_spawn2 where zone_short = p_zone
    union all select pos_x, pos_y from eqemu_doors where zone = p_zone
    union all select (g.max_x + g.min_x) / 2, (g.max_y + g.min_y) / 2 from eqemu_ground_spawns g where g.zoneid = (select zone_id from zn)
    union all select o.xpos, o.ypos from eqemu_object o where o.zoneid = (select zone_id from zn)
  ),
  b as (
    select percentile_cont(0.01) within group (order by x) x0, percentile_cont(0.99) within group (order by x) x1,
           percentile_cont(0.01) within group (order by y) y0, percentile_cont(0.99) within group (order by y) y1
    from pts
  ),
  c as (select x0, x1, y0, y1, greatest(greatest(x1 - x0, y1 - y0) / greatest(p_cells, 8), 1) cell from b),
  cells as (
    select distinct floor(p.x / c.cell)::int cx, floor(p.y / c.cell)::int cy, c.cell
    from pts p, c
    where p.x between c.x0 - c.cell * 2 and c.x1 + c.cell * 2
      and p.y between c.y0 - c.cell * 2 and c.y1 + c.cell * 2
  )
  select jsonb_build_object(
    'zone', p_zone,
    'cell', (select round(cell)::int from c),
    'pts', coalesce((select jsonb_agg(jsonb_build_array(round((cx + 0.5) * cell)::int, round((cy + 0.5) * cell)::int)) from cells), '[]'::jsonb),
    'doors', coalesce((
      select jsonb_agg(jsonb_build_object('x', round(d.pos_x)::int, 'y', round(d.pos_y)::int, 'to', d.dest_zone, 'name', z.long_name))
      from eqemu_doors d left join eqemu_zone z on z.short_name = d.dest_zone
      where d.zone = p_zone and d.dest_zone is not null and d.dest_zone not in ('NONE', '') and d.dest_zone <> p_zone
    ), '[]'::jsonb)
  );
$$;

grant execute on function public.zone_outline(text, int) to anon, authenticated, service_role;
