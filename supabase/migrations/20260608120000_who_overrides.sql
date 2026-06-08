-- who_overrides — officer-curated manual class + Zek-flag overrides on top of
-- the observation-only who_observations log. The collected /who data is often
-- missing class (every /anon row reports no class) or needs a manual Zek tag
-- for known PvP-guild affiliates. This is the web app's editable layer, viewed
-- + edited on /admin/who. Keyed by character name (EQ /who names are canonical
-- and case-consistent); a lower() index backs case-insensitive lookups.
--
-- This is intentionally SEPARATE from characters.class (OpenDKP roster, members
-- only) so we can also tag non-member characters seen in /who. Effective class
-- shown in the UI = override.class ?? latest observed class.

create table if not exists who_overrides (
  guild_id    text not null default 'wolfpack',
  character   text not null,
  class       text,                 -- manual class override (null = none set)
  is_zek      boolean,              -- manual Zek flag (null = unset → auto from guild)
  note        text,
  set_by      text,                 -- discord user id of the officer who set it
  set_by_name text,
  updated_at  timestamptz not null default now(),
  primary key (guild_id, character)
);

create index if not exists who_overrides_lower_idx
  on who_overrides (guild_id, lower(character));

alter table who_overrides enable row level security;
drop policy if exists who_overrides_read on who_overrides;
create policy who_overrides_read on who_overrides
  for select to authenticated using (true);
grant select on who_overrides to authenticated;
grant all    on who_overrides to service_role;

-- who_directory — one row per observed character, collapsing the append-only
-- who_observations log into the "best known" view the directory page needs:
--   * latest observation (last_seen + last-known race/guild/anon/gm/rank)
--   * best-known class / level / guild = most-recent NON-NULL value, so an
--     /anon row (class null) doesn't blank out a class we saw earlier
--   * observation count + first_seen
--   * ever_zek_guild = were they ever seen in guild 'Zek' (auto-Zek signal)
-- security_invoker so the base-table RLS (authenticated read) governs reads;
-- the officer page queries it with the service-role key anyway.
create or replace view who_directory
with (security_invoker = on) as
with latest as (
  select distinct on (lower(character))
    lower(character) as k, guild_id, character, level, race, class,
    guild_name, guild_rank, anonymous, gm, observed_at as last_seen
  from who_observations
  order by lower(character), observed_at desc
),
best_class as (
  select distinct on (lower(character)) lower(character) as k, class as best_class
  from who_observations
  where class is not null and class <> ''
  order by lower(character), observed_at desc
),
best_level as (
  select distinct on (lower(character)) lower(character) as k, level as best_level
  from who_observations
  where level is not null
  order by lower(character), observed_at desc
),
best_guild as (
  select distinct on (lower(character)) lower(character) as k, guild_name as best_guild
  from who_observations
  where guild_name is not null and guild_name <> ''
  order by lower(character), observed_at desc
),
agg as (
  select lower(character) as k,
         count(*)          as obs_count,
         min(observed_at)  as first_seen,
         bool_or(guild_name = 'Zek') as ever_zek_guild
  from who_observations
  group by lower(character)
)
select
  l.character,
  l.k                                       as character_key,
  l.guild_id,
  l.race,
  coalesce(bc.best_class, l.class)          as observed_class,
  coalesce(bl.best_level, l.level)          as level,
  coalesce(bg.best_guild, l.guild_name)     as guild_name,
  l.guild_rank,
  l.anonymous,
  l.gm,
  l.last_seen,
  a.first_seen,
  a.obs_count,
  coalesce(a.ever_zek_guild, false)         as ever_zek_guild
from latest l
join agg a on a.k = l.k
left join best_class bc on bc.k = l.k
left join best_level bl on bl.k = l.k
left join best_guild bg on bg.k = l.k;

grant select on who_directory to authenticated, service_role;
