-- Diabo Xi Va / Diabo Xi Xin have been wearing each other's names.
--
-- bosses_local mapped both internal_ids to the WRONG npc_id:
--
--   internal_id     npc_id    eqemu_npc_types.name at that id
--   diabo_xi_va     158446    Diabo_Xi_Xin      <- wrong
--   diabo_xi_xin    158445    Diabo_Xi_Va       <- wrong
--
-- (The neighbouring rows diabo_xi_va_temariel/158441 and diabo_xi_xin_thall/
-- 158443 are correct, so it is exactly these two that are transposed.)
--
-- VERIFIED, not inferred. Sampled recent contributions and compared what the
-- AGENT reported against what the encounter was labelled: 7 of 7 were the exact
-- opposite, in both directions.
--
--   labelled Diabo_Xi_Va  <- agent reported "Diabo Xi Xin"
--   labelled Diabo_Xi_Xin <- agent reported "Diabo Xi Va"   (x6)
--
-- Two things have to move. Fixing bosses_local alone only corrects FUTURE
-- kills, because recordParse resolves internal_id -> npc_id at ingest and
-- stores the result on the encounter — so 41 existing encounters (22 + 19,
-- back to 2026-01-12) carry the wrong npc_id and would keep rendering the wrong
-- name forever.
--
-- HOW: npc_id is bosses_local's PRIMARY KEY *and* carries a foreign key to
-- eqemu_npc_types, so swapping it needs either a real-npc sentinel or a
-- delete/reinsert. Neither is necessary — the two rows are byte-identical apart
-- from internal_id and nicknames (same emoji, timer_hours_override 162,
-- expansion_label Luclin, zone_short vexthal). Swapping THOSE achieves exactly
-- the same corrected mapping and never touches a key or a constraint.
-- A text sentinel covers the unique-internal_id window.
--
-- encounters.npc_id has no such constraint, so a CASE swaps it in one pass.
--
-- IDEMPOTENT BY STATE GUARD, and it has to be. A blind swap is its own inverse,
-- so a second run does not "already applied, no-op" — it silently RE-BREAKS
-- both tables. The guard reads the current mapping and does nothing unless it
-- is still the wrong one, which makes re-running safe rather than destructive.
-- Applied to production 2026-08-06 via execute_sql (apply_migration timed out
-- on its history table), so this file will very likely be re-run by someone
-- replaying the directory — that is the case the guard exists for.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.bosses_local
     WHERE npc_id = 158446 AND internal_id = 'diabo_xi_va'
  ) THEN
    RAISE NOTICE 'diabo_xi_va/diabo_xi_xin already map correctly — nothing to do';
    RETURN;
  END IF;

  UPDATE public.bosses_local SET internal_id = '__diabo_swap_tmp__'
   WHERE npc_id = 158446 AND internal_id = 'diabo_xi_va';

  UPDATE public.bosses_local
     SET internal_id = 'diabo_xi_va', nicknames = ARRAY['diabo va', 'dxv']
   WHERE npc_id = 158445 AND internal_id = 'diabo_xi_xin';

  UPDATE public.bosses_local
     SET internal_id = 'diabo_xi_xin', nicknames = ARRAY['diabo xin', 'dxx']
   WHERE npc_id = 158446 AND internal_id = '__diabo_swap_tmp__';

  UPDATE public.encounters
     SET npc_id = CASE npc_id WHEN 158445 THEN 158446 WHEN 158446 THEN 158445 END
   WHERE npc_id IN (158445, 158446);
END $$;
