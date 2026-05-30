-- Officer-tunable class composition targets for /admin/attendance.
-- One row per (guild, raid_size, class). Most guilds only need one
-- raid_size (the default '60-man'), but the column is there for the
-- rare case where you want to spec a 40-man alt-night roster vs the
-- main 60-man Friday roster.

CREATE TABLE IF NOT EXISTS raid_targets (
  guild_id    text NOT NULL DEFAULT 'wolfpack',
  raid_size   text NOT NULL DEFAULT '60-man',
  class       text NOT NULL,
  target      integer NOT NULL CHECK (target >= 0),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  updated_by  text,
  PRIMARY KEY (guild_id, raid_size, class)
);

CREATE OR REPLACE FUNCTION _touch_raid_targets() RETURNS trigger AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS raid_targets_touch ON raid_targets;
CREATE TRIGGER raid_targets_touch BEFORE UPDATE ON raid_targets
  FOR EACH ROW EXECUTE FUNCTION _touch_raid_targets();

ALTER TABLE raid_targets ENABLE ROW LEVEL SECURITY;

INSERT INTO raid_targets (guild_id, raid_size, class, target) VALUES
  ('wolfpack', '60-man', 'Bard', 8),
  ('wolfpack', '60-man', 'Beastlord', 3),
  ('wolfpack', '60-man', 'Cleric', 8),
  ('wolfpack', '60-man', 'Druid', 3),
  ('wolfpack', '60-man', 'Enchanter', 4),
  ('wolfpack', '60-man', 'Magician', 2),
  ('wolfpack', '60-man', 'Monk', 3),
  ('wolfpack', '60-man', 'Necromancer', 3),
  ('wolfpack', '60-man', 'Paladin', 2),
  ('wolfpack', '60-man', 'Ranger', 3),
  ('wolfpack', '60-man', 'Rogue', 4),
  ('wolfpack', '60-man', 'Shadow Knight', 3),
  ('wolfpack', '60-man', 'Shaman', 3),
  ('wolfpack', '60-man', 'Warrior', 4),
  ('wolfpack', '60-man', 'Wizard', 4),
  ('wolfpack', '60-man', 'Flex', 3)
ON CONFLICT (guild_id, raid_size, class) DO NOTHING;
