-- The initial schema (20260525120000_initial_schema.sql) revokes all from
-- anon and authenticated by default, then grants SELECT only on the public
-- eqemu_* tier. That leaves the Vercel web app unable to read encounters,
-- encounter_players, bosses_local, etc. even when the user is signed in.
--
-- This migration grants SELECT on guild-tier game data to the
-- `authenticated` role. The web app's sign-in flow already gates by
-- guild + ALLOWED_ROLE_NAMES, so anyone who reaches a Supabase session
-- has been verified as a Wolf Pack member with an approved role —
-- `authenticated` is therefore an acceptable boundary for read access.
--
-- Sensitive tables (wishlists, officer_notes, audit_log) stay locked
-- down — those need finer-grained policies (officer-only, owner-only)
-- in a follow-up migration.

-- ── Parse / encounter data ──────────────────────────────────────────────────
DO $$
DECLARE
  t TEXT;
BEGIN
  FOR t IN
    SELECT unnest(ARRAY[
      'encounters',
      'encounter_players',
      'contributions',
      'bosses_local',
      'characters',
      'raid_nights',
      'loot_drops',
      'eqemu_spells'
    ])
  LOOP
    -- Skip tables that don't exist yet (eqemu_spells is new; bosses_local
    -- is in the initial schema).
    IF EXISTS (SELECT 1 FROM information_schema.tables
               WHERE table_schema = 'public' AND table_name = t) THEN
      EXECUTE format('GRANT SELECT ON public.%I TO authenticated', t);
      EXECUTE format(
        'DROP POLICY IF EXISTS %I ON public.%I',
        t || '_authenticated_read', t
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (true)',
        t || '_authenticated_read', t
      );
    END IF;
  END LOOP;
END $$;

-- combat_events is potentially heavy — grant authenticated read but expect
-- the web app to query with strict filters (encounter_id IN (...)).
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.tables
             WHERE table_schema = 'public' AND table_name = 'combat_events') THEN
    GRANT SELECT ON public.combat_events TO authenticated;
    DROP POLICY IF EXISTS combat_events_authenticated_read ON public.combat_events;
    CREATE POLICY combat_events_authenticated_read
      ON public.combat_events FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- The item_with_proc view inherits permissions from its base tables —
-- eqemu_items is already anon-readable, but the join to eqemu_spells will
-- fail for anon if eqemu_spells isn't granted. Make the view callable by
-- authenticated explicitly so the loadouts page works post-sign-in.
GRANT SELECT ON public.item_with_proc TO authenticated, anon;
