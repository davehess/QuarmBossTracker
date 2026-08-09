-- /about page numbers, in one cheap round trip. (Final shape — iterated three
-- times on 2026-08-09, each against Hitya's corrections; the discarded attempts
-- and why they were wrong are recorded below so they are not rebuilt.)
--
-- ── Why a function and not PostgREST counts ──────────────────────────────────
-- The first cut issued nine count() calls plus three scans pulling 200k
-- uploader strings to unique in JS. Folding into one function of exact counts
-- was STILL 32,398 ms (count(*) is a full scan; ~1M rows across the big
-- tables). Final shape: ~200 ms, by changing what is asked.
--
-- ── The three measurement lessons this file carries ──────────────────────────
-- 1. RAID SIZE comes from OPENDKP ATTENDANCE, not parses. The parse-derived
--    count read ~36 because encounter_players only sees characters that
--    resolve to our roster (and also contains other guilds' players in
--    contested content). The attendance sheet — distinct attendees per raid,
--    union across its ticks — is the number the guild actually uses: avg 49,
--    biggest 67, since Luclin opened (2025-10-01).
-- 2. PARSER COVERAGE counts PEOPLE, not characters. The agent tails every
--    eqlog in the folder, so one person contributes from several characters;
--    distinct contributor_character read 23 where distinct
--    uploaded_by_discord_id reads the true 21.
-- 3. NOTHING here is a "right now" count (Hitya: "that would fluctuate wildly
--    with the time of day"). The guild raids Sun/Wed/Thu; a live figure read
--    at 3am Saturday makes a healthy platform look dead.
--
-- Combat figures are scoped to the platform's own life (since 2026-04) — the
-- backfilled pre-platform history stays out of the headline claims. Big-table
-- display counts use pg_class.reltuples (ANALYZE keeps them; the last three
-- digits of "557,000 snapshots" are not worth a full scan per view).
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
    'fights_apr', (select count(*) from public.encounters where started_at >= '2026-04-01'),
    'damage_apr', (select coalesce(sum(total_damage),0) from public.encounters where started_at >= '2026-04-01'),
    'bosses_apr', (select count(distinct npc_id) from public.encounters where started_at >= '2026-04-01'),
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
  'Aggregate counts for the public /about page, one round trip. Raid size = OpenDKP attendance (distinct attendees per raid since Luclin, 2025-10-01) — the number the guild actually uses. max_parsers counts PEOPLE (uploaded_by_discord_id), never characters. Combat figures scoped to the platform''s life (since 2026-04). Big-table counts are reltuples estimates.';

grant execute on function public.about_stats() to anon, authenticated;
