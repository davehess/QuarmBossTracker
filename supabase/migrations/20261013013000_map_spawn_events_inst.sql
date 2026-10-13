-- Which running copy of the zone a synced spawn-map event happened in (the guild lead, 2026-10-13: "we can see the
-- different zones in the debug file ... with port numbers").
--
-- The agent reads EverQuest's dbg.txt zone-in lines and sends `host:port` of the zone server with each event. Agents
-- then take another member's event only from the same copy, so our guild instance, the live zone and the PvP copy of
-- a zone stop mixing. A port is reused once its copy shuts down, so this is a short-lived tag, not a zone id; rows
-- already prune at 24 h. NULL = an agent that does not know (older agents, or no dbg.txt).
-- Idempotent.

alter table public.map_spawn_events add column if not exists inst text;
