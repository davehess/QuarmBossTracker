-- MySQL int(11) unsigned can hold up to 4,294,967,295 — overflows Postgres
-- `integer` (max 2,147,483,647). The first force-resync run died on
-- doors.client_version_mask = 4294967294. Widen every column that's
-- actually an unsigned bitmask / version-mask in the source so the import
-- can land. Identified from the upstream Al'Kabor schema; only the
-- following columns hit this limit in practice.
alter table eqemu_doors        alter column client_version_mask type bigint;
alter table eqemu_zone_points  alter column client_version_mask type bigint;
-- classes_required on merchantlist is a 32-bit class bitmask — same risk.
alter table eqemu_merchantlist alter column classes_required type bigint;
