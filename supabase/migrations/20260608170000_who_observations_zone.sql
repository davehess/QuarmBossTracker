-- who_observations.zone — the EQ zone SHORT name a character was in, captured
-- from `/who all` output. A plain in-zone `/who` carries no zone clause, so this
-- is null for most rows; `/who all` rows (e.g. "... <Guild> ZONE: oasis") fill it.
-- Lets the /who directory show + sort by where we last saw someone.
alter table public.who_observations add column if not exists zone text;

-- Rebuild the directory view to surface the most-recent non-null zone per
-- character (same DISTINCT-ON-by-latest pattern as class/level/guild).
create or replace view public.who_directory as
 WITH latest AS (
         SELECT DISTINCT ON ((lower(who_observations."character"))) lower(who_observations."character") AS k,
            who_observations.guild_id,
            who_observations."character",
            who_observations.level,
            who_observations.race,
            who_observations.class,
            who_observations.guild_name,
            who_observations.guild_rank,
            who_observations.anonymous,
            who_observations.gm,
            who_observations.observed_at AS last_seen
           FROM who_observations
          ORDER BY (lower(who_observations."character")), who_observations.observed_at DESC
        ), best_class AS (
         SELECT DISTINCT ON ((lower(who_observations."character"))) lower(who_observations."character") AS k,
            who_observations.class AS best_class
           FROM who_observations
          WHERE who_observations.class IS NOT NULL AND who_observations.class <> ''::text
          ORDER BY (lower(who_observations."character")), who_observations.observed_at DESC
        ), best_level AS (
         SELECT DISTINCT ON ((lower(who_observations."character"))) lower(who_observations."character") AS k,
            who_observations.level AS best_level
           FROM who_observations
          WHERE who_observations.level IS NOT NULL
          ORDER BY (lower(who_observations."character")), who_observations.observed_at DESC
        ), best_guild AS (
         SELECT DISTINCT ON ((lower(who_observations."character"))) lower(who_observations."character") AS k,
            who_observations.guild_name AS best_guild
           FROM who_observations
          WHERE who_observations.guild_name IS NOT NULL AND who_observations.guild_name <> ''::text
          ORDER BY (lower(who_observations."character")), who_observations.observed_at DESC
        ), best_zone AS (
         SELECT DISTINCT ON ((lower(who_observations."character"))) lower(who_observations."character") AS k,
            who_observations.zone AS best_zone,
            who_observations.observed_at AS zone_seen
           FROM who_observations
          WHERE who_observations.zone IS NOT NULL AND who_observations.zone <> ''::text
          ORDER BY (lower(who_observations."character")), who_observations.observed_at DESC
        ), agg AS (
         SELECT lower(who_observations."character") AS k,
            count(*) AS obs_count,
            min(who_observations.observed_at) AS first_seen,
            bool_or(btrim(who_observations.guild_name) ~* '^(zek|rise of zek)$'::text) AS ever_zek_guild
           FROM who_observations
          GROUP BY (lower(who_observations."character"))
        )
 SELECT l."character",
    l.k AS character_key,
    l.guild_id,
    l.race,
    COALESCE(bc.best_class, l.class) AS observed_class,
    COALESCE(bl.best_level, l.level) AS level,
    COALESCE(bg.best_guild, l.guild_name) AS guild_name,
    l.guild_rank,
    l.anonymous,
    l.gm,
    l.last_seen,
    a.first_seen,
    a.obs_count,
    COALESCE(a.ever_zek_guild, false) AS ever_zek_guild,
    bz.best_zone AS zone,
    bz.zone_seen AS zone_seen
   FROM latest l
     JOIN agg a ON a.k = l.k
     LEFT JOIN best_class bc ON bc.k = l.k
     LEFT JOIN best_level bl ON bl.k = l.k
     LEFT JOIN best_guild bg ON bg.k = l.k
     LEFT JOIN best_zone bz ON bz.k = l.k;
