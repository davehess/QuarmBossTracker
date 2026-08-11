-- #207 callout overlay — record dismissals as a DIRECTION, not a new table.
--
-- trigger_timing_feedback already carries trigger_id / trigger_name /
-- direction / fired_at / voted_at / voter_character / note, which is exactly
-- the shape a dismissal wants. Two implicit directions join the three explicit
-- votes (docs/DESIGN-callout-overlay.md §3.2):
--
--   dismissed — the raider cleared the callout or its countdown chip. The most
--               honest signal available, and free: they were already swatting
--               it away. (The explicit widget got 47 votes from 7 people in a
--               month — pressing a button mid-raid competes with playing.)
--   expired   — the row aged out untouched. The CONTROL GROUP. Without it a
--               dismissal count cannot become a dismissal RATE, and 3
--               dismissals is damning at 3 fires and meaningless at 300.
--
-- Dismiss LATENCY needs no column: voted_at − fired_at already separates
-- "swatted it instantly, it's noise" (<1s) from "read it, acted, then cleared
-- it" (several seconds) — opposite verdicts a plain count would conflate.
--
-- Idempotent: drop-if-exists then re-add, so re-running is a no-op.

alter table public.trigger_timing_feedback
  drop constraint if exists trigger_timing_feedback_direction_check;

alter table public.trigger_timing_feedback
  add constraint trigger_timing_feedback_direction_check
  check (direction = any (array['earlier'::text, 'good'::text, 'too_early'::text,
                                'dismissed'::text, 'expired'::text]));
