-- eqemu_spells — spell catalog for cross-referencing item procs and
-- threat-related abilities. Joined with eqemu_items.proc_effect to resolve
-- weapon procs into named spells (e.g. item 27315 proc_effect=1234 → 'Enraging Blow').
--
-- Minimum useful columns for the threat calculator:
--   id, name, mana, buffduration, recourse_link, targettype, skill,
--   effect_id_1, effect_base_value_1 (first effect slot — usually carries
--   the hate value for instant-hate procs)
--
-- Populate via the same EQEmu sync mechanism that fills eqemu_items.
-- All other spells_new columns can be added later as needed.
CREATE TABLE IF NOT EXISTS eqemu_spells (
  id                    INT PRIMARY KEY,
  name                  TEXT NOT NULL,
  mana                  INT,
  buffduration          INT,
  buffdurationformula   INT,
  recourse_link         INT,
  targettype            INT,
  skill                 INT,
  -- First effect slot — enough for proc-hate detection. Add more slots later.
  effect_id_1           INT,
  effect_base_value_1   INT,
  effect_id_2           INT,
  effect_base_value_2   INT,
  effect_id_3           INT,
  effect_base_value_3   INT,
  -- Flag fields commonly needed
  cast_time             INT,
  recast_time           INT,
  pushback              REAL,
  zonetype              INT,
  -- Free-form metadata for things we don't model yet
  raw                   JSONB,
  synced_at             TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS eqemu_spells_name_idx
  ON eqemu_spells USING gin (to_tsvector('english', name));

-- Convenience view that joins items with their proc spell — handy for the
-- bot's /api/items endpoint and the future TPS calculator.
CREATE OR REPLACE VIEW item_with_proc AS
SELECT
  i.id              AS item_id,
  i.name            AS item_name,
  i.damage,
  i.delay,
  i.proc_effect     AS proc_spell_id,
  s.name            AS proc_spell_name,
  s.mana            AS proc_mana,
  s.effect_id_1     AS proc_effect_id_1,
  s.effect_base_value_1 AS proc_hate_hint
FROM eqemu_items i
LEFT JOIN eqemu_spells s ON s.id = i.proc_effect;
