-- Read speed-ups after the 2026-10-14 raid-night database overload (the guild lead: no compute upgrade; "fix the
-- who_directory read too, scan for any other scenarios where the database should be much faster").
-- Each measured on production with EXPLAIN ANALYZE on 2026-10-15, before → after.
--
-- 1. who_directory: same columns, same rows (verified: EXCEPT ALL both ways over all 13,811 characters = 0), but
--    built per character with LATERAL reads on who_obs_character_idx instead of six DISTINCT ON passes over all
--    ~203k who_observations rows. A lookup by character_key (the bot's de-anon pass, the site's profile reads) no
--    longer rebuilds the whole directory: 1,270 ms → 0.5 ms. A full read is unchanged (~0.85 s). pg_stat_statements
--    since 2026-10-12: 7.6k + 449 lookups at ~1.2 s, the second-largest database cost.
--
-- 2. Trigram (GIN) indexes so `ilike` name matches stop scanning whole tables. PostgREST's `col=ilike.Name` (exact
--    but case-insensitive) is used across the bot and site; pg_trgm serves ILIKE without code changes.
--      eqemu_npc_types.name            Mob Info lookups      70 ms seq scan (7.4k calls)
--      opendkp_auction_bids.character_name / .user_login     bid history: 765 ms seq scan (2.9k calls)
--      encounter_players.character_name                      parse history by name: 954 ms seq scan (1k calls)
--    All small, rarely-written tables (encounter_players is rewritten per encounter merge; a GIN insert is cheap).

create or replace view public.who_directory with (security_invoker = on) as
select l."character", k.k as character_key, l.guild_id, l.race,
       coalesce(bc.best_class, l.class) as observed_class,
       coalesce(bl.best_level, l.level) as level,
       coalesce(bg.best_guild, l.guild_name) as guild_name,
       l.guild_rank, l.anonymous, l.gm, l.last_seen,
       a.first_seen, a.obs_count,
       coalesce(a.ever_zek_guild, false) as ever_zek_guild,
       bz.best_zone as zone, bz.zone_seen,
       coalesce(a.ever_inferred_zek, false) as ever_inferred_zek
  from (select distinct lower(w."character") as k from public.who_observations w) k
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
     order by w.observed_at desc limit 1) bz on true;

drop view if exists public.who_directory_v2;

create index if not exists eqemu_npc_types_name_trgm
  on public.eqemu_npc_types using gin (name extensions.gin_trgm_ops);
create index if not exists opendkp_auction_bids_character_name_trgm
  on public.opendkp_auction_bids using gin (character_name extensions.gin_trgm_ops);
create index if not exists opendkp_auction_bids_user_login_trgm
  on public.opendkp_auction_bids using gin (user_login extensions.gin_trgm_ops);
create index if not exists encounter_players_character_name_trgm
  on public.encounter_players using gin (character_name extensions.gin_trgm_ops);
