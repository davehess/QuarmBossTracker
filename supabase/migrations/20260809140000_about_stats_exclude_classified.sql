-- about_stats: exclude classified encounters from the headline combat figures.
--
-- Forced by the 2026-08-08 Diabo Xi Xin incident (encounter 3b1069fd…): a
-- guildie's agent uploaded a Breakfast Club morning raid whose second payload
-- carried session-cumulative damage — 95 players (including Wolf Pack evening
-- characters who were never in the fight) and 2.55M "damage". Officer
-- classification ('foreign' / 'wipe' / 'live' / 'pvp' / 'test') already hides
-- such rows from /parses, but the /about counters ignored it, so junk fights
-- inflated fights_apr / damage_apr / bosses_apr. Same fix applied to
-- /leaderboards (web 1.1.36) the same day.
--
-- Everything else in the 20260809040000 version is unchanged — see that file
-- for the measurement lessons (OpenDKP attendance for raid size, people not
-- characters for parser coverage, no time-of-day-sensitive counts).
create or replace function public.about_stats()
returns json language sql stable as $$
  with est as (
    select relname, greatest(reltuples, 0)::bigint n
    from pg_class
    where relname in ('who_observations','encounter_threat_snapshots','buff_casts')
      and relnamespace = 'public'::regnamespace
  ),
  dkp_raids as (
    select r.raid_id, count(distinct att.name) attendees
    from public.opendkp_raids r
    join public.opendkp_ticks t on t.raid_id = r.raid_id
    cross join lateral unnest(t.attendees) att(name)
    where r.ts >= '2025-10-01'
    group by 1
  ),
  night_uploaders as (
    select e.raid_night_id, count(distinct co.uploaded_by_discord_id) uploaders
    from public.encounters e
    join public.contributions co on co.encounter_id = e.id
    where e.raid_night_id is not null and e.started_at >= '2025-10-01'
    group by 1
  )
  select json_build_object(
    'fights_apr', (select count(*) from public.encounters
                   where started_at >= '2026-04-01' and classification is null),
    'damage_apr', (select coalesce(sum(total_damage),0) from public.encounters
                   where started_at >= '2026-04-01' and classification is null),
    'bosses_apr', (select count(distinct npc_id) from public.encounters
                   where started_at >= '2026-04-01' and classification is null),
    'pvp',        (select (select count(*) from public.pvp_kills) + (select count(*) from public.pvp_assists)),
    'raid_avg',     (select round(avg(attendees))::int from dkp_raids),
    'raid_biggest', (select max(attendees) from dkp_raids),
    'raids',        (select count(*) from dkp_raids),
    'max_parsers',  (select max(uploaders) from night_uploaders),
    'characters', (select count(*) from public.characters where coalesce(deleted,false)=false),
    'members',    (select count(*) from public.wolfpack_members),
    'uploads',    (select count(*) from public.contributions),
    'who',        (select n from est where relname='who_observations'),
    'snapshots',  (select n from est where relname='encounter_threat_snapshots'),
    'buffs',      (select n from est where relname='buff_casts')
  );
$$;

comment on function public.about_stats() is
  'Aggregate counts for the public /about page, one round trip. Raid size = OpenDKP attendance (distinct attendees per raid since Luclin, 2025-10-01) — the number the guild actually uses. max_parsers counts PEOPLE (uploaded_by_discord_id), never characters. Combat figures scoped to the platform''s life (since 2026-04) and exclude officer-classified encounters (foreign/wipe/live/pvp/test). Big-table counts are reltuples estimates.';

grant execute on function public.about_stats() to anon, authenticated;
