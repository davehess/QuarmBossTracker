-- Looping countdowns for guild triggers (FB-31).
--
-- A trigger with a countdown (timer_duration_sec) used to run once and vanish. Some callouts
-- are a clock that should keep going until the fight is over -- a mob that re-casts on a fixed
-- cadence, a rotation to call every N seconds -- and a raider had to re-arm it by hand each lap.
-- Agent 3.7.99 (beta channel) restarts the countdown when it ends if the trigger says so, and
-- warns again each lap.
--
--   timer_loop      true = restart the countdown at zero instead of letting it expire.
--                   Needs timer_duration_sec > 0 (the web form enforces that).
--   timer_loop_max  how many MORE times it restarts before it stops; NULL = until it is
--                   cancelled (the cancel phrase, the raider's close button, or the mob dying).
--                   The agent caps it at 1000 and reads 0 as "no limit".
--
-- _guildTriggersFor() in the bot returns raw guild_triggers rows (no column whitelist) and the
-- agent spreads the row it receives, so adding the columns is sufficient: both
-- /api/agent/guild-triggers and the multiplexed /poll bundle carry them with no bot change. The
-- agents' no-change gate hashes id@updated_at, and the guild_triggers_touch BEFORE UPDATE trigger
-- stamps updated_at on any edit, so a change to only these two columns still reaches running
-- agents on their next poll.
--
-- Older agents ignore both fields (the countdown runs once, as before). Web: /admin/triggers
-- gained the form fields in the same change, together with the countdown and warning fields
-- that were SQL-only until now.
--
-- Applied to production by MCP on 2026-10-07 (as guild_triggers_loop), ahead of the web build that
-- selects the two columns; the same file lands on main and beta so the sync merges it cleanly.

alter table public.guild_triggers
  add column if not exists timer_loop     boolean not null default false,
  add column if not exists timer_loop_max integer;

comment on column public.guild_triggers.timer_loop is
  'Restart the countdown (timer_duration_sec) when it ends instead of letting it expire, warning again each lap. Needs timer_duration_sec > 0. Read by agent 3.7.99+; older agents run it once.';
comment on column public.guild_triggers.timer_loop_max is
  'How many more times a looping countdown restarts before it stops. NULL = until cancelled (cancel phrase, the raider closing it, the mob dying). Ignored unless timer_loop is true.';
