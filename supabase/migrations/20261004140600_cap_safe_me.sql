-- 20261004140600_cap_safe_me.sql
-- /me, /me/tells and the character pages read COMPLETE data (the 1,000-row cap).
--
-- PostgREST silently returns at most 1,000 rows per response. `.limit(5000)` does
-- not raise it, a one-call `.range(0, N)` does not raise it, a set-returning RPC
-- is capped the same way, and discover_quests_for_item also carried its own
-- LIMIT 500. A single jsonb VALUE is not row-capped — the precedent is
-- who_directory_json (20260709060000) — so every aggregate below returns one.
-- The audit (the guild lead, 2026-10-04) measured each of these as broken NOW:
--
--   me_char_stats            /me per-character stats read encounter_players
--                            (.limit(5000)), contributions (.limit(500)) and
--                            encounter_combat_rollup (.limit(5000)) and summed
--                            in JS; the heaviest raider has 3,807 / 4,036 /
--                            3,914 rows, 38 / 28 / 57 characters are over the
--                            cap, so their encounter count, totals, top damage,
--                            upload count (stopped at 500) and top skills were
--                            computed over the first 1,000 / 500 rows.
--   me_floor_json,           /me read the two whole-guild views with .limit(5000)
--   me_coverage_json         and cached the result for 30 minutes: 1,570 and
--                            3,237 rows, so 36% / 69% of characters were
--                            missing from the cached map. The views re-aggregate
--                            the whole guild per call (~2.9 s / ~2.6 s), so a
--                            paged read would pay that once PER PAGE; one jsonb
--                            value pays it once.
--   scrap_leaderboard_view   The Scrap read scrap_damage_leaderboard() — 1,106
--                            rows over 30 days — through a 1,000-row response,
--                            so contenders read 1,000 and a low rank got no
--                            card. The view returns the contender count, the
--                            top dog, the viewer's best row and the rival above
--                            them, ranked over ALL of it.
--   me_tell_summary          /me/tells counted conversations and totals over the
--                            newest 1,000 of up to 9,156 tells. Grouped here.
--   character_parse_summary  /character/<name> pulled every encounter_players
--                            row (.limit(10000)) to show five numbers and a
--                            top-30 list; 38 characters are over the cap.
--   spell_scroll_sources_json  the spellbook page's scroll sources: 40 of 117
--                            spellbook characters are over 1,000 rows (max
--                            4,632), and the function has no ORDER BY.
--   discover_quests_for_item (REPLACED, same signature) dropped its LIMIT 500 —
--                            4 of the top-25 inventories hit exactly 500 and it
--                            sorts 'piece' before 'completed', so the completed
--                            turn-ins were what got cut — and gained a total
--                            order (… turnin_id, matched_item_id) so a caller
--                            can page it with .range() safely.
--
-- Every new function is security invoker, stable, search_path pinned, and
-- granted to service_role ONLY — the pages that call them use supabaseAdmin().
-- me_tell_summary reads PRIVATE data: it is scoped by owner_discord_id INSIDE
-- the function and is deliberately NOT granted to anon or authenticated, so a
-- client cannot ask it for someone else's tells. The page resolves the owner
-- id from the signed-in session on the server and passes it.
--
-- Idempotent (create or replace / revoke / grant are re-runnable).

