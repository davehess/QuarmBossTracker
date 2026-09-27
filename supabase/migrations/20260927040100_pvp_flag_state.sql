-- Who follows Discord right now (the guild lead, 2026-09-27: "start looking for the messages when
-- people #togglepvp in game and follow the way of discord vs order").
-- The agent has parsed the toggle lines since 2025-02 (fun_events pvp_flag_on / pvp_flag_off):
--   "You are now player kill and follow the ways of Discord."  → on  (Discord = PvP)
--   "You now follow the ways of Order."                        → off (Order = peaceful)
-- They are self-only lines, so only characters running Mimic have a state. This view is the latest
-- line per character. security_invoker: the caller's own rights on fun_events apply.

create or replace view public.pvp_flag_state
with (security_invoker = true) as
select distinct on (e.guild_id, lower(e.caster))
       e.guild_id,
       e.caster as character,
       (e.event_type = 'pvp_flag_on') as discord,
       e.event_ts as since
from public.fun_events e
where e.event_type in ('pvp_flag_on', 'pvp_flag_off') and e.caster is not null
order by e.guild_id, lower(e.caster), e.event_ts desc;

grant select on public.pvp_flag_state to authenticated, service_role;
