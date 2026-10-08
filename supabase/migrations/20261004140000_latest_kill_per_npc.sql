-- 20261004140000_latest_kill_per_npc.sql
-- The newest encounter per tracked boss inside a look-back window, one row per boss. Feeds timer
-- recovery (utils/reconcileKills.js: startup, every 6 h, and /recoverkills).
--
-- Why a function: the recovery used to read the newest 1,000 `encounters` in the window with no boss
-- filter and then pick the newest per boss out of them. PostgREST returns at most 1,000 rows per
-- response whatever `limit=` says, and `encounters` went from ~100 rows a week (July) to ~5,500 a week
-- once every named mob started auto-registering (2026-08-19, ~790 a day). Measured 2026-10-04: 6,821
-- encounters in the 186 h window, the newest 1,000 reached back only to the evening before, and of
-- the 128 tracked bosses that read saw ONE; this function returns 19. state.json does not persist on
-- Railway, so after a redeploy a boss killed more than a day ago came back as "Available now".
--
-- The caller passes the tracked bosses' npc_ids (bosses_local rows whose internal_id is in
-- data/bosses.json) and gets back at most one row each, so the answer can never outgrow the cap.
-- "Newest" is by started_at, which is also what the caller turns into nextSpawn = started_at + timer.
-- No confirmed-kill condition on purpose: the recovery has never had one, and this keeps its meaning.
--
-- Reads encounters_npc_started_idx (npc_id, started_at desc): 1.5 ms for the 128 bosses over 186 h
-- (EXPLAIN ANALYZE on production, 2026-10-04). id breaks a started_at tie so the pick is stable.
--
-- SECURITY INVOKER: encounters is a plain table with an authenticated-read policy; the function adds
-- nothing it does not already allow. The bot calls it as service_role and no other surface needs it,
-- so the grant matches 20260718040000_lockdown_security_definer_rpcs.sql.
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
  order by e.npc_id, e.started_at desc, e.id
$$;

comment on function public.latest_kill_per_npc(text, timestamptz, int[]) is
  'Newest encounter (by started_at) per npc_id in p_npc_ids since p_since, one row per npc. An npc with no encounter in the window is omitted. Feeds timer recovery (utils/reconcileKills.js).';

revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from public;
revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from anon;
revoke all on function public.latest_kill_per_npc(text, timestamptz, int[]) from authenticated;
grant execute on function public.latest_kill_per_npc(text, timestamptz, int[]) to service_role;
