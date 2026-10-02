-- pop_who_sightings(guild, names, zones) — where /who has shown each character, for the PoP pages
-- (the guild lead, 2026-10-01: "from /who in the zone for users that don't have mimic, and if they're
-- in that zone that requires other zones we should note it").
--
-- One row per (character, zone): the first and last time any raider's /who showed that character in
-- one of the given zones, and how often. A character in a flagged plane holds that plane's gate, so the
-- site counts the flags for people who do not run Mimic (web/lib/popWho.ts decides which flags).
-- GMs are skipped. Grouped here so the page reads a few hundred rows, not every /who line.
--
-- Read-only. who_observations is guild data, so only the service role (the site's server) may call it.

create or replace function public.pop_who_sightings(p_guild_id text, p_names text[], p_zones text[])
returns table(character_key text, zone text, first_seen timestamptz, last_seen timestamptz, seen bigint)
language sql
stable
set search_path = public
as $$
  select lower(w.character), w.zone, min(w.observed_at), max(w.observed_at), count(*)
  from who_observations w
  where w.guild_id = p_guild_id
    and lower(w.character) = any(p_names)
    and w.zone = any(p_zones)
    and coalesce(w.gm, false) = false
  group by lower(w.character), w.zone
$$;

revoke all on function public.pop_who_sightings(text, text[], text[]) from public, anon, authenticated;
grant execute on function public.pop_who_sightings(text, text[], text[]) to service_role;
