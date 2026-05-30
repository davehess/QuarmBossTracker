-- Guild-tuned triggers. Officers create + maintain on /admin/triggers;
-- agents fetch via GET /api/agent/guild-triggers every ~10 min and
-- evaluate against the live log tail. Personal triggers live in
-- personal_triggers.json on each agent's local disk (not in Supabase)
-- and merge with guild triggers at evaluation time.
--
-- Schema mirrors the DND Overlay trigger model (zeraxx1/DnDOverlay) —
-- pattern + condition + named action list + end_early predicates +
-- cooldown — but stored centrally so the whole guild can tune raid
-- callouts in one place instead of every player maintaining their own
-- GINA / EQLogParser packs.

CREATE TABLE IF NOT EXISTS guild_triggers (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  guild_id              text NOT NULL DEFAULT 'wolfpack',
  name                  text NOT NULL,
  category              text NOT NULL DEFAULT 'callout',
  enabled               boolean NOT NULL DEFAULT true,
  source                text NOT NULL DEFAULT 'log_line',
  pattern               text NOT NULL,
  pattern_flags         text NOT NULL DEFAULT 'i',
  condition_expr        text,
  actions               jsonb NOT NULL DEFAULT '[]'::jsonb,
  cooldown_seconds      integer NOT NULL DEFAULT 0,
  applies_to_classes    text[],
  applies_to_roles      text[],
  end_early_pattern     text,
  end_early_condition   text,
  created_by_discord_id text,
  created_by_name       text,
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  notes                 text
);

CREATE INDEX IF NOT EXISTS guild_triggers_enabled_idx
  ON guild_triggers (guild_id, enabled, category);

CREATE OR REPLACE FUNCTION _touch_guild_triggers_updated_at() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS guild_triggers_touch ON guild_triggers;
CREATE TRIGGER guild_triggers_touch BEFORE UPDATE ON guild_triggers
  FOR EACH ROW EXECUTE FUNCTION _touch_guild_triggers_updated_at();

ALTER TABLE guild_triggers ENABLE ROW LEVEL SECURITY;

INSERT INTO guild_triggers (name, category, pattern, actions, cooldown_seconds, notes)
VALUES
  (
    'Lord Nagafen full heal',
    'phase',
    '^Lord Nagafen has fully healed!$',
    '[{"type":"text_overlay","text":"NAGGY FULL HEAL — RESET","color":"red","duration_ms":6000}]'::jsonb,
    30,
    'Naggy resets aggro on a full heal — overlay to make sure tanks see it'
  ),
  (
    'Rampage callout',
    'rampage',
    '^(?<npc>.+) goes on a RAMPAGE against (?<target>.+)!$',
    '[{"type":"text_overlay","text":"RAMPAGE on {target}","color":"orange","duration_ms":4000}]'::jsonb,
    5,
    'Generic rampage callout. Add class filter (Warrior/SK/Pal) if too noisy.'
  ),
  (
    'Boss enrage',
    'mechanic',
    '\benrages\.?$',
    '[{"type":"text_overlay","text":"BOSS ENRAGED — burn or evac","color":"red","duration_ms":8000}]'::jsonb,
    30,
    NULL
  )
ON CONFLICT DO NOTHING;
