-- 20261008160000_latest_kill_per_npc_rostered_duo.sql
-- latest_kill_per_npc keeps a one- or two-person kill when every fighter is on our roster.
-- Feeds timer recovery (utils/reconcileKills.js: startup, every 6 h, and /recoverkills).
--
-- Why: the guild lead, 2026-10-08, on the Bastion of Thunder board: two guildmates killed Gaukr Sandstorm
-- and Hreidar Lynhillig and neither got a timer — "This needs to stay updated." The live path
-- (utils/killContext.js rule 5) now calls a kill by 1–2 fighters who are ALL on the roster `ours`. This
-- function must agree, or the next deploy (state.json does not persist on Railway) drops those timers again.
-- A duo with anyone off the roster is still 'unknown' to the live path and still left out here.
--
-- "On the roster" is the same test the live path uses: a `characters` row for the guild with that name,
-- case-insensitive. Three or more players keep the old `offset 2` test unchanged (the roster share for a
-- 3+ fight is judged live and stamped 'live' on the encounter, which `classification is null` excludes).
-- The roster is read ONCE as an array (an uncorrelated array(...) is an InitPlan): EXPLAIN ANALYZE on
-- production, all 1,811 bosses_local npcs over 186 h, 153 ms; a correlated `not exists (… characters …)`
-- planned as a per-encounter hash anti join over the whole roster and took 2.3 s.
--
-- Everything else is 20261005220000_latest_kill_per_npc_ours_only.sql unchanged: signature, return shape,
-- selection, ordering, SECURITY INVOKER and the service_role-only grant.
--
-- Idempotent: CREATE OR REPLACE, REVOKE and GRANT all re-run cleanly.

create or replace function public.latest_kill_per_npc(p_guild_id text, p_since timestamptz, p_npc_ids int[])
returns table(npc_id int, started_at timestamptz, zone_short text, id uuid)
language sql
stable
security invoker
set search_path = public
as $$
  select distinct on (e.npc_id) e.npc_id, e.started_at, e.zone_short, e.id
  from encounters e
  where e.guild_id = p_guild_id
    and e.started_at >= p_since
    and e.npc_id = any(p_npc_ids)
    and e.classification is null
    and e.ended_at is not null
    and exists (select 1 from encounter_players ep where ep.encounter_id = e.id)
    and (
      exists (select 1 from encounter_players ep where ep.encounter_id = e.id offset 2)
      or not exists (
        select 1 from encounter_players ep
        where ep.encounter_id = e.id
          and lower(ep.character_name) <> all (array(select lower(c.name) from characters c where c.guild_id = p_guild_id))
      )
    )
  order by e.npc_id, e.started_at desc, e.id
$$;

comment on function public.latest_kill_per_npc(text, timestamptz, int[]) is
  'Newest finished, unclassified encounter (by started_at) per npc_id in p_npc_ids since p_since, one row per npc: 3+ players, or 1-2 players all on the guild roster. A boss with none in the window is omitted. Feeds timer recovery (utils/reconcileKills.js).';

revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from public;
revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from anon;
revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from authenticated;
grant execute on function public.latest_kill_per_npc(text, timestamptz, int[]) to service_role;
