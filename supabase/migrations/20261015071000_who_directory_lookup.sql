-- who_directory_lookup(p_keys): who_directory's rows for just the asked characters (2026-10-15).
--
-- Why. The who_directory view rebuilds the whole directory (six DISTINCT ON passes over ~203k who_observations
-- rows) before a `character_key=in.(…)` filter can apply: ~1.27 s per call, 7.6k bot calls since 2026-10-12 — the
-- second-largest database cost behind the live-damage read. This function returns the same columns (the view's own
-- row type) computed per character with LATERAL reads on who_obs_character_idx, starting from only the asked keys:
-- ~0.5 ms. Verified identical to the view over all 13,811 characters (EXCEPT ALL both ways = 0) on 2026-10-15.
-- 20261015070000 rewrites the view itself the same way; this function is what the bot calls either way.
-- Keys are lower-case character names (the view's character_key).

create or replace function public.who_directory_lookup(p_keys text[])
returns setof public.who_directory
language sql
stable
set search_path = public
as $$
select l."character", k.k as character_key, l.guild_id, l.race,
       coalesce(bc.best_class, l.class) as observed_class,
       coalesce(bl.best_level, l.level) as level,
       coalesce(bg.best_guild, l.guild_name) as guild_name,
       l.guild_rank, l.anonymous, l.gm, l.last_seen,
       a.first_seen, a.obs_count,
       coalesce(a.ever_zek_guild, false) as ever_zek_guild,
       bz.best_zone as zone, bz.zone_seen,
       coalesce(a.ever_inferred_zek, false) as ever_inferred_zek
  from (select distinct lower(w."character") as k from public.who_observations w
         where lower(w."character") = any(p_keys)) k
  cross join lateral (
    select w.guild_id, w."character", w.level, w.race, w.class, w.guild_name, w.guild_rank, w.anonymous, w.gm,
           w.observed_at as last_seen
      from public.who_observations w where lower(w."character") = k.k
     order by w.observed_at desc limit 1) l
  cross join lateral (
    select count(*) as obs_count, min(w.observed_at) as first_seen,
           bool_or(btrim(w.guild_name) ~* '^(zek|rise of zek)$') as ever_zek_guild,
           bool_or(w.inferred_zek_at is not null) as ever_inferred_zek
      from public.who_observations w where lower(w."character") = k.k) a
  left join lateral (
    select w.class as best_class from public.who_observations w
     where lower(w."character") = k.k and w.class is not null and w.class <> ''
     order by w.observed_at desc limit 1) bc on true
  left join lateral (
    select w.level as best_level from public.who_observations w
     where lower(w."character") = k.k and w.level is not null
     order by w.observed_at desc limit 1) bl on true
  left join lateral (
    select w.guild_name as best_guild from public.who_observations w
     where lower(w."character") = k.k and w.guild_name is not null and w.guild_name <> ''
     order by w.observed_at desc limit 1) bg on true
  left join lateral (
    select w.zone as best_zone, w.observed_at as zone_seen from public.who_observations w
     where lower(w."character") = k.k and w.zone is not null and w.zone <> ''
     order by w.observed_at desc limit 1) bz on true
$$;

revoke all on function public.who_directory_lookup(text[]) from public, anon;
grant execute on function public.who_directory_lookup(text[]) to service_role, authenticated;
