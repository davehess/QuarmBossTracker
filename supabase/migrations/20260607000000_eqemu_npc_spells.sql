-- EQMacEmu NPC spell-list catalog. Mirrors npc_spells (the list metadata —
-- name + parent_list reference + global proc fallback) and npc_spells_entries
-- (the actual spell rows: (list_id, spell_id, minlevel..maxlevel, type,
-- manacost, recast_delay, priority)). Joined via
-- eqemu_npc_types.npc_spells_id → eqemu_npc_spells.id → eqemu_npc_spells_entries.
--
-- Powers the Mob Info "Spells" tab in Mimic + future caster-mob mana-tracking
-- (per-cast subtraction needs manacost from npc_spells_entries → spell catalog).
--
-- Columns are a permissive superset — we keep raw fields verbatim so a future
-- consumer can lean on them without re-syncing.

CREATE TABLE IF NOT EXISTS public.eqemu_npc_spells (
  id              integer PRIMARY KEY,
  name            text,
  parent_list     integer,                 -- inheritance: this list inherits its parent's rows
  attack_proc     integer,                 -- spell id (eqemu_spells.id) of the global proc fallback
  proc_chance     integer,
  range_proc      integer,
  rproc_chance    integer,
  defensive_proc  integer,
  dproc_chance    integer,
  fail_recast     integer,
  engaged_no_sp_recast_min integer,
  engaged_no_sp_recast_max integer,
  engaged_b_self_chance    integer,
  engaged_b_other_chance   integer,
  engaged_d_chance         integer,
  pursue_no_sp_recast_min  integer,
  pursue_no_sp_recast_max  integer,
  pursue_d_chance          integer,
  idle_no_sp_recast_min    integer,
  idle_no_sp_recast_max    integer,
  idle_b_chance            integer,
  synced_at       timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.eqemu_npc_spells_entries (
  npc_spells_id   integer NOT NULL,
  spellid         integer NOT NULL,
  minlevel        integer NOT NULL,
  maxlevel        integer,
  type            bigint,         -- bitmask of when the NPC will use this spell
  manacost        integer,        -- override; -1 = use spell catalog
  recast_delay    bigint,         -- ms; how long before this spell can be cast again
  priority        integer,        -- relative priority within the list
  resist_adjust   integer,
  min_hp          integer,
  max_hp          integer,
  synced_at       timestamptz DEFAULT now(),
  PRIMARY KEY (npc_spells_id, spellid, minlevel)
);

CREATE INDEX IF NOT EXISTS eqemu_npc_spells_entries_list_idx
  ON public.eqemu_npc_spells_entries (npc_spells_id);
CREATE INDEX IF NOT EXISTS eqemu_npc_spells_entries_spell_idx
  ON public.eqemu_npc_spells_entries (spellid);

-- RLS: catalog-level data, world-readable. Service-role still has full write.
ALTER TABLE public.eqemu_npc_spells         ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.eqemu_npc_spells_entries ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS eqemu_npc_spells_read         ON public.eqemu_npc_spells;
DROP POLICY IF EXISTS eqemu_npc_spells_entries_read ON public.eqemu_npc_spells_entries;
CREATE POLICY eqemu_npc_spells_read
  ON public.eqemu_npc_spells FOR SELECT TO anon, authenticated USING (true);
CREATE POLICY eqemu_npc_spells_entries_read
  ON public.eqemu_npc_spells_entries FOR SELECT TO anon, authenticated USING (true);

-- Flattened view: NPC → spells joined through the list + parent inheritance
-- + the spell catalog name. Renders directly into the Mob Info Spells tab.
CREATE OR REPLACE VIEW public.eqemu_npc_spells_resolved AS
WITH RECURSIVE list_chain AS (
  -- root: each list IS a starting point
  SELECT id AS root_id, id AS list_id, parent_list FROM public.eqemu_npc_spells
  UNION
  -- walk up the parent_list chain so inherited rows show too
  SELECT lc.root_id, ns.id AS list_id, ns.parent_list
  FROM public.eqemu_npc_spells ns
  JOIN list_chain lc ON ns.id = lc.parent_list
  WHERE ns.parent_list IS NOT NULL
)
SELECT DISTINCT
  lc.root_id              AS npc_spells_id,
  e.spellid,
  e.minlevel,
  e.maxlevel,
  e.priority,
  e.manacost,
  e.recast_delay,
  s.name                  AS spell_name,
  s.mana                  AS spell_catalog_mana,
  s.cast_time             AS cast_time_ms,
  s.recast_time           AS spell_recast_ms
FROM list_chain lc
JOIN public.eqemu_npc_spells_entries e ON e.npc_spells_id = lc.list_id
LEFT JOIN public.eqemu_spells s ON s.id = e.spellid;

GRANT SELECT ON public.eqemu_npc_spells_resolved TO anon, authenticated;
