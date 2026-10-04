-- 20261004140700_cap_safe_raid.sql
-- Server-side halves of the cap-safe reads in web/lib/fullReads.ts.
--
-- PostgREST returns at most 1,000 rows per response and says nothing (Supabase max-rows). `.limit(N)`
-- over 1,000 and a one-call `.range(0, N)` do not lift it, and a set-returning RPC or a VIEW is capped
-- the same way. The 2026-10-04 audit (the guild lead) found a dozen pages reading a silently short set:
-- /parses attendance missing every recent night, /guide kill counts a third of the truth, a raid review
-- with no slows. The fixes are pagination over a unique ORDER BY (web/lib/selectAll.ts) where the page
-- needs the rows, and SQL aggregates where it needs an answer. This file holds the SQL.
--
--   parses_offcard_rollup    now ends in ORDER BY the grouping key, so `.range()` pages are stable
--   leaderboard_loot_spend   /leaderboards  per-character DKP spent, summed here
--   raid_night_slows         /raid/review/[date]  slow casts of ONE night's fight span
--   raid_night_fires         /raid/review/[date]  callout fires of that span, noise dropped
--   raid_active_buff_casts   /raid  newest un-expired cast per (target, spell)
--   guide_kill_rollup        /guide  complete kills + median kill time per curated boss
--   item_dropper_counts      /guide/[bossId], /db/item/[id]  distinct droppers per item
--   contribution_agent_versions  /parses/[id]  distinct agent versions near a fight (+ the index it needs)
--
-- Every function is SECURITY INVOKER, STABLE, search_path = public, and read-only. The pages call them
-- through supabaseAdmin() (service_role), so the new ones are granted to service_role alone, as in
-- 20260718040000_lockdown_security_definer_rpcs.sql. parses_offcard_rollup keeps the grants it has:
-- CREATE OR REPLACE does not touch them.
--
-- Each RPC that can return more than 1,000 rows (and is therefore paged by the caller) ends in an
-- ORDER BY over a unique key. The aggregates that return one row per boss / item / character do not
-- need one for paging but are ordered anyway so a result is reproducible.
--
-- Idempotent: CREATE OR REPLACE, REVOKE, GRANT and CREATE INDEX IF NOT EXISTS all re-run cleanly.

-- ── /parses off-card rollup: add the ORDER BY ───────────────────────────────
-- Body is the one in 20260821013000_offcard_rollup_raid_split.sql, character for character, plus the
-- ORDER BY. (day, zone_short, is_raid) is the GROUP BY key, so it is unique: measured 2026-10-04,
-- 1,185 rows lifetime and 1,185 distinct keys. Without an ORDER BY the 185 rows past the first page
-- came back in whatever order the hash aggregate produced, per request.
-- search_path is pinned; the body names every table unqualified, all in public.
create or replace function public.parses_offcard_rollup(p_since timestamptz)
returns table(day date, zone_short text, is_raid boolean, kills bigint, total_damage bigint)
language sql
stable
security invoker
set search_path = public
as $$
  with pl as (
    select encounter_id, count(*) filter (where total_damage > 0) as players
    from encounter_players group by encounter_id
  ), peak as (
    select e.raid_night_id, max(pl.players) as peak_players
    from encounters e join pl on pl.encounter_id = e.id
    where e.raid_night_id is not null
    group by 1
  )
  select (e.started_at at time zone 'America/New_York')::date as day,
         coalesce(e.zone_short, n.zone_short, z.short_name) as zone_short,
         (e.raid_night_id is not null
          and coalesce(pl.players, 0) >= greatest(6, 0.25 * coalesce(peak.peak_players, 0))) as is_raid,
         count(*) as kills,
         coalesce(sum(e.total_damage), 0)::bigint as total_damage
  from encounters e
  left join pl on pl.encounter_id = e.id
  left join peak on peak.raid_night_id = e.raid_night_id
  left join eqemu_npc_types n on n.id = e.npc_id
  left join eqemu_zone z on z.zone_id = (e.npc_id / 1000)
  where e.started_at >= p_since
    and e.total_damage > 0
    and e.classification is null
    and not exists (select 1 from bosses_local b
                    where b.npc_id = e.npc_id and b.auto_registered = false)
  group by 1, 2, 3
  order by 1, 2, 3
$$;

-- ── /leaderboards: DKP spent per character ───────────────────────────────────
-- The page summed opendkp_loot_recent in JS. That is a view of 9,251 rows lifetime, so the sum saw 1,000
-- of them (the board's top row read 1,077 DKP; the true top spender has spent 5,320, and is a different
-- character). One row per character, top p_limit by DKP. p_since NULL = lifetime.
create or replace function public.leaderboard_loot_spend(p_since date, p_limit int default 20)
returns table(character_name text, total_dkp bigint, items int)
language sql
stable
security invoker
set search_path = public
as $$
  select l.character_name,
         coalesce(sum(l.dkp), 0)::bigint as total_dkp,
         count(*)::int as items
  from opendkp_loot_recent l
  where p_since is null or l.raid_date >= p_since
  group by l.character_name
  order by 2 desc, 1
  limit greatest(coalesce(p_limit, 20), 0)
