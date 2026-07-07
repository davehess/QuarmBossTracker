-- buff_casts one-time purge (Uilnayar 2026-07-07: "chuck the useless data").
--
-- Verified before this migration: every consumer of buff_casts reads at most
-- 3 HOURS back (bot target-buffs + raid-buff-queue: 3h; extended-target
-- debuffs: 30min; web /raid: 3h) and every consumer SKIPS rows with a NULL
-- spell_name. Live "who has what buff" comes from character_live_state, not
-- this table. So three delete classes lose nothing:
--
--   1. spell_name IS NULL — the "ambiguous landing" bucket: written, never
--      readable (41k rows / 18%). Ingest now rejects these (bot 3.0.142) and
--      agents 3.1.107+ stop sending them.
--   2. spell_name = 'Kneel Test' — misattribution artifact (10k rows). EQEmu's
--      internal test spell shares its landing text ("is struck by a sudden
--      force.") with 33 unrelated knockback effects; the agent's ambiguous-
--      family resolver picked it as the "longest duration" representative.
--      Agents 3.1.107+ drop landing texts shared by >8 spells entirely.
--   3. cast_at older than 7 days — includes a Jan-2025 historical backfill
--      that was unreadable on arrival. Ongoing: the bot's midnight chain now
--      sweeps to BUFF_CASTS_RETENTION_DAYS (default 7).
--
-- Deletes are naturally idempotent; disk space is reclaimed for reuse by
-- autovacuum (the file shrinks over time / stops growing immediately).

DELETE FROM public.buff_casts WHERE spell_name IS NULL;
DELETE FROM public.buff_casts WHERE spell_name = 'Kneel Test';
DELETE FROM public.buff_casts WHERE cast_at < now() - interval '7 days';
