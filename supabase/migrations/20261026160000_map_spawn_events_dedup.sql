-- A repeated spawn-map event is stored once (the guild lead, 2026-10-26: "if the bot restarted and during that timeframe
-- i killed something it would need to collect any of those spawn id + name matches and sync them back in. Source is
-- important.").
--
-- The Mimic agent now HOLDS map events the bot did not answer for and sends them again when the bot is back. A send
-- whose answer was lost (the bot took it, then restarted before replying) arrives twice, and this table had no unique
-- key, so the repeat became a second row. The bot now inserts with insert_ignore_duplicates (migration
-- 20261020200000: ON CONFLICT DO NOTHING with no target), which skips whatever this index already holds.
--
-- An event is "the same" when the same character reported the same thing at the same instant:
--   guild, zone, spawn point, kind, spawn id (none counts as -1), `at`, and the reporting character (none counts as '').
-- Two different raiders who both saw the same death are two rows, as before: the source is part of the key, because
-- the source is what the map shows ("seen by ...").
--
-- Apply AFTER the bot change is live, or at least not long before it: with the index in place and the old bot, a repeated
-- batch is rejected whole (23505) instead of stored twice. Existing exact repeats are removed first (the lowest id
-- stays), or the index could not be built. The table holds 24 hours of rows, so both statements are quick.
-- Idempotent.

delete from public.map_spawn_events
 where id in (
   select id from (
     select id,
            row_number() over (
              partition by guild_id, zone, point_id, kind, coalesce(spawn_id, -1), at, coalesce(by_character, '')
              order by id
            ) as rn
       from public.map_spawn_events
   ) t
   where t.rn > 1
 );

create unique index if not exists map_spawn_events_dedup_idx
    on public.map_spawn_events (guild_id, zone, point_id, kind, (coalesce(spawn_id, -1)), at, (coalesce(by_character, '')));
