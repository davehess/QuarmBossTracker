-- Rewrite the seeded voice triggers in the portable action shape so they
-- fire on EVERY Mimic version, not just v3.0.64+. The portable combo:
--   - text_overlay action (with `tts`) → instant visual + spoken call-out
--   - timer_duration_sec → visible countdown row in the trigger overlay
--   - warning_seconds + warning_text (future) → single pre-end voiced warning
--
-- Mimic's triggers.html overlay paints all active timers as concurrent
-- rows, ticks them down, and pops amber in the last 5s. Quiet-mode
-- raiders (TTS off) still see the visible countdown so they can react
-- to the visual cue alone.
--
-- The v3.0.64 `voice` action with marks (multi-tick countdown) is kept
-- as the next-step upgrade for the few triggers that need two timed
-- callouts (Tank Buster 10s + 4s, Death touch 10s + 4s). When Mimic is
-- uniformly updated past v3.0.64, future additions can use marks. For
-- now we land the most critical line at the single-warning slot and
-- rely on the visible timer to cover the rest.

-- 1) Emperor Ssra Tank Buster — portable shape.
UPDATE public.guild_triggers
SET actions = '[
  {
    "type": "text_overlay",
    "text": "TANK BUSTER incoming",
    "tts":  "Tank buster incoming",
    "color": "red",
    "duration_ms": 5000
  }
]'::jsonb,
    timer_duration_sec = 60,
    notes = 'DRAFT — placeholder regex. Verify on next Ssra pull. ' ||
            'text_overlay (instant call-out) + 60s timer (visible ' ||
            'countdown). The 4s "D.A. now" mark requires v3.0.64+ ' ||
            'voice-action marks; for backward compat we land the most ' ||
            'critical line (D.A. cast prep) at the single warning slot.'
WHERE guild_id = 'wolfpack' AND name = 'Emperor Ssra Tank Buster — countdown';

-- 2) Divine Intervention fired — portable, no timer.
UPDATE public.guild_triggers
SET actions = '[
  {
    "type": "text_overlay",
    "text": "D.I. → {tank}",
    "tts":  "D. I. fired on {tank}",
    "color": "yellow",
    "duration_ms": 4000
  }
]'::jsonb,
    notes = 'DRAFT — verify cleric''s log shape and confirm the named ' ||
            'capture (?<tank>...) populates. Single text_overlay with ' ||
            'tts covers the announcement; no timer needed (DI fires ' ||
            'aperiodically). Works on all Mimic versions.'
WHERE guild_id = 'wolfpack' AND name = 'Divine Intervention fired';

-- 3) Death touch — countdown. Portable + 60s visible timer.
UPDATE public.guild_triggers
SET actions = '[
  {
    "type": "text_overlay",
    "text": "DEATH TOUCH incoming",
    "tts":  "Death touch incoming, D.A. ready",
    "color": "red",
    "duration_ms": 5000
  }
]'::jsonb,
    timer_duration_sec = 60,
    notes = 'DRAFT — placeholder regex covers cast/emote/hit. Assumes ' ||
            '60s recast; adjust timer_duration_sec per boss. Visible ' ||
            'countdown row + instant call-out works on every Mimic.'
WHERE guild_id = 'wolfpack' AND name = 'Death touch — countdown';

-- 4) Death touch — RIP.
UPDATE public.guild_triggers
SET actions = '[
  {
    "type": "text_overlay",
    "text": "RIP {victim}",
    "tts":  "Rest in Peace {victim}",
    "color": "yellow",
    "duration_ms": 4000
  }
]'::jsonb
WHERE guild_id = 'wolfpack' AND name = 'Death touch — RIP';

-- 5) NEW: Enrage. Visible timer + instant call-out.
INSERT INTO public.guild_triggers
  (guild_id, name, category, enabled, source, pattern, pattern_flags,
   cooldown_seconds, timer_duration_sec, actions, notes)
VALUES
  ('wolfpack',
   'Enrage',
   'mechanic',
   false,
   'log_line',
   '(?<boss>[A-Z][\w '']+) (?:goes into a frenzy|enrages|begins to enrage|''s flesh begins to glow)',
   'i',
   10,
   30,
   '[
      {
        "type": "text_overlay",
        "text": "ENRAGE — {boss}",
        "tts":  "Enrage, melee back off",
        "color": "red",
        "duration_ms": 6000
      }
    ]'::jsonb,
   'DRAFT — broad enrage detector. Tune the regex once you confirm what your bosses emit. Visible 30s timer covers typical enrage duration; adjust per boss. Works on all Mimic versions.'
  )
ON CONFLICT DO NOTHING;

-- 6) NEW: Dodgeable AOE template. Officers clone this row per specific
-- AOE they want voiced.
INSERT INTO public.guild_triggers
  (guild_id, name, category, enabled, source, pattern, pattern_flags,
   cooldown_seconds, timer_duration_sec, actions, notes)
VALUES
  ('wolfpack',
   'AOE — dodge (template)',
   'mechanic',
   false,
   'log_line',
   '(?<boss>[A-Z][\w '']+) (?:begins to cast|points at the ground|raises (?:his|her|its) staff)',
   'i',
   8,
   0,
   '[
      {
        "type": "text_overlay",
        "text": "DODGE — {boss}",
        "tts":  "Move out of the AOE",
        "color": "orange",
        "duration_ms": 5000
      }
    ]'::jsonb,
   'TEMPLATE — clone this row for each specific AOE you want voiced. Tune the regex to the exact emote / cast line, customize the tts text. Leave enabled=false on the template row; enable the clones.'
  )
ON CONFLICT DO NOTHING;