-- ── /me: per-character parse, upload and rollup stats, for the whole family ──
-- One element per requested name (case-sensitive on the stored character name,
-- like the .eq() reads it replaces). `recent` is the 10 newest encounters.
create or replace function public.me_char_stats(p_names text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with n as (
    select distinct x as name from unnest(p_names) x where x is not null
  ),
  ep as (
    select p.character_name as name,
           count(*)::bigint                         as encounter_count,
           coalesce(sum(p.total_damage), 0)::bigint as total_damage
    from encounter_players p
    where p.character_name = any(p_names)
    group by p.character_name
  ),
  best as (
    select distinct on (p.character_name)
           p.character_name as name,
           p.total_damage   as top_damage,
           p.encounter_id   as top_encounter_id
    from encounter_players p
    where p.character_name = any(p_names)
      and p.total_damage > 0
    order by p.character_name, p.total_damage desc, p.encounter_id
  ),
  recent as (
    select r.name,
           jsonb_agg(jsonb_build_object(
             'id', r.encounter_id, 'started_at', r.started_at, 'npc_id', r.npc_id,
             'damage', r.damage, 'dps', r.dps) order by r.rn) as recent
    from (
      select p.character_name as name, p.encounter_id, e.started_at, e.npc_id,
             coalesce(p.total_damage, 0) as damage,
             coalesce(p.dps, 0)          as dps,
             row_number() over (partition by p.character_name
                                order by e.started_at desc, p.encounter_id) as rn
      from encounter_players p
      join encounters e on e.id = p.encounter_id
      where p.character_name = any(p_names)
    ) r
    where r.rn <= 10
    group by r.name
  ),
  ct as (
    select c.contributor_character as name,
           count(*)::bigint as upload_count,
           max(c.created_at) as last_upload
    from contributions c
    where c.contributor_character = any(p_names)
    group by c.contributor_character
  ),
  agv as (
    select distinct on (c.contributor_character)
           c.contributor_character as name,
           c.agent_version
    from contributions c
    where c.contributor_character = any(p_names)
      and c.agent_version is not null
    order by c.contributor_character, c.created_at desc
  ),
  ro as (
    select r.character_name as name,
           coalesce(sum(r.total_hits), 0)::bigint        as rollup_hits,
           coalesce(sum(r.total_damage), 0)::bigint      as rollup_damage,
           coalesce(sum(r.self_attack_count), 0)::bigint as self_attack_count
    from encounter_combat_rollup r
    where r.character_name = any(p_names)
    group by r.character_name
  ),
  sk as (
    select s.name,
           jsonb_agg(jsonb_build_object('skill', s.skill, 'hits', s.hits, 'dmg', s.dmg)
                     order by s.rn) as top_skills
    from (
      select t.name, t.skill, t.hits, t.dmg,
             row_number() over (partition by t.name order by t.dmg desc, t.skill) as rn
      from (
        select r.character_name as name,
               e.key as skill,
               sum(case when jsonb_typeof(e.value -> 'hits') = 'number'
                        then (e.value ->> 'hits')::numeric else 0 end) as hits,
               sum(case when jsonb_typeof(e.value -> 'dmg') = 'number'
                        then (e.value ->> 'dmg')::numeric else 0 end)  as dmg
        from encounter_combat_rollup r
        cross join lateral jsonb_each(
          case when jsonb_typeof(r.by_skill) = 'object' then r.by_skill else '{}'::jsonb end) e
        where r.character_name = any(p_names)
        group by r.character_name, e.key
      ) t
    ) s
    where s.rn <= 5
    group by s.name
  )
  select coalesce(jsonb_agg(jsonb_build_object(
           'name',                 n.name,
           'encounter_count',      coalesce(ep.encounter_count, 0),
           'total_damage',         coalesce(ep.total_damage, 0),
           'top_damage',           coalesce(best.top_damage, 0),
           'top_encounter_id',     best.top_encounter_id,
           'recent',               coalesce(recent.recent, '[]'::jsonb),
           'upload_count',         coalesce(ct.upload_count, 0),
           'last_upload',          ct.last_upload,
           'latest_agent_version', agv.agent_version,
           'rollup_hits',          coalesce(ro.rollup_hits, 0),
           'rollup_damage',        coalesce(ro.rollup_damage, 0),
           'self_attack_count',    coalesce(ro.self_attack_count, 0),
           'top_skills',           coalesce(sk.top_skills, '[]'::jsonb)
         ) order by n.name), '[]'::jsonb)
  from n
  left join ep     on ep.name     = n.name
  left join best   on best.name   = n.name
  left join recent on recent.name = n.name
  left join ct     on ct.name     = n.name
  left join agv    on agv.name    = n.name
  left join ro     on ro.name     = n.name
  left join sk     on sk.name     = n.name
$$;

-- ── /me: the two whole-guild views, as one value each ───────────────────────
-- Two functions, not one, so the page can run them in parallel — each view
-- takes ~2.5 s and a single function would run them back to back.
create or replace function public.me_floor_json()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'character_name', f.character_name,
           'member_since',   f.member_since,
           'floor_source',   f.floor_source) order by f.character_name), '[]'::jsonb)
  from character_data_floor f
