-- Extend guild_triggers into a library model. All triggers live here;
-- per-user opt-in/mute lives on each agent's local disk as
-- selected_triggers.json. The library carries enough metadata for the
-- agent + dashboard to render a useful selector UI.
--
-- New columns:
--   default_scope     'broadcast' | 'personal' | 'class_specific'
--                     Hint to the agent whether to enable on first import.
--   default_enabled   true on first install for default_scope='broadcast'
--                     only. Users explicitly opt-in to personal / class.
--   use_regex         EQLogParser distinction — literal vs regex. Agent
--                     escapes literals before compiling.
--   end_use_regex     Same for end_early_pattern.
--   timer_duration_sec  EQLogParser timer length (for end-overlay timing).
--   end_text          Overlay text to display when timer expires.
--   tags              Folder hierarchy from import (['SafeSpaceSuperGINA',
--                     'AoE']) for filtering in the selector UI.
--   source_pack       Provenance: 'eqlogparser:Triggers.tgf' or 'manual'
--   trigger_again     EQLogParser TriggerAgainOption — how to behave on
--                     repeated matches (0=fire, 1=restart timer, 2=ignore).

ALTER TABLE guild_triggers
  ADD COLUMN IF NOT EXISTS default_scope   text NOT NULL DEFAULT 'broadcast'
    CHECK (default_scope IN ('broadcast','personal','class_specific')),
  ADD COLUMN IF NOT EXISTS default_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS use_regex       boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS end_use_regex   boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS timer_duration_sec integer,
  ADD COLUMN IF NOT EXISTS end_text        text,
  ADD COLUMN IF NOT EXISTS tags            text[] DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS source_pack     text,
  ADD COLUMN IF NOT EXISTS trigger_again   integer NOT NULL DEFAULT 0;

DELETE FROM guild_triggers
 WHERE source_pack IS NULL
   AND name IN ('Lord Nagafen full heal','Rampage callout','Boss enrage');

CREATE INDEX IF NOT EXISTS guild_triggers_scope_idx
  ON guild_triggers (guild_id, default_scope, enabled);
CREATE INDEX IF NOT EXISTS guild_triggers_tags_idx
  ON guild_triggers USING GIN (tags);
