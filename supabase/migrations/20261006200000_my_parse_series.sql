-- 20261006200000_my_parse_series.sql
-- "Graph my parses over a window" (a member asked 2026-10-06; the guild lead picked
-- A — a My parses tab in Mimic — and C — wolfpack.quest/me/parses). Both read
-- this one function, so the tab and the page always show the same numbers.
--
-- my_parse_series(p_discord_id, p_since, p_until, p_bosses_only, p_character, p_cap)
--   p_discord_id   the SIGNED-IN person, resolved by the caller from its own
--                  session (the bot from the Mimic token's identity, the web
--                  from auth.users → wolfpack_members). Never a value from a
--                  request body. That is why this is granted to service_role
--                  only: a client must not be able to ask for someone else.
--   p_since/until  the window; null since = lifetime. Always floored at the
--                  median-merge cutover (2026-07-14): older multi-uploader rows
--                  were max-merged and can double, and their raw parses are
--                  pruned, so they cannot be fixed (same floor as /leaderboards).
--   p_bosses_only  true = curated bosses (bosses_local.auto_registered = false);
--                  false = every fight, trash included.
--   p_character    null = all of the person's characters, else one of them
--                  (case-insensitive). A name outside the family returns nothing.
--   p_cap          newest N fights returned (default 400, at most 2000). The
--                  `nights` summary always covers the WHOLE window.
--
-- "My characters" mirrors loadOwnedCharacters in web/app/me/page.tsx: the
-- household (wolfpack_members.merged_into_discord_id aliases), the characters
-- anchored to any household id, then their whole family by main_name. Excluded
-- characters (exclude_from_stats) are left out, as /me leaves them out.
--
-- Every fight in scope also carries `usual`: that character's median DPS on that
-- same NPC across all post-cutover fights (not just the window), when there are
-- at least three. Raw DPS mostly says how hard the boss was; usual is what the
-- chart compares against.
--
-- Returns ONE jsonb value, so PostgREST's 1,000-row cap cannot cut it
-- (20261004140600_cap_safe_me.sql). Security invoker, stable, search_path
-- pinned. Idempotent.

create or replace function public.my_parse_series(
  p_discord_id  text,
  p_since       timestamptz default null,
  p_until       timestamptz default null,
  p_bosses_only boolean     default true,
  p_character   text        default null,
  p_cap         int         default 400
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
    select c.name, c.class, coalesce(c.active, false) as active
    from characters c
    where c.guild_id = 'wolfpack'
      and lower(coalesce(c.main_name, c.name)) in (select fam from roots)
      and not coalesce(c.exclude_from_stats, false)
  ),
  names as (
    select name from fam
    where p_character is null or lower(name) = lower(p_character)
  ),
  curated as (
    select npc_id from bosses_local where auto_registered = false and npc_id is not null
  ),
  -- Every comparable post-cutover row for these characters, read once.
  base as (
    select e.id as eid, e.started_at as t, e.npc_id, ep.character_name as ch,
           ep.dps, ep.total_damage as dmg, ep.duration_sec as dur, ep.rank,
           (e.npc_id in (select npc_id from curated)) as boss
    from encounter_players ep
    join encounters e on e.id = ep.encounter_id
    where ep.character_name in (select name from names)
      and e.started_at >= '2026-07-14T00:00:00Z'::timestamptz
      and e.classification is null
      and ep.total_damage > 0 and ep.dps > 0
      and (ep.duration_sec is null or ep.duration_sec <= 2700)
  ),
  sel as (
    select * from base
    where t >= greatest(coalesce(p_since, '2026-07-14T00:00:00Z'::timestamptz), '2026-07-14T00:00:00Z'::timestamptz)
      and (p_until is null or t < p_until)
      and (boss or not coalesce(p_bosses_only, true))
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
  )
  select jsonb_build_object(
    'floor',      '2026-07-14T00:00:00Z',
    'characters', coalesce((select jsonb_agg(jsonb_build_object('name', f.name, 'class', f.class, 'active', f.active)
                                             order by f.active desc, f.name) from fam f), '[]'::jsonb),
    'total',      (select count(*) from sel),
    'truncated',  (select count(*) from sel) > greatest(1, least(coalesce(p_cap, 400), 2000)),
    'fights',     coalesce((
      select jsonb_agg(jsonb_build_object(
               't',     c.t,
               'eid',   c.eid,
               'npc_id', c.npc_id,
               'name',  trim(replace(regexp_replace(coalesce(n.name, ''), '^#', ''), '_', ' ')),
               'boss',  c.boss,
               'char',  c.ch,
               'dps',   c.dps,
               'dmg',   c.dmg,
               'dur',   c.dur,
               'rank',  c.rank,
               'usual', case when u.n >= 3 then u.med end
             ) order by c.t, c.eid)
      from capped c
      left join eqemu_npc_types n on n.id = c.npc_id
      left join usual u on u.ch = c.ch and u.npc_id = c.npc_id), '[]'::jsonb),
    'nights',     coalesce((select jsonb_agg(to_jsonb(x) order by x.night) from nights x), '[]'::jsonb)
  );
$$;

revoke all on function public.my_parse_series(text, timestamptz, timestamptz, boolean, text, int) from public;
revoke all on function public.my_parse_series(text, timestamptz, timestamptz, boolean, text, int) from anon, authenticated;
grant execute on function public.my_parse_series(text, timestamptz, timestamptz, boolean, text, int) to service_role;
