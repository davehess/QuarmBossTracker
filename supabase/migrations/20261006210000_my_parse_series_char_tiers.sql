-- 20261006210000_my_parse_series_char_tiers.sql
-- my_parse_series: the character list stops showing mules and traders (the guild lead, 2026-10-06, looking
-- at ~50 chips in Mimic's My parses tab: "I need to be able to either set these other watched logs to
-- non-combat/inventory only or we should be able to see that they don't have recent combat and hide them.
-- My expectation on this list is mains and real alts.").
--
-- Same signature and return shape as 20261006200000_my_parse_series.sql; only `characters` and the
-- "all my characters" set change:
--   * each character carries `fights` (fights in this window, bosses AND trash, so the chip list does not
--     change with the Bosses/Everything switch), `recent` (fights in the last 30 days) and `hidden`;
--   * `hidden` = the owner's own switch on /me ("Hide from lists": hidden from everything but account
--     inventory, characters.hidden_from_lists) or the guild rank Trader, the same rule as
--     web/lib/listableChars.ts (§140). The level-under-46 half of that rule is left out: a character that
--     fought is shown whatever its level, and one that did not fight is dropped by `recent` anyway;
--   * "all my characters" (p_character null) no longer counts hidden characters' fights. Naming one
--     (p_character) still returns it, so a "show all" list can open a hidden character on purpose.
-- The surfaces show a chip only for a character that is not hidden and has fights in the window or the
-- last 30 days, and fold the rest under "show all".
--
-- Idempotent (create or replace; grants restated).

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
    select c.name, c.class, coalesce(c.active, false) as active,
           (coalesce(c.hidden_from_lists, false) or lower(trim(coalesce(c.rank, ''))) = 'trader') as hidden
    from characters c
    where c.guild_id = 'wolfpack'
      and lower(coalesce(c.main_name, c.name)) in (select fam from roots)
      and not coalesce(c.exclude_from_stats, false)
  ),
  -- Every comparable post-cutover row for the whole family, read once (the chip counts need them all).
  allrows as (
    select e.id as eid, e.started_at as t, e.npc_id, ep.character_name as ch,
           ep.dps, ep.total_damage as dmg, ep.duration_sec as dur, ep.rank,
           (e.npc_id in (select npc_id from bosses_local where auto_registered = false and npc_id is not null)) as boss
    from encounter_players ep
    join encounters e on e.id = ep.encounter_id
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
