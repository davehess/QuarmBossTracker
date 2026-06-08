-- who_directory: treat "Rise of Zek" the same as "Zek" for auto-Zek detection.
-- The bot already auto-flags both (/^(zek|rise of zek)$/i in mergeWhoData); the
-- view was only matching the bare 'Zek' guild, so Rise of Zek members didn't
-- light up as Zek on /who. Recreate the view with a case-insensitive match on
-- both names (trimmed). Everything else is unchanged from the original.
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
         bool_or(btrim(guild_name) ~* '^(zek|rise of zek)$') as ever_zek_guild
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
