-- 20261007000000_my_parse_series_v2.sql
-- my_parse_series_v2: my_parse_series plus a zone filter and a mob search, and each fight's zone (the guild lead,
-- 2026-10-06: "can you make it so that I can explore more in the fights section? chop it up by days,
-- zones, mobs, search bar, etc." — option A, filters on the list).
--
-- Changes from 20261006210000_my_parse_series_char_tiers.sql:
--   * two new parameters, both optional: p_zone (zone id, = npc id / 1000, the catalog's encoding) and
--     p_search (case-insensitive substring of the mob's name, underscores read as spaces);
--   * every fight carries `zone_id` and `zone` (eqemu_zone.long_name);
--   * two facets for the pickers, computed over the window and the Bosses/Everything scope BEFORE the zone
--     and search filters, so a picker never empties itself: `zones` [{id, name, fights}] and `mobs`
--     [{name, fights}] (the 300 most fought);
--   * fights, nights, total and usual all follow the filters.
-- A NEW name, not a replacement: adding parameters with defaults to my_parse_series would leave two
-- overloads that a call by name could both match, and dropping the old one is a destructive statement
-- (refused unconfirmed on 2026-10-07). The bot route and /me/parses move to v2; my_parse_series stays
-- until nothing calls it, then a session with confirmation can drop it.
--
-- Same rules otherwise (see the two earlier migrations): service_role only; the person's characters are
-- resolved inside from the caller's discord id; hidden characters (Hide from lists / Trader) are left out
-- of "all my characters"; every window is floored at the 2026-07-14 median-merge cutover.

create or replace function public.my_parse_series_v2(
  p_discord_id  text,
  p_since       timestamptz default null,
  p_until       timestamptz default null,
  p_bosses_only boolean     default true,
  p_character   text        default null,
  p_cap         int         default 400,
  p_zone        int         default null,
  p_search      text        default null
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with
  root as (
    select coalesce(
      (select m.merged_into_discord_id from wolfpack_members m
        where m.discord_id = p_discord_id and m.merged_into_discord_id is not null limit 1),
      p_discord_id) as id
  ),
  household as (
    select p_discord_id as id
    union select id from root
    union select m.discord_id from wolfpack_members m, root r
           where m.discord_id = r.id or m.merged_into_discord_id = r.id
  ),
  roots as (
    select distinct lower(coalesce(c.main_name, c.name)) as fam
    from characters c
    where c.guild_id = 'wolfpack' and c.discord_id in (select id from household where id is not null)
  ),
  fam as (
    select c.name, c.class, coalesce(c.active, false) as active,
           (coalesce(c.hidden_from_lists, false) or lower(trim(coalesce(c.rank, ''))) = 'trader') as hidden
    from characters c
    where c.guild_id = 'wolfpack'
      and lower(coalesce(c.main_name, c.name)) in (select fam from roots)
      and not coalesce(c.exclude_from_stats, false)
  ),
  allrows as (
    select e.id as eid, e.started_at as t, e.npc_id, ep.character_name as ch,
           ep.dps, ep.total_damage as dmg, ep.duration_sec as dur, ep.rank,
           (e.npc_id in (select npc_id from bosses_local where auto_registered = false and npc_id is not null)) as boss,
           (e.npc_id / 1000) as zone_id,
           trim(replace(regexp_replace(coalesce(n.name, ''), '^#', ''), '_', ' ')) as mob
    from encounter_players ep
    join encounters e on e.id = ep.encounter_id
    left join eqemu_npc_types n on n.id = e.npc_id
    where ep.character_name in (select name from fam)
      and e.started_at >= '2026-07-14T00:00:00Z'::timestamptz
      and e.classification is null
      and ep.total_damage > 0 and ep.dps > 0
      and (ep.duration_sec is null or ep.duration_sec <= 2700)
  ),
  names as (
    select name from fam
    where (p_character is null and not hidden) or lower(name) = lower(p_character)
  ),
  base as (
    select * from allrows where ch in (select name from names)
  ),
  inwin as (
    select * from allrows
    where t >= greatest(coalesce(p_since, '2026-07-14T00:00:00Z'::timestamptz), '2026-07-14T00:00:00Z'::timestamptz)
      and (p_until is null or t < p_until)
  ),
  -- The window and the Bosses/Everything scope: what the pickers list.
  scoped as (
    select * from base
    where t >= greatest(coalesce(p_since, '2026-07-14T00:00:00Z'::timestamptz), '2026-07-14T00:00:00Z'::timestamptz)
      and (p_until is null or t < p_until)
      and (boss or not coalesce(p_bosses_only, true))
  ),
  -- …and the zone and search filters on top: what the chart and the list show.
  sel as (
    select * from scoped
    where (p_zone is null or zone_id = p_zone)
      and (nullif(trim(coalesce(p_search, '')), '') is null
           or mob ilike '%' || replace(replace(replace(trim(p_search), '\', '\\'), '%', '\%'), '_', ' ') || '%')
  ),
  usual as (
    select ch, npc_id,
           round(percentile_cont(0.5) within group (order by dps))::int as med,
           count(*) as n
    from base
    where npc_id in (select npc_id from sel)
    group by ch, npc_id
  ),
  capped as (
    select * from sel
    order by t desc, eid
    limit greatest(1, least(coalesce(p_cap, 400), 2000))
  ),
  nights as (
    select ((t at time zone 'America/New_York') - interval '6 hours')::date as night,
           count(*)::int                    as fights,
           (count(*) filter (where boss))::int as bosses,
           round(avg(dps))::int             as avg_dps,
           max(dps)::int                    as best_dps
    from sel
    group by 1
  ),
  zone_facet as (
    select s.zone_id as id, coalesce(z.long_name, z.short_name, 'Zone ' || s.zone_id) as name, count(*)::int as fights
    from scoped s left join eqemu_zone z on z.zone_id = s.zone_id
    group by s.zone_id, z.long_name, z.short_name
  ),
  mob_facet as (
    select mob as name, count(*)::int as fights
    from scoped where mob <> ''
    group by mob
    order by count(*) desc, mob
    limit 300
  )
  select jsonb_build_object(
    'floor',      '2026-07-14T00:00:00Z',
    'characters', coalesce((
      select jsonb_agg(jsonb_build_object(
               'name',   f.name,
               'class',  f.class,
               'active', f.active,
               'hidden', f.hidden,
               'fights', (select count(*) from inwin w where w.ch = f.name),
               'recent', (select count(*) from allrows a where a.ch = f.name and a.t >= now() - interval '30 days')
             ) order by f.active desc, f.name)
      from fam f), '[]'::jsonb),
    'total',      (select count(*) from sel),
    'truncated',  (select count(*) from sel) > greatest(1, least(coalesce(p_cap, 400), 2000)),
    'fights',     coalesce((
      select jsonb_agg(jsonb_build_object(
               't',       c.t,
               'eid',     c.eid,
               'npc_id',  c.npc_id,
               'name',    c.mob,
               'zone_id', c.zone_id,
               'zone',    coalesce(z.long_name, z.short_name),
               'boss',    c.boss,
               'char',    c.ch,
               'dps',     c.dps,
               'dmg',     c.dmg,
               'dur',     c.dur,
               'rank',    c.rank,
               'usual',   case when u.n >= 3 then u.med end
             ) order by c.t, c.eid)
      from capped c
      left join eqemu_zone z on z.zone_id = c.zone_id
      left join usual u on u.ch = c.ch and u.npc_id = c.npc_id), '[]'::jsonb),
    'nights',     coalesce((select jsonb_agg(to_jsonb(x) order by x.night) from nights x), '[]'::jsonb),
    'zones',      coalesce((select jsonb_agg(to_jsonb(zf) order by zf.fights desc, zf.name) from zone_facet zf), '[]'::jsonb),
    'mobs',       coalesce((select jsonb_agg(to_jsonb(mf) order by mf.fights desc, mf.name) from mob_facet mf), '[]'::jsonb)
  );
$$;

revoke all on function public.my_parse_series_v2(text, timestamptz, timestamptz, boolean, text, int, int, text) from public;
revoke all on function public.my_parse_series_v2(text, timestamptz, timestamptz, boolean, text, int, int, text) from anon, authenticated;
grant execute on function public.my_parse_series_v2(text, timestamptz, timestamptz, boolean, text, int, int, text) to service_role;
