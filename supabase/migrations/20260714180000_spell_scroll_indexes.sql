-- Speed up character_missing_spells (the /character/[name]/spells RPC).
--
-- The pool step seq-scans all ~27k eqemu_items for `name LIKE 'Spell: %'` and
-- runs a correlated `lower(name)` lookup against eqemu_spells per matched row —
-- ~3s total, which makes the force-dynamic page appear to hang on soft-nav.
-- These two indexes turn the prefix scan into a range scan and the per-row
-- spell_id lookup into an index probe. The PoP source-detection join columns
-- (eqemu_merchantlist.item, eqemu_lootdrop_entries.item_id,
-- eqemu_npc_types.loottable_id, eqemu_zone.zone_id) are already indexed.
-- Both idempotent; survive the weekly eqemu upsert sync. See
-- docs/eqemu-catalog-cheatsheet.md.

-- Prefix-searchable index for `name LIKE 'Spell: %'` (the tsvector GIN index
-- can't serve a LIKE-prefix range scan).
CREATE INDEX IF NOT EXISTS eqemu_items_name_pattern_idx
  ON eqemu_items (name text_pattern_ops);

-- Case-insensitive spell name lookup (scroll name → eqemu_spells.id).
CREATE INDEX IF NOT EXISTS eqemu_spells_lower_name_idx
  ON eqemu_spells (lower(name));
