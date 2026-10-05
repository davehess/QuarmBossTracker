-- 20261005220000_latest_kill_per_npc_ours_only.sql
-- latest_kill_per_npc, narrowed to the kills that should seed a board timer: finished fights nobody has
-- classified. Feeds timer recovery (utils/reconcileKills.js: startup, every 6 h, and /recoverkills).
--
-- Why: the recovery reseeds a boss's timer from its newest encounter, and until now it took ANY encounter.
-- The guild lead, 2026-10-05: "Lord of Ire PVP kills are still being triggered as regular guild instance
-- kills." The live path now refuses to start a timer for a kill that happened in the PvP or live instance
-- (utils/killContext.js) and stamps that encounter's classification ('pvp' / 'live'), but state.json does
-- not persist on Railway: after the next deploy the recovery read the same encounter back and put the timer
-- up again. `classification is null` is the repo's own definition of "a guild instance kill"
-- (20260612000000_encounter_classification.sql); every non-null value is already excluded from guild kill
-- counts and hidden on /parses, so timers now follow the same line. It also means an officer who marks a
-- kill 'pvp' / 'live' / 'foreign' / 'wipe' / 'test' on /parses takes its timer back on the next recovery.
--
-- `ended_at is not null` drops a fight that is still engaged: a boss mid-pull used to seed a timer
-- (ended_at is stamped when an agent sees the slain line, and by the engaged sweep once a fight is over:
-- see reconcileEngagedEncounters). It is the nearest thing encounters has to a "confirmed kill" column,
-- not an exact one — the sweep also stamps a pull that never produced a death line, so a wipe is kept out
-- by an officer's 'wipe' mark, not by this.
--
-- Three or more players (encounter_players, merged across uploaders): a kill by one or two people with
-- no other signal is 'unknown' to the live path and starts no timer, but it stays unclassified (the
-- CHECK has no 'unknown'), so without this the next recovery would put its timer up after all. An 'ours'
-- verdict always has three or more fighters, so nothing that would start a timer live is lost here.
-- `exists (… offset 2)` stops at the third row on encounter_players_pkey (encounter_id, character_name):
-- 52 ms warm for all 1,772 bosses_local npcs over 186 h (EXPLAIN ANALYZE on production, 2026-10-05).
--
-- Same shape as before otherwise: "newest" is by started_at, which the caller turns into
-- nextSpawn = started_at + timer; id breaks a started_at tie so the pick is stable. A boss whose newest
-- encounter is classified now returns its newest UNclassified one, or nothing.
--
-- Reads encounters_npc_started_idx (npc_id, started_at desc); the two new predicates are checked on the
-- rows that index already walks, and the classified rows are a small fraction of the table.
--
-- SECURITY INVOKER and the service_role-only grant are unchanged from 20261004140000_latest_kill_per_npc.sql.
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
    and exists (select 1 from encounter_players ep where ep.encounter_id = e.id offset 2)
  order by e.npc_id, e.started_at desc, e.id
$$;

comment on function public.latest_kill_per_npc(text, timestamptz, int[]) is
  'Newest finished, unclassified encounter with 3+ players (by started_at) per npc_id in p_npc_ids since p_since, one row per npc. A boss with none in the window is omitted. Feeds timer recovery (utils/reconcileKills.js).';

revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from public;
revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from anon;
revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from authenticated;
grant execute on function public.latest_kill_per_npc(text, timestamptz, int[]) to service_role;
