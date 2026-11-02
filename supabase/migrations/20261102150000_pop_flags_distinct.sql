-- pop_flags_distinct: each character's PoP flags ONCE (2026-11-02).
--
-- Why. The PoP guide read pop_flags for a household with `.limit(1000)`, oldest first. Every #popflags read Mimic
-- captures stores ~35 rows per character (one per line, at that read's time), so a household that reads often has
-- thousands of rows for a few hundred distinct flags (one household: 5,710 rows, 334 distinct, on 2026-11-02). The
-- 1,000-row read then held only the OLDEST rows and the guide showed newer progress as missing (the guild lead,
-- 2026-11-02: "this is definitely failing to read some of the flags"). This answers one row per (character, flag)
-- with the first time it was earned, whatever the household's row count.
--
-- Called by the website with the service role only. Matching is case-blind: pop_flags.character is free text.

create or replace function public.pop_flags_distinct(p_guild_id text, p_names text[])
returns table ("character" text, flag_key text, earned_at timestamptz)
language sql
stable
set search_path = public
as $$
  select min(p."character") as "character", p.flag_key, min(p.earned_at) as earned_at
    from public.pop_flags p
   where p.guild_id = p_guild_id
     and lower(p."character") = any (select lower(n) from unnest(coalesce(p_names, '{}'::text[])) as n)
     and p.flag_key not in ('unmapped', 'hail')
   group by lower(p."character"), p.flag_key
   order by lower(p."character"), p.flag_key   -- unique per row, so a paged read (.range) neither skips nor repeats
$$;

revoke all on function public.pop_flags_distinct(text, text[]) from public, anon, authenticated;
grant execute on function public.pop_flags_distinct(text, text[]) to service_role;