$$;

create or replace function public.me_coverage_json()
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(jsonb_build_object(
           'character_name',           c.character_name,
           'encounters_total',         c.encounters_total,
           'encounters_with_detail',   c.encounters_with_detail,
           'encounters_resubmittable', c.encounters_resubmittable) order by c.character_name), '[]'::jsonb)
  from character_rollup_coverage c
$$;

-- ── /me: The Scrap — the card's four facts, ranked over every contender ─────
-- Wraps scrap_damage_leaderboard (unchanged) so the raid-fight rules stay in
-- one place. Returns null when nobody has a damage total in the window.
-- `rank` is damage-descending with the name as the tiebreak (the old page used
-- array position, which left ties arbitrary).
create or replace function public.scrap_leaderboard_view(p_since timestamptz, p_names text[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with ranked as (
    select s.character_name, s.total_damage, s.best_dps, s.encounters,
           row_number() over (order by s.total_damage desc, s.character_name) as rank
    from scrap_damage_leaderboard(p_since) s
  ),
  mine as (
    select r.*
    from ranked r
    where lower(r.character_name) in (select lower(x) from unnest(p_names) x)
    order by r.rank
    limit 1
  )
  select case when not exists (select 1 from ranked) then null
    else jsonb_build_object(
      'contenders', (select count(*) from ranked),
      'top',        (select to_jsonb(r) from ranked r where r.rank = 1),
      'me',         (select to_jsonb(m) from mine m),
      'rival',      (select to_jsonb(r) from ranked r
                     where r.rank = (select m.rank - 1 from mine m))
    )
  end
$$;

-- ── /me/tells: conversation totals over EVERY tell, PRIVATE ─────────────────
-- Scoped by owner_discord_id inside the function. service_role only (below).
-- `top` is the newest p_limit conversations; the four totals cover all of them.
create or replace function public.me_tell_summary(p_owner_discord_id text, p_limit integer default 50)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with convo as (
    select lower(t.other_name) as k,
           count(*)::bigint as total,
           (count(*) filter (where t.direction = 'incoming'))::bigint as incoming,
           (count(*) filter (where t.direction = 'outgoing'))::bigint as outgoing
    from tells t
    where t.owner_discord_id = p_owner_discord_id
    group by lower(t.other_name)
  ),
  latest as (
    select distinct on (lower(t.other_name))
           lower(t.other_name) as k,
           t.other_name        as other,
           t.text              as last_text,
           t.direction         as last_direction,
           t.owner_character   as last_char,
           t.ts                as last_ts
    from tells t
    where t.owner_discord_id = p_owner_discord_id
    order by lower(t.other_name), t.ts desc, t.id desc
  ),
  joined as (
    select l.other, c.total, c.incoming, c.outgoing,
           l.last_ts, l.last_text, l.last_direction, l.last_char
    from convo c
    join latest l on l.k = c.k
  )
  select jsonb_build_object(
    'conversations', (select count(*) from joined),
    'total',         (select coalesce(sum(total), 0)::bigint from joined),
    'incoming',      (select coalesce(sum(incoming), 0)::bigint from joined),
    'outgoing',      (select coalesce(sum(outgoing), 0)::bigint from joined),
    'top', coalesce((
      select jsonb_agg(to_jsonb(j) order by j.last_ts desc, j.other)
      from (select * from joined order by last_ts desc, other limit greatest(p_limit, 0)) j
    ), '[]'::jsonb)
  )
$$;

-- ── /character/<name>: parse summary without pulling every parse ────────────
-- encounter_players is unique per (encounter_id, character_name), so a row
-- count is an encounter count. `best` is the highest single-fight damage,
-- `recent` the 30 newest fights, `first_started` the earliest.
create or replace function public.character_parse_summary(p_name text)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with p as (
    select ep.encounter_id, ep.total_damage, ep.dps, ep.duration_sec, ep.rank,
           e.started_at, e.npc_id, e.zone_short
    from encounter_players ep
    join encounters e on e.id = ep.encounter_id
    where ep.character_name = p_name
  )
  select jsonb_build_object(
    'parses',        (select count(*) from p),
    'total_damage',  (select coalesce(sum(total_damage), 0)::bigint from p),
    'first_started', (select min(started_at) from p),
    'best', (
      select to_jsonb(b) from (
        select p.*, n.name as npc_name
        from p left join eqemu_npc_types n on n.id = p.npc_id
        order by p.total_damage desc nulls last, p.started_at desc, p.encounter_id
        limit 1
      ) b),
    'recent', coalesce((
      select jsonb_agg(to_jsonb(r) order by r.started_at desc, r.encounter_id)
      from (
        select p.*, n.name as npc_name
        from p left join eqemu_npc_types n on n.id = p.npc_id
        order by p.started_at desc, p.encounter_id
        limit 30
      ) r), '[]'::jsonb)
  )
$$;

-- ── /character/<name>/spells: scroll sources as one value ───────────────────
-- spell_scroll_sources() returns one row per (scroll, vendor-or-dropper, zone):
-- 4,632 rows for one spellbook, past the 1,000-row response cap. Same rows, one
-- jsonb array, in a fixed order.
create or replace function public.spell_scroll_sources_json(p_item_ids integer[])
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  select coalesce(jsonb_agg(to_jsonb(s) order by s.item_id, s.kind, s.npc_id, s.zone_short), '[]'::jsonb)
  from spell_scroll_sources(p_item_ids) s
$$;

-- ── /character/<name>/quests: discovery without the LIMIT 500 ───────────────
-- Same signature and body as 20260630000000 / 20260718043553, minus `limit 500`
-- and with a total order: (evidence, zone, npc, turnin, matched item) is unique
-- per row, so a caller paging with .range() cannot skip or repeat one.
create or replace function public.discover_quests_for_item(p_item_ids integer[])
returns table(turnin_id bigint, zone_short text, npc_name text, npc_id integer, evidence text, matched_item_id integer, inputs jsonb, outputs jsonb, faction_changes jsonb, exp_award integer, cash jsonb, money_required jsonb, random_outputs boolean)
language sql
stable
security invoker
set search_path = public
as $$
  with held(item_id) as (select unnest(p_item_ids))
  select s.id, s.zone_short, s.npc_name, s.npc_id, 'piece' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.inputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  where s.has_real_reward and not s.is_duplicate
  union all
  select s.id, s.zone_short, s.npc_name, s.npc_id, 'completed' as evidence,
         h.item_id, s.inputs, s.outputs, s.faction_changes, s.exp_award, s.cash, s.money_required, s.random_outputs
  from scripted_npc_turnins s
  join held h on s.outputs @> jsonb_build_array(jsonb_build_object('item_id', h.item_id))
  where s.has_real_reward and not s.is_duplicate
  order by 5 desc, 2, 3, 1, 6;
$$;

-- ── Grants: service_role only (every caller uses supabaseAdmin()) ───────────
revoke all on function public.me_char_stats(text[])                     from public, anon, authenticated;
revoke all on function public.me_floor_json()                           from public, anon, authenticated;
revoke all on function public.me_coverage_json()                        from public, anon, authenticated;
revoke all on function public.scrap_leaderboard_view(timestamptz, text[]) from public, anon, authenticated;
revoke all on function public.me_tell_summary(text, integer)            from public, anon, authenticated;
revoke all on function public.character_parse_summary(text)            from public, anon, authenticated;
revoke all on function public.spell_scroll_sources_json(integer[])      from public, anon, authenticated;

grant execute on function public.me_char_stats(text[])                     to service_role;
grant execute on function public.me_floor_json()                           to service_role;
grant execute on function public.me_coverage_json()                        to service_role;
grant execute on function public.scrap_leaderboard_view(timestamptz, text[]) to service_role;
grant execute on function public.me_tell_summary(text, integer)            to service_role;
grant execute on function public.character_parse_summary(text)            to service_role;
grant execute on function public.spell_scroll_sources_json(integer[])      to service_role;
