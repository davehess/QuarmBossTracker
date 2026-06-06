-- After widening eqemu_altadv_vars.classes + type to bigint, the sync STILL
-- hit "value 4294967295 is out of range for type integer" — a different
-- column on the same row carries the same MySQL unsigned-32-bit sentinel.
-- Without inspecting every row by hand, the safest fix is to widen every
-- remaining integer column on this table that could plausibly carry a
-- bitmask or signed/unsigned mismatch. integer → bigint is lossless.

ALTER TABLE public.eqemu_altadv_vars
  ALTER COLUMN class_type        TYPE bigint USING class_type::bigint,
  ALTER COLUMN spell_type        TYPE bigint USING spell_type::bigint,
  ALTER COLUMN special_category  TYPE bigint USING special_category::bigint,
  ALTER COLUMN aa_expansion      TYPE bigint USING aa_expansion::bigint,
  ALTER COLUMN prereq_skill      TYPE bigint USING prereq_skill::bigint,
  ALTER COLUMN prereq_minpoints  TYPE bigint USING prereq_minpoints::bigint,
  ALTER COLUMN level_inc         TYPE bigint USING level_inc::bigint,
  ALTER COLUMN cost_inc          TYPE bigint USING cost_inc::bigint,
  ALTER COLUMN max_level         TYPE bigint USING max_level::bigint,
  ALTER COLUMN cost              TYPE bigint USING cost::bigint,
  ALTER COLUMN eqmacid           TYPE bigint USING eqmacid::bigint,
  ALTER COLUMN spellid           TYPE bigint USING spellid::bigint;
-- skill_id (the PK) deliberately left as integer — it's a per-rank counter
-- with sane bounds, not a bitmask. If THAT one overflows we have a bigger
-- problem than column types.
