-- 20261007010000_owned_character_names.sql
-- owned_character_names(p_discord_id): the names of every character in one person's family, in ONE cheap
-- read. Behind POST /api/agent/character-prefs and GET /api/agent/character-prefs?mine=1 (the guild lead,
-- 2026-10-06: "the complete hide or hide from all but inventory should be with mimic during onboarding but
-- the denotation on other side should be carried over"): the route must refuse a character that is not the
-- caller's before it writes a flag on it, and Mimic's onboarding lists the caller's characters.
--
-- "My characters" is the same rule as my_parse_series / my_parse_series_v2 and loadOwnedCharacters in
-- web/app/me/page.tsx: the household (wolfpack_members.merged_into_discord_id aliases), the characters
-- anchored to any household id (characters.discord_id), then their whole family by main_name.
--
-- Unlike those functions it does NOT leave out exclude_from_stats or hidden characters: a character set to
-- "hidden completely" must stay in this list, or its owner could never switch it back.
--
-- p_discord_id is the SIGNED-IN person, taken by the bot from the Mimic session, never from a request body.
-- That is why it is granted to service_role only: a client must not be able to ask for someone else's
-- family. An unknown or null id returns an empty array. Names come back as stored, ordered by lower(name).
--
-- Security invoker, stable, search_path pinned. Idempotent (create or replace; grants restated). No drops.

create or replace function public.owned_character_names(p_discord_id text)
returns text[]
language sql
stable
security invoker
set search_path = public
as $$
  with
  root as (
    select coalesce(
      (select m.merged_into_discord_id from wolfpack_members m
        where m.discord_id = p_discord_id and m.merged_into_discord_id is not null limit 1),
      p_discord_id) as id
  ),
  household as (
    select p_discord_id as id
    union select id from root
    union select m.discord_id from wolfpack_members m, root r
           where m.discord_id = r.id or m.merged_into_discord_id = r.id
  ),
  roots as (
    select distinct lower(coalesce(c.main_name, c.name)) as fam
    from characters c
    where c.guild_id = 'wolfpack' and c.discord_id in (select id from household where id is not null)
  )
  select coalesce(array_agg(c.name order by lower(c.name), c.name), '{}'::text[])
  from characters c
  where c.guild_id = 'wolfpack'
    and lower(coalesce(c.main_name, c.name)) in (select fam from roots);
$$;

revoke all on function public.owned_character_names(text) from public;
revoke all on function public.owned_character_names(text) from anon, authenticated;
grant execute on function public.owned_character_names(text) to service_role;
