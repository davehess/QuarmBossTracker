-- charm_sessions: which spell, and did the charm run its course?
--
-- The guild lead, 2026-10-08 (enchanters report charms breaking early): the recorded sessions could not
-- answer "how long does each charm spell last when nothing breaks it". They carried no spell, and
-- end_reason is only 'charm_break' (the log prints the same "worn off" line for a natural fade and a
-- resist break) or 'encounter_flush' (truncated). The agent now adds the spell name and a derived flag.
--
--   spell_name  the cast name the agent staged, lower-cased as in its charm table ("allure"); NULL when
--               the cast was not seen
--   ran_full    true  = lived at least 90% of that spell's max duration
--               false = broke sooner
--               NULL  = unknown (no spell, recast mid-session, break line never seen, truncated short)
--
-- Both nullable with no default: every row written before this, and every row from an older agent, stays
-- NULL, which reads as "unknown", never as "broke early". Older rows' duration_sec cannot be used for
-- this question (see docs/DECISIONS-2026-09-21.md §209).
ALTER TABLE public.charm_sessions ADD COLUMN IF NOT EXISTS spell_name text;
ALTER TABLE public.charm_sessions ADD COLUMN IF NOT EXISTS ran_full   boolean;

COMMENT ON COLUMN public.charm_sessions.spell_name IS
  'Charm spell the agent saw cast before the land, lower-cased ("allure"). NULL = not seen / older agent.';
COMMENT ON COLUMN public.charm_sessions.ran_full IS
  'true = the charm lived >= 90% of the spell''s max duration; false = broke sooner; NULL = unknown. Timed from the land and break log lines, not duration_sec.';
