-- 20261004140500_cap_safe_admin2.sql
-- Two read functions for the officer pages that PostgREST's silent 1,000-row response cap was
-- truncating (the guild lead, 2026-10-04: "review all of the other tables for silent 500 or 100
-- caps"). Measured on production the same day; web/lib/adminReads.ts calls both.
--
-- 1. encounter_gap_audit  — /admin/encounters
--    The page read `encounters` with .range(0, 4999) (1,000 rows came back of 5,949 in 7 days),
--    then contributions / encounter_players per encounter with .range(0, 49999 / 99999) (at most
--    1,000 rows of 12,651 / 31,087) and a /who window with .range(0, 9999) (1,000 of 38,540). A
--    child set that is 3-8% complete reads as "this encounter has no players": false gaps, and
--    backfill candidates that were really already in the fight.
--    The function returns one row per encounter, newest first, with the catalog name and HP, the
--    contributions / players COUNTS, and the backfill candidates — so the 31,087 player rows and
--    38,540 /who rows never leave the database.
--
--    CANDIDATES ARE COMPUTED ONLY WHERE DAMAGE IS MISSING: data_incomplete, no damage, or under
--    75% of the catalog HP (the audit's first problem, "parsers underreported, request backfills").
--    Over those rows the list is who the guild saw within 15 minutes (/who + raid_roster) and is not
--    in encounter_players. Why not every row: 97% of encounters are farm trash, and the old page
--    gave each of them "likely there" names — 44 on average, the guild members near the zone —
--    which is 250,000 checkboxes over a week and an unusable page. Rows with missing damage, measured
--    2026-10-04: 7 days 673 of 5,956; 30 days 2,376 of 17,715; 90 days 3,637 of 24,123.
--    A row outside that set gets an empty list and the page's free-text "character to ping" box.
--
--    Paged by p_limit / p_offset, ordered (started_at desc, id), clamped to 1,000: the body has CTEs
--    and sub-selects so Postgres cannot inline it, which means a plain PostgREST .range() would run
--    the whole function once per page and cut its output after the fact. One page costs ~130 ms
--    (EXPLAIN ANALYZE on production, generic plan, 1,000 rows, 7-day window).
--    Compared with the naive per-encounter formulation on the same page: 0 mismatches over 67
--    missing-damage rows (1,418 candidate names).
--
--    p_names = guild members minus characters.exclude_from_stats, computed by the page (the
--    membership predicate lives there). Names match exactly, in EQ capitalisation, as the page did.
--    who_observations is read through who_obs_observed_idx first and filtered to the names after:
--    handed to the planner as `character = any(names)` it chose the trigram index and took 1.5 s.
--    encounter_players for the missing-damage rows is fetched by key first, for the same reason (the
--    other plan merge-joined the whole 172k-row primary key: 1.6 s).
--    raid_roster is filtered to guild_id 'wolfpack' so its (guild_id, captured_at) index applies.
--    It is empty today; the page did not filter it, and there is one guild.
--
-- 2. raid_window_names    — /admin/signups
--    The sign-up reconciliation pulled the encounters in a 6-hour window, then their player rows
--    with .in(encounter_id, ids) (2,854 rows at the busiest event, 16 of 46 events over 1,000), then
--    every /who sighting with .limit(50000) (3,166 rows, 22 of 46 events over 1,000) — and used
--    them for one thing, "which characters were around". It now gets the DISTINCT names: 581 at the
--    busiest window, 236 ms. Ordered by name (unique after the UNION) so paging is stable.
--
-- Not here, deliberately: /admin/spells reads guild_held_spell_needs, which already orders by
-- sm.spell_name, unique (one row per lower-cased scroll name: 555 rows, 555 distinct) — it needs
-- paging in the page, not a change in the function.
--
-- SECURITY INVOKER: both read plain tables; the function adds nothing the caller could not read.
-- The pages call them as service_role (supabaseAdmin), and nothing else needs them, so the grant
-- matches 20260718040000_lockdown_security_definer_rpcs.sql.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly.

create or replace function public.encounter_gap_audit(
  p_since  timestamptz,
  p_names  text[],
  p_limit  int,
  p_offset int
)
returns table(
  id                     uuid,
  npc_id                 int,
  npc_name               text,
  expected_hp            bigint,
  zone_short             text,
  started_at             timestamptz,
  duration_sec           int,
  total_damage           bigint,
  total_dps              int,
  data_incomplete        boolean,
  data_incomplete_reason text,
  contribs               int,
  players                int,
  candidates             text[]
)
language sql
stable
security invoker
set search_path = public
as $$
  with page as materialized (
    select e.id, e.npc_id, e.zone_short, e.started_at, e.duration_sec, e.total_damage, e.total_dps,
           coalesce(e.data_incomplete, false) as data_incomplete, e.data_incomplete_reason,
           n.name as npc_name, n.hp as expected_hp
    from encounters e
    left join eqemu_npc_types n on n.id = e.npc_id
    where e.started_at >= p_since
    order by e.started_at desc, e.id
    limit least(greatest(coalesce(p_limit, 1000), 1), 1000)
    offset greatest(coalesce(p_offset, 0), 0)
  ),
  gap as materialized (
    select p.id, p.started_at
    from page p
    where p.data_incomplete
       or coalesce(p.total_damage, 0) = 0
       or (p.expected_hp > 0 and p.total_damage < 0.75 * p.expected_hp)
  ),
  bounds as (
    select min(g.started_at) - interval '15 minutes' as lo,
           max(g.started_at) + interval '15 minutes' as hi
    from gap g
  ),
  names as materialized (
    select distinct x as nm from unnest(p_names) x
  ),
  sight as materialized (
    select distinct s.nm, s.at
    from (
      select w.character as nm, w.observed_at as at
      from who_observations w, bounds b
      where w.observed_at between b.lo and b.hi
      union all
      select r.name, r.captured_at
      from raid_roster r, bounds b
      where r.guild_id = 'wolfpack' and r.captured_at between b.lo and b.hi
    ) s
    join names n on n.nm = s.nm
  ),
  present as materialized (
    select ep.encounter_id, ep.character_name
    from encounter_players ep
    join gap g on g.id = ep.encounter_id
  ),
  cand as (
    select g.id, array_agg(distinct s.nm order by s.nm) as nms
    from gap g
    join sight s on s.at between g.started_at - interval '15 minutes' and g.started_at + interval '15 minutes'
    where not exists (
      select 1 from present pr where pr.encounter_id = g.id and pr.character_name = s.nm
    )
    group by g.id
  )
  select p.id, p.npc_id, p.npc_name, p.expected_hp, p.zone_short, p.started_at, p.duration_sec,
         p.total_damage, p.total_dps, p.data_incomplete, p.data_incomplete_reason,
         (select count(*) from contributions c where c.encounter_id = p.id)::int as contribs,
         (select count(*) from encounter_players ep where ep.encounter_id = p.id)::int as players,
         coalesce(c.nms, '{}') as candidates
  from page p
  left join cand c on c.id = p.id
  order by p.started_at desc, p.id
$$;

comment on function public.encounter_gap_audit(timestamptz, text[], int, int) is
  'One page of the /admin/encounters audit: encounters since p_since newest first (p_limit <= 1000 from p_offset), each with catalog name + HP, contributions / players counts, and backfill candidates (p_names seen on /who or the raid roster within 15 min and not in encounter_players) for rows whose damage is missing: data_incomplete, none, or under 75% of the catalog HP. Other rows get an empty list.';

revoke all on function public.encounter_gap_audit(timestamptz, text[], int, int) from public;
revoke all on function public.encounter_gap_audit(timestamptz, text[], int, int) from anon;
revoke all on function public.encounter_gap_audit(timestamptz, text[], int, int) from authenticated;
grant execute on function public.encounter_gap_audit(timestamptz, text[], int, int) to service_role;

create or replace function public.raid_window_names(p_lo timestamptz, p_hi timestamptz)
returns table(character_name text)
language sql
stable
security invoker
set search_path = public
as $$
  select ep.character_name
  from encounters e
  join encounter_players ep on ep.encounter_id = e.id
  where e.started_at >= p_lo and e.started_at < p_hi
    and ep.character_name is not null
  union
  select w.character
  from who_observations w
  where w.observed_at >= p_lo and w.observed_at < p_hi
    and w.character is not null
  order by 1
$$;

comment on function public.raid_window_names(timestamptz, timestamptz) is
  'Distinct character names seen in [p_lo, p_hi): in a fight (encounter_players of encounters started in the window) or on /who (who_observations). Ordered by name. Feeds the /admin/signups reality reconciliation.';

revoke all on function public.raid_window_names(timestamptz, timestamptz) from public;
revoke all on function public.raid_window_names(timestamptz, timestamptz) from anon;
revoke all on function public.raid_window_names(timestamptz, timestamptz) from authenticated;
grant execute on function public.raid_window_names(timestamptz, timestamptz) to service_role;
