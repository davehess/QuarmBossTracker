-- AA data mirrored from the EQMacEmu dump, for inferring buff durations
-- (Spell Casting Reinforcement etc.) and resolving the numeric AA ids in a
-- player's Quarmy AAIndex → name + per-rank effect.
--
-- altadv_vars: the AA list. skill_id = per-rank/internal id (PK); eqmacid = the
--   grouped Mac-client ability id (what a Quarmy AAIndex row references); name
--   is a real display name; classes = class bitmask; max_level = ranks.
-- aa_effects: per-(aaid, slot) effect. effectid = SPA; base1/base2 = values —
--   the buff-duration % (5/15/30 on a duration AA) lives in base1.

CREATE TABLE IF NOT EXISTS public.eqemu_altadv_vars (
  skill_id          integer PRIMARY KEY,
  eqmacid           integer,
  name              text,
  cost              integer,
  max_level         integer,
  type              integer,
  spell_type        integer,
  prereq_skill      integer,
  prereq_minpoints  integer,
  spellid           integer,
  classes           integer,
  class_type        integer,
  aa_expansion      integer,
  special_category  integer,
  level_inc         integer,
  cost_inc          integer,
  synced_at         timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eqemu_aa_effects (
  aaid      integer NOT NULL,
  slot      integer NOT NULL,
  effectid  integer,
  base1     integer,
  base2     integer,
  synced_at timestamptz DEFAULT now(),
  PRIMARY KEY (aaid, slot)
);

CREATE INDEX IF NOT EXISTS idx_altadv_vars_eqmacid ON public.eqemu_altadv_vars (eqmacid);
CREATE INDEX IF NOT EXISTS idx_aa_effects_effectid ON public.eqemu_aa_effects (effectid);

ALTER TABLE public.eqemu_altadv_vars ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eqemu_aa_effects  ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "altadv_vars read" ON public.eqemu_altadv_vars;
DROP POLICY IF EXISTS "aa_effects read"  ON public.eqemu_aa_effects;
CREATE POLICY "altadv_vars read" ON public.eqemu_altadv_vars FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY "aa_effects read"  ON public.eqemu_aa_effects  FOR SELECT TO anon, authenticated USING (true);
