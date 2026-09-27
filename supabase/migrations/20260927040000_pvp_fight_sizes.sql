-- Fight sizes (the guild lead, 2026-09-27: "try to figure out fight sizes for opponents vs allies
-- when a fight happens in pvp"). Every fight from pvp_fights (20260926085942) now also says who was
-- on the field, by side and by guild.
--
-- "On the field" is everyone a Wolf Pack log saw take part or stand in the zone:
--   · the dead and their killers (pvp_deaths);
--   · the assisters (pvp_assists, ±3 min round the fight);
--   · everyone /who listed in that zone from 4 min before the first death to 1 min after the last.
-- A name counts once, under the best guild any source gave it. Sides: Zek and Rise of Zek are the
-- opponents, the same rule the death split uses; everyone with another guild is an ally; no guild
-- (or /anon) is listed by guild but counted on neither side.
-- ⚠ This is a floor, not a head count: a /who nobody typed, an anon player, a raider whose log
-- never uploaded — all missing. /who short zone names ("vexthal") do not match the broadcast's
-- long name and are left out.
-- A function's return type cannot change under create or replace, so it is dropped first.

drop function if exists public.pvp_fights(timestamptz, interval, interval, integer);

create function public.pvp_fights(
  p_since    timestamptz default now() - interval '30 days',
  p_wave_gap interval    default interval '3 minutes',
  p_join_gap interval    default interval '20 minutes',
  p_limit    integer     default 20
)
returns table (
  zone             text,
  started_at       timestamptz,
  ended_at         timestamptz,
  waves            integer,
  deaths           integer,
  player_kills     integer,
  zek_deaths       integer,
  rest_deaths      integer,
  deaths_by_guild  jsonb,
  top_killers      jsonb,
  zek_players      integer,
  ally_players     integer,
  players_by_guild jsonb
)
language sql
stable
set search_path = public
as $$
  with d as (
    select p.zone, p.died_at, p.victim, coalesce(p.victim_guild, '') vg, p.killer, p.killer_guild,
           (p.killer is not null and not p.killer_is_npc) as pk
    from public.pvp_deaths p
    where p.guild_id = 'wolfpack' and p.died_at >= p_since and p.zone is not null
  ), d1 as (
    select d.*, case when d.died_at - lag(d.died_at) over (partition by d.zone order by d.died_at) <= p_wave_gap
                     then 0 else 1 end s
    from d
  ), d2 as (
    select d1.*, sum(d1.s) over (partition by d1.zone order by d1.died_at rows unbounded preceding) wave from d1
  ), w as (
    select d2.zone, d2.wave, min(d2.died_at) a, max(d2.died_at) b
    from d2 group by d2.zone, d2.wave
    having count(*) >= 2 and count(*) filter (where d2.pk) >= 1
  ), w1 as (
    select w.*, case when w.a - lag(w.b) over (partition by w.zone order by w.a) <= p_join_gap
                     then 0 else 1 end s
    from w
  ), w2 as (
    select w1.*, sum(w1.s) over (partition by w1.zone order by w1.a rows unbounded preceding) fight from w1
  ), f as (
    select w2.zone, w2.fight, min(w2.a) a, max(w2.b) b, count(*)::integer waves from w2 group by w2.zone, w2.fight
  ), fd as (
    select f.zone, f.fight, f.a, f.b, f.waves, x.victim, x.vg, x.killer, x.killer_guild, x.pk
    from f join d x on x.zone = f.zone and x.died_at between f.a and f.b
  ), fp as (
    -- everyone on the field, one row per (fight, name) with the best guild any source gave
    select q.zone, q.fight, lower(q.name) nm, max(nullif(q.guild, '')) guild
    from (
      select fd.zone, fd.fight, fd.victim name, fd.vg guild from fd
      union all
      select fd.zone, fd.fight, fd.killer, coalesce(fd.killer_guild, '') from fd where fd.pk
      union all
      select f.zone, f.fight, a.assister, coalesce(a.assister_guild, '')
      from f join public.pvp_assists a on a.guild_id = 'wolfpack' and a.zone = f.zone
        and a.killed_at between f.a - p_wave_gap and f.b + p_wave_gap
      union all
      select f.zone, f.fight, w.character, coalesce(w.guild_name, '')
      from f join public.who_observations w on w.guild_id = 'wolfpack' and lower(w.zone) = lower(f.zone)
        and w.observed_at between f.a - interval '4 minutes' and f.b + interval '1 minute'
    ) q
    where q.name is not null and q.name <> ''
    group by q.zone, q.fight, lower(q.name)
  )
  select fd.zone, fd.a, fd.b, fd.waves,
         count(*)::integer,
         count(*) filter (where fd.pk)::integer,
         count(*) filter (where fd.vg ~* '^(zek|rise of zek)$')::integer,
         count(*) filter (where fd.vg !~* '^(zek|rise of zek)$')::integer,
         (select jsonb_object_agg(g, n) from (
            select coalesce(nullif(y.vg, ''), '(no guild)') g, count(*) n
            from fd y where y.zone = fd.zone and y.fight = fd.fight group by 1) q),
         (select coalesce(jsonb_agg(jsonb_build_object('killer', k, 'guild', g, 'kills', n) order by n desc, k), '[]'::jsonb) from (
            select y.killer k, max(y.killer_guild) g, count(*) n
            from fd y where y.zone = fd.zone and y.fight = fd.fight and y.pk
            group by y.killer order by count(*) desc, y.killer limit 5) q),
         (select count(*)::integer from fp where fp.zone = fd.zone and fp.fight = fd.fight and fp.guild ~* '^(zek|rise of zek)$'),
         (select count(*)::integer from fp where fp.zone = fd.zone and fp.fight = fd.fight and fp.guild is not null and fp.guild !~* '^(zek|rise of zek)$'),
         (select jsonb_object_agg(g, n) from (
            select coalesce(fp.guild, '(no guild)') g, count(*) n
            from fp where fp.zone = fd.zone and fp.fight = fd.fight group by 1) q)
  from fd
  group by fd.zone, fd.fight, fd.a, fd.b, fd.waves
  order by fd.a desc
  limit p_limit
$$;

grant execute on function public.pvp_fights(timestamptz, interval, interval, integer) to authenticated, service_role;
