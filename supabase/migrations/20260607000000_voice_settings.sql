-- voice_settings — global ripcord + tunables for the bot's voice-trigger
-- pipeline (RAID_VOICE_CHANNEL_ID + OFFNIGHT_VOICE_CHANNEL_ID, fed by
-- /api/agent/trigger with mode:'voice'). One row per guild.
--
-- Reads: hot path — bot consults on every voice fire. Cached 30s in
-- utils/voiceSettings.js so a flapping `enabled` toggle still kills the
-- noise inside half a minute.
-- Writes: officers only via /admin/voice (Next.js server action with
-- service_role).

CREATE TABLE IF NOT EXISTS public.voice_settings (
  guild_id              text PRIMARY KEY,
  enabled               boolean NOT NULL DEFAULT true,
  -- Edge TTS voice id (en-US-AriaNeural, en-GB-RyanNeural, …). Per-fire
  -- voice_id from the trigger action wins; this is the fallback.
  default_voice         text    NOT NULL DEFAULT 'en-US-AriaNeural',
  -- 0..200; 100 = unit gain. Applied via @discordjs/voice's inlineVolume.
  -- Above ~150 clips noticeably; we don't clamp in SQL to leave room
  -- for raid-leader cranking during a wipe-stop.
  volume_pct            integer NOT NULL DEFAULT 100,
  -- Drop a fire if its message contains ANY of these substrings
  -- (case-insensitive). For one-off shut-ups like "rampage" during a
  -- mechanic phase.
  skip_patterns         text[]  NOT NULL DEFAULT '{}'::text[],
  -- Drop a fire if its TRIGGER NAME matches one of these exactly.
  -- For "this whole trigger has gone rogue, mute it without disabling".
  skip_trigger_names    text[]  NOT NULL DEFAULT '{}'::text[],
  updated_by_discord_id text,
  updated_by_name       text,
  updated_at            timestamptz NOT NULL DEFAULT now()
);

-- Seed Wolf Pack's row at install. Idempotent — re-running the migration
-- doesn't reset the user's tuning.
INSERT INTO public.voice_settings (guild_id)
VALUES ('wolfpack')
ON CONFLICT (guild_id) DO NOTHING;

ALTER TABLE public.voice_settings ENABLE ROW LEVEL SECURITY;

-- Officers and the bot service-role write; everyone signed in can read
-- (the /admin/voice page is officer-gated at the route level anyway, but
-- this keeps the door closed at the DB if a non-officer ever probes it).
DROP POLICY IF EXISTS "voice_settings read" ON public.voice_settings;
CREATE POLICY "voice_settings read" ON public.voice_settings
  FOR SELECT TO authenticated USING (true);

-- ── Seeded raid-call-out triggers (DISABLED — verify the patterns on the
-- next pull, then flip enabled=true in /admin/triggers). The patterns are
-- placeholders based on common EQ wording; Quarm may differ. They use
-- the voice action that the agent already evaluates (see
-- packages/wolfpack-logsync/index.js _fireTriggerActions where a.type ===
-- 'voice'). voice action takes a `marks` array of {at_ms, text} for
-- multi-tick countdowns — so one trigger fires multiple voice lines on a
-- schedule once the pattern matches.

INSERT INTO public.guild_triggers
  (guild_id, name, category, enabled, source, pattern, pattern_flags,
   cooldown_seconds, actions, notes)
VALUES
  -- Emperor Ssra Tank Buster countdown.
  -- Pattern HEURISTIC — looking for the cast/begin line of his Tank
  -- Buster ability. Common forms across EQ raid bosses: a "begins to
  -- cast" or an emote. Update the pattern to whatever shows up in the
  -- log when he actually fires it. Recast assumed 60s; tune at_ms to
  -- (recast - 10s) and (recast - 4s).
  ('wolfpack',
   'Emperor Ssra Tank Buster — countdown',
   'mechanic',
   false,
   'log_line',
   'Emperor Ssraeshza (?:begins to cast|fires|hits .* for) .*tank ?buster',
   'i',
   55,
   '[
      {
        "type": "voice",
        "marks": [
          { "at_ms": 50000, "text": "10 seconds tank buster, big heals, spell shields, runes" },
          { "at_ms": 56000, "text": "start greater curse remove now" }
        ]
      },
      {
        "type": "text_overlay",
        "text": "TANK BUSTER incoming (10s)",
        "color": "red",
        "duration_ms": 6000
      }
    ]'::jsonb,
   'DRAFT — placeholder pattern. Verify on next Ssra pull, fix the pattern, then enable. The voice action stays the same once the pattern resolves.'
  ),
  -- Divine Intervention save call-out.
  -- EQ DI lands a buff on the tank; the actual save (DI procs and
  -- prevents a death) typically shows as a heal/save line. We listen
  -- for the cast-on-other or the proc save and speak with the tank
  -- name captured. Tune the pattern to match what your clerics
  -- actually log on Quarm.
  ('wolfpack',
   'Divine Intervention fired',
   'heal',
   false,
   'log_line',
   '(?<tank>[A-Z][\w'']+)(?:''s wounds heal|is filled with divine|has been graced with divine intervention)',
   'i',
   5,
   '[
      {
        "type": "voice",
        "message": "D. I. fired on {tank}"
      },
      {
        "type": "text_overlay",
        "text": "D.I. → {tank}",
        "color": "yellow",
        "duration_ms": 4000
      }
    ]'::jsonb,
   'DRAFT — placeholder pattern. The named capture (?<tank>...) is what fills {tank} in the voice action; if your cleric logs name the tank differently, tweak the regex while keeping the capture name.'
  )
ON CONFLICT DO NOTHING;
