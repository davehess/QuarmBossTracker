-- Lockouts derived from kills we already have parses for.
--
-- Hitya 2026-08-22, on a Ventani parse Taeya uploaded from a non-guild raid:
-- "taeya reported this Ventani kill so they should have a lockout."
--
-- The 2026-08-21 table only ever filled from an /sll relay, and /sll is a
-- thing a human has to type in game. Between the feature shipping and that
-- report the table held ZERO rows, while the encounter pipeline had already
-- captured three foreign raid kills from that same player. The evidence was
-- sitting in `encounters`; nothing was reading it.
--
-- An uploaded, confirmed kill of a lockout-bearing raid boss IS a lockout
-- observation. So the table gains a second source and stops being one row per
-- (character, boss, expiry).
--
-- WHY THE PRIMARY KEY CHANGES: /sll reports the server's own remaining time;
-- a kill-derived row computes expiry as kill + the boss timer. Those two
-- disagree by minutes for the SAME lockout, so keeping expires_at in the key
-- would file them as two separate lockouts. A character cannot hold two live
-- lockouts on one boss, so (guild, character, boss) is the real identity, and
-- this table is a CURRENT-STATE projection. The permanent audit trail of who
-- killed what with whom is `encounters` + `contributions`, which is richer
-- than this table could ever be.
ALTER TABLE character_lockouts
  ADD COLUMN IF NOT EXISTS source       text NOT NULL DEFAULT 'sll',
  ADD COLUMN IF NOT EXISTS encounter_id uuid;

-- 'sll'    — relayed from the character's own /sll output. Authoritative:
--            the server told us the remaining time.
-- 'kill'   — derived from a confirmed boss-kill parse. Expiry is computed
--            from the boss timer, so treat it as ±the timer's own accuracy.
-- 'manual' — entered by an officer.
DO $$ BEGIN
  ALTER TABLE character_lockouts
    ADD CONSTRAINT character_lockouts_source_chk
    CHECK (source IN ('sll', 'kill', 'manual'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- De-dupe before re-keying: keep the most recently observed row per identity.
-- A no-op on an empty table; present so the migration is safe to replay.
-- MUST run while the old primary key still exists — it is this table's replica
-- identity, and Postgres refuses DELETE on a published table without one.
DELETE FROM character_lockouts a
 USING character_lockouts b
 WHERE a.guild_id = b.guild_id
   AND a.character = b.character
   AND a.boss_key  = b.boss_key
   AND (a.observed_at, a.expires_at) < (b.observed_at, b.expires_at);

DO $$
DECLARE pk_name text;
BEGIN
  SELECT conname INTO pk_name
    FROM pg_constraint
   WHERE conrelid = 'character_lockouts'::regclass AND contype = 'p';
  IF pk_name IS NOT NULL THEN
    EXECUTE format('ALTER TABLE character_lockouts DROP CONSTRAINT %I', pk_name);
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE character_lockouts
    ADD CONSTRAINT character_lockouts_pkey
    PRIMARY KEY (guild_id, character, boss_key);
EXCEPTION WHEN duplicate_table THEN NULL;
           WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS character_lockouts_source_idx
  ON character_lockouts (guild_id, source, expires_at DESC);
