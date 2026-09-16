-- 20260914043000_me_family_rpcs.sql
-- /me ran a dozen queries PER CHARACTER on every load — the guild lead's account has
-- 46 characters (mains, alts, mules), so a fresh load was ~550 PostgREST
-- round trips, two of them a 385 ms chat count each (stale visibility map;
-- vacuumed 2026-09-14, now 1.5 ms) and one an 82 ms spellbook seq scan.
-- The guild lead, 2026-09-13: "when the page loads fresh i get a huge lag spike."
--
-- Three family-wide helpers so the page asks once for the whole account:
--   me_chat_counts   — /gu message counts per speaker, all-time + since
--   me_levels        — best-known level per name (who history ∪ spellbook)
--   me_active_names  — which names have ANY parse / upload / rollup row, so
--                      the page skips the per-character fan-out for the rest
--                      (37 of the guild lead's 46 have nothing to fetch).
-- All security definer for the service role only, like scrap_damage_leaderboard.

create or replace function public.me_chat_counts(p_names text[], p_since timestamptz)
returns table(speaker text, total bigint, recent bigint)
language sql
stable
security definer
set search_path = public
as $$
  select speaker,
         count(*)::bigint                                  as total,
         (count(*) filter (where ts >= p_since))::bigint   as recent
  from chat_messages
  where speaker = any(p_names)
  group by speaker
$$;

create or replace function public.me_levels(p_names text[])
returns table(name text, level int)
language sql
stable
security definer
set search_path = public
as $$
  with n as (select distinct lower(x) as lname from unnest(p_names) x),
  w as (
    select lower(character) as lname, max(level)::int as lvl
    from who_observations
    where character ilike any(p_names) and level >= 1
    group by 1
  ),
  s as (
    select lower(character_name) as lname, max(spell_level)::int as lvl
    from character_spellbook
    where character_name ilike any(p_names) and spell_level >= 1
    group by 1
  )
  select n.lname as name,
         greatest(coalesce(w.lvl, 0), coalesce(s.lvl, 0)) as level
  from n
  left join w on w.lname = n.lname
  left join s on s.lname = n.lname
  where greatest(coalesce(w.lvl, 0), coalesce(s.lvl, 0)) > 0
$$;

create or replace function public.me_active_names(p_names text[])
returns table(name text)
language sql
stable
security definer
set search_path = public
as $$
  select x as name
  from unnest(p_names) x
  where exists (select 1 from encounter_players ep where ep.character_name = x)
     or exists (select 1 from contributions c where c.contributor_character = x)
     or exists (select 1 from encounter_combat_rollup r where r.character_name = x)
$$;

revoke all on function public.me_chat_counts(text[], timestamptz) from public;
revoke all on function public.me_levels(text[]) from public;
revoke all on function public.me_active_names(text[]) from public;
grant execute on function public.me_chat_counts(text[], timestamptz) to service_role;
grant execute on function public.me_levels(text[]) to service_role;
grant execute on function public.me_active_names(text[]) to service_role;
