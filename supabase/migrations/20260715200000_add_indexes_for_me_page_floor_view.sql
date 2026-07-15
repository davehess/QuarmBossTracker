-- /me took >60s (Uilnayar 2026-07-15). EXPLAIN showed character_data_floor at
-- 22.5s: three MIN(ts) GROUP BY lower(speaker) aggregates over ~300k
-- chat_messages rows (guild channel twice, raid once) re-run on every call.
-- This composite lets each aggregate run as a grouped index scan.
CREATE INDEX IF NOT EXISTS chat_messages_channel_speaker_ts
  ON public.chat_messages (channel, lower(speaker), ts);
-- /me per-character queries with no matching index:
CREATE INDEX IF NOT EXISTS contributions_contributor_character_idx
  ON public.contributions (contributor_character);
CREATE INDEX IF NOT EXISTS encounter_combat_rollup_character_name_idx
  ON public.encounter_combat_rollup (character_name);
