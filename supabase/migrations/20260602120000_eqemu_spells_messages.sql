-- eqemu_spells: add the three CLIENT message strings from spells_new so we can
-- (a) link a logged spell NAME to its PQDI /spell/<id> page on the agent
--     dashboard, and
-- (b) infer which spell landed from an effect line in the log (the agent sees
--     "You feel a little better." and matches it back to the spell).
--
-- These are EQ's exact landing text, e.g. for Minor Healing (PQDI /spell/200):
--   cast_on_you   = "You feel a little better."
--   cast_on_other = " feels a little better."   -- client prepends the target name
--   spell_fades   = (wear-off message)
--
-- Populated by scripts/sync-from-eqmac.js (spells_new → eqemu_spells), which is
-- run weekly by .github/workflows/sync-quarm.yml. Until the next sync runs these
-- stay NULL; the agent treats a name with no id as plain (unlinked) text.

ALTER TABLE eqemu_spells ADD COLUMN IF NOT EXISTS cast_on_you   TEXT;
ALTER TABLE eqemu_spells ADD COLUMN IF NOT EXISTS cast_on_other TEXT;
ALTER TABLE eqemu_spells ADD COLUMN IF NOT EXISTS spell_fades   TEXT;

-- Effect-line inference matches the WHOLE logged sentence against cast_on_you
-- (self) or the trailing part of cast_on_other (others). Index both so the
-- bot's future message→spell lookup endpoint stays fast over ~30k spells.
CREATE INDEX IF NOT EXISTS eqemu_spells_cast_on_you_idx
  ON eqemu_spells (cast_on_you);
CREATE INDEX IF NOT EXISTS eqemu_spells_cast_on_other_idx
  ON eqemu_spells (cast_on_other);