$$;

-- ── /raid/review/[date]: slows of one night ──────────────────────────────────
-- One raid night is 8k-33k buff_casts rows (26,063 on 2026-09-27). The page read the Eastern day oldest
-- first with a 5,000 limit, i.e. the FIRST 1,000 rows, which are the small hours before the raid: the
-- Slows section came out empty with 174 slows in the window. The page now asks for the night's fight
-- span only, and only for the slow spells. p_spells is the page's own SLOW_SPELLS list (lowercase, with
-- apostrophes), so the list lives in one place; the match is the one isSlowSpell makes: lowercase, a
-- backtick read as an apostrophe, surrounding whitespace ignored. Rows come back in time order, id as
-- the tie-break (id is the primary key), so `.range()` pages are stable. Index: buff_casts_recent_idx
-- (guild_id, cast_at desc), the window is the whole predicate that uses it.
create or replace function public.raid_night_slows(p_guild_id text, p_start timestamptz, p_end timestamptz, p_spells text[])
returns table(target text, spell_name text, cast_at timestamptz, observer text)
language sql
stable
security invoker
set search_path = public
as $$
  select b.target, b.spell_name, b.cast_at, b.observer
  from buff_casts b
  where b.guild_id = p_guild_id
    and b.cast_at >= p_start
    and b.cast_at <= p_end
    and lower(regexp_replace(replace(b.spell_name, '`', ''''), '^\s+|\s+$', '', 'g')) = any(p_spells)
  order by b.cast_at, b.id
$$;

-- ── /raid/review/[date]: callout fires of one night ──────────────────────────
-- Same shape as the slows. encounter_events kind = 'fire' is 1.3k-10.9k rows a night and most of it is
-- personal cast / line-of-sight noise ("Too Far", "Spell Interrupted", ...) the review drops anyway, so
-- the noise goes here: p_noise is the page's FIRE_NOISE (lowercase). A row's key is its subtype, or its
-- label when the subtype is empty, lowercased and trimmed, exactly as the page computes it. Time order,
-- id as the tie-break.
create or replace function public.raid_night_fires(p_guild_id text, p_start timestamptz, p_end timestamptz, p_noise text[])
returns table("at" timestamptz, subtype text, actor text, label text)
language sql
stable
security invoker
set search_path = public
as $$
  select e.at, e.subtype, e.actor, e.label
  from encounter_events e
  where e.guild_id = p_guild_id
    and e.kind = 'fire'
    and e.at >= p_start
    and e.at <= p_end
    and lower(btrim(coalesce(nullif(e.subtype, ''), nullif(e.label, ''), ''))) <> all(p_noise)
  order by e.at, e.id
$$;

-- ── /raid: the newest un-expired cast of each (target, spell) ────────────────
-- The page infers a raider's buffs from the last 3 hours of buff_casts: for each (target, spell) the
-- newest cast still inside its own duration. That window peaks at 14,900 rows and the page read the
-- newest 1,000, so a quarter of the active pairs (166 of 230) and 11 of 92 raiders were invisible.
-- The expiry test comes BEFORE the distinct-on, as it did in the page's loop: a spell whose newest cast
-- has run out still shows an older, longer one that has not. A row with no duration never expires. Keys
-- are lowercased, as the page keys them. Output is ordered on the distinct key, which is unique.
create or replace function public.raid_active_buff_casts(p_guild_id text, p_since timestamptz)
returns table(target text, spell_name text, dur_ticks int, cast_at timestamptz)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (lower(b.target), lower(b.spell_name))
         b.target, b.spell_name, b.dur_ticks, b.cast_at
  from buff_casts b
  where b.guild_id = p_guild_id
    and b.cast_at >= p_since
    and coalesce(b.target, '') <> ''
    and coalesce(b.spell_name, '') <> ''
    and not (coalesce(b.dur_ticks, 0) > 0
             and b.cast_at < now() - make_interval(secs => b.dur_ticks * 6))
  order by lower(b.target), lower(b.spell_name), b.cast_at desc, b.id desc
$$;

-- ── /guide: kills and median kill time per curated boss ──────────────────────
-- Was: pull 20,000 encounters (got 1,000 of 27,948) and count in JS, so kills were understated about
-- 2.6x. A fight counts when it is a confirmed kill (ended_at set, no officer classification, damage > 0)
-- and the raid did at least half the boss's MEDIAN damage: web/app/guide/page.tsx's own rule. Curated
-- bosses only (bosses_local.auto_registered = false), the same filter as lib/bossFilter.ts. The median
-- is percentile_cont(0.5): the middle value, or the mean of the two middle ones, as lib/raidGuide.ts
-- `median` does; nulls are ignored by both. One row per curated boss with a kill.
create or replace function public.guide_kill_rollup()
returns table(npc_id int, kills int, median_duration_sec double precision)
language sql
stable
security invoker
set search_path = public
as $$
  with fights as (
    select e.npc_id, e.total_damage, e.duration_sec
    from encounters e
    join bosses_local b on b.npc_id = e.npc_id and b.auto_registered = false
    where e.total_damage > 0
      and coalesce(e.classification, '') = ''
      and e.ended_at is not null
  ), med as (
    select f.npc_id, percentile_cont(0.5) within group (order by f.total_damage) as med_damage
    from fights f
    group by f.npc_id
  )
  select f.npc_id,
         count(*)::int as kills,
         percentile_cont(0.5) within group (order by f.duration_sec) as median_duration_sec
  from fights f
  join med m on m.npc_id = f.npc_id
  where f.total_damage >= m.med_damage * 0.5
  group by f.npc_id
  order by f.npc_id
$$;

-- ── /guide/[bossId], /db/item/[id]: distinct droppers per item ───────────────
-- "Is this item sole-source?" and "Dropped by (N)". eqemu_npc_drops is a view with one row per
-- (npc, loot table path, item), so a count of rows is not a count of NPCs: count(distinct npc_id). A
-- boss with 47 drops pulls 24,108 of those rows; the page read 1,000 and called 6 of those 47 items
-- sole-source when none is, and 124 items have more than 500 droppers. Reads through the view, so the
-- joins that decide what counts as a drop stay in one place; the item filter pushes down to
-- eqemu_lootdrop_entries_item_idx (133 ms for the worst boss, 24,108 rows). Items with no dropper are
-- absent from the result.
create or replace function public.item_dropper_counts(p_item_ids int[])
returns table(item_id int, droppers int)
language sql
stable
security invoker
set search_path = public
as $$
  select d.item_id, count(distinct d.npc_id)::int as droppers
  from eqemu_npc_drops d
  where d.item_id = any(p_item_ids)
  group by d.item_id
  order by d.item_id
$$;

-- ── /parses/[id]: the agent versions uploading near a fight ─────────────────
-- "Was this uploader on the newest agent at the time?" compares against the highest agent_version of
-- any contribution within +-7 days. The page read those contributions (21,485 rows) and got 1,000, so the
-- newest version (3.7.78) was missing and uploaders on 3.7.75 read as current. The set of distinct
-- versions is small (49 in that window), so return it and let the page's semver compare pick the top.
-- The index makes it index-only: contributions has none on created_at, and a sequential scan of the 27 MB
-- heap took 294 ms on 2026-10-04, per parse page. (created_at, agent_version) INCLUDE keeps it a few ms.
create index if not exists contributions_created_at_agent_idx
  on public.contributions (created_at) include (agent_version);

create or replace function public.contribution_agent_versions(p_lo timestamptz, p_hi timestamptz)
returns table(agent_version text)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct c.agent_version
  from contributions c
  where c.created_at >= p_lo
    and c.created_at <= p_hi
    and c.agent_version is not null
  order by 1
$$;

-- ── Grants ───────────────────────────────────────────────────────────────────
-- service_role only; the pages use supabaseAdmin().
revoke all on function public.leaderboard_loot_spend(date, int) from public;
revoke all on function public.leaderboard_loot_spend(date, int) from anon;
revoke all on function public.leaderboard_loot_spend(date, int) from authenticated;
grant execute on function public.leaderboard_loot_spend(date, int) to service_role;

revoke all on function public.raid_night_slows(text, timestamptz, timestamptz, text[]) from public;
revoke all on function public.raid_night_slows(text, timestamptz, timestamptz, text[]) from anon;
revoke all on function public.raid_night_slows(text, timestamptz, timestamptz, text[]) from authenticated;
grant execute on function public.raid_night_slows(text, timestamptz, timestamptz, text[]) to service_role;

revoke all on function public.raid_night_fires(text, timestamptz, timestamptz, text[]) from public;
revoke all on function public.raid_night_fires(text, timestamptz, timestamptz, text[]) from anon;
revoke all on function public.raid_night_fires(text, timestamptz, timestamptz, text[]) from authenticated;
grant execute on function public.raid_night_fires(text, timestamptz, timestamptz, text[]) to service_role;

revoke all on function public.raid_active_buff_casts(text, timestamptz) from public;
revoke all on function public.raid_active_buff_casts(text, timestamptz) from anon;
revoke all on function public.raid_active_buff_casts(text, timestamptz) from authenticated;
grant execute on function public.raid_active_buff_casts(text, timestamptz) to service_role;

revoke all on function public.guide_kill_rollup() from public;
revoke all on function public.guide_kill_rollup() from anon;
revoke all on function public.guide_kill_rollup() from authenticated;
grant execute on function public.guide_kill_rollup() to service_role;

revoke all on function public.item_dropper_counts(int[]) from public;
revoke all on function public.item_dropper_counts(int[]) from anon;
revoke all on function public.item_dropper_counts(int[]) from authenticated;
grant execute on function public.item_dropper_counts(int[]) to service_role;

revoke all on function public.contribution_agent_versions(timestamptz, timestamptz) from public;
revoke all on function public.contribution_agent_versions(timestamptz, timestamptz) from anon;
revoke all on function public.contribution_agent_versions(timestamptz, timestamptz) from authenticated;
grant execute on function public.contribution_agent_versions(timestamptz, timestamptz) to service_role;
