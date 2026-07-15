-- Per-class carrier counts for guild common macros ({"Druid": 4, ...}) —
-- powers the /me/ui class filter ("what do other druids run"). Privacy floor
-- unchanged: rows still only exist at >= 3 distinct carrying characters.
ALTER TABLE public.common_macros
  ADD COLUMN IF NOT EXISTS classes jsonb;
