-- Pre-end warning callout for guild triggers that carry a countdown.
--
-- The agent already reads t.warning_seconds / t.warning_text when it arms a
-- timer (packages/wolfpack-logsync/index.js, _startTimer -> warn_ms/warn_text),
-- and the triggers overlay fires the callout once when the countdown crosses
-- BELOW warning_seconds remaining (apps/mimic/triggers.html). Until now only
-- GINA/EQLP-imported personal triggers could carry those fields -- guild
-- triggers had no column for them, so a guild trigger could count down but
-- never pre-warn.
--
-- _guildTriggersFor() returns raw guild_triggers rows, so adding the columns is
-- sufficient: both the standalone /api/agent/guild-triggers endpoint and the
-- multiplexed /poll bundle pick them up with no bot change.
--
-- warning_seconds is SECONDS REMAINING, not seconds elapsed.
--
-- Applied live 2026-08-03 via Supabase MCP (version 20260803014721) so the
-- Feeblemind / Thought Horror Overfiend callout could arm mid-raid; this file
-- is the identical DDL committed so repo and prod history stay in sync.

alter table public.guild_triggers
  add column if not exists warning_seconds integer,
  add column if not exists warning_text    text;

comment on column public.guild_triggers.warning_seconds is
  'Pre-end callout threshold in SECONDS REMAINING on the trigger''s countdown (needs timer_duration_sec > 0). Fires once when the timer crosses below this value; the latch resets if the timer restarts.';
comment on column public.guild_triggers.warning_text is
  'Text spoken + flashed for the pre-end callout. Both this and warning_seconds must be set for the warning to arm.';
