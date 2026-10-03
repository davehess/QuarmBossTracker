-- 20261003120000_me_levels_use_index.sql
-- me_levels read `character ilike any(p_names)`, which Postgres runs as a sequential scan of
-- who_observations (150k rows): 1.7 s for 50 names and 7.0 s for 170, measured 2026-10-03. The same
-- lookup written as `lower(character) = any(<lowered names>)` uses the existing who_obs_character_idx
-- and character_spellbook_char_idx (both btree on lower(name)): 53 ms for 170 names, and the same rows,
-- compared name for name on 120 characters.
--
-- Why now: the guild lead, 2026-10-03: "low level characters do not need to show up on the pop flag page",
-- and /pop and /pop/guide now call me_levels (web/lib/listableChars.ts) as /me always has. /me gets the
-- speed-up too. Same signature, same columns, same rows; CREATE OR REPLACE only.
--
-- One difference, harmless for EverQuest names: ilike treated `%` and `_` in a name as wildcards;
-- the equality form does not.

create or replace function public.me_levels(p_names text[])
returns table(name text, level int)
language sql
stable
security definer
set search_path = public
as $$
  with n as (select distinct lower(x) as lname from unnest(p_names) x),
  a as (select array_agg(lname) as names from n),
  w as (
    select lower(character) as lname, max(level)::int as lvl
    from who_observations, a
    where lower(character) = any(a.names) and level >= 1
    group by 1
  ),
  s as (
    select lower(character_name) as lname, max(spell_level)::int as lvl
    from character_spellbook, a
    where lower(character_name) = any(a.names) and spell_level >= 1
    group by 1
  )
  select n.lname as name,
         greatest(coalesce(w.lvl, 0), coalesce(s.lvl, 0)) as level
  from n
  left join w on w.lname = n.lname
  left join s on s.lname = n.lname
  where greatest(coalesce(w.lvl, 0), coalesce(s.lvl, 0)) > 0
$$;

revoke all on function public.me_levels(text[]) from public;
grant execute on function public.me_levels(text[]) to service_role;
