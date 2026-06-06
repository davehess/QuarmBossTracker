-- The weekly EQMacEmu sync (scripts/sync-from-eqmac.js) was failing with
--   FATAL: value "4294967295" is out of range for type integer
-- when upserting eqemu_altadv_vars. Upstream uses MySQL `int unsigned` for
-- `classes` (a class bitmask — 0xFFFFFFFF = "available to every class") and
-- for `type` (an AA-grouping bitmask that also pegs to the sentinel). Postgres
-- `integer` is SIGNED (max 2_147_483_647), so the unsigned-32-bit upper half
-- overflows on upsert. Widen both to bigint so the raw value lands as-is and
-- the bitmask reads correctly. No data loss — bigint is a superset.

ALTER TABLE public.eqemu_altadv_vars
  ALTER COLUMN classes TYPE bigint USING classes::bigint,
  ALTER COLUMN type    TYPE bigint USING type::bigint;
