#!/bin/bash
# Merge the newest production dump into the LOCAL ARCHIVE — never losing history.
#
# Replaces refresh-local-sandbox.sh (Hitya, 2026-08-12: "local should not lose
# any history"). That script restored with --clean, which dropped and reloaded
# `public` — so the local copy faithfully mirrored production INCLUDING its
# retention deletes, and was therefore no more of an archive than production is.
#
# Production prunes on timers, and correctly: raid_roster at 1 hour, buff_casts
# at 7 days, encounter_threat_snapshots at 30, who_observations at 60,
# target_observations at 90. Those sweeps exist because every live consumer reads
# ≤3 hours back and the tables were 118 MB before the first purge. This box has
# no such pressure, so it keeps everything and becomes the long-horizon record:
# slow uptime across an expansion, threat patterns over months — questions the
# 3-hour production window can never answer.
#
# HOW: restore the dump into a scratch database, expose it through postgres_fdw
# as schema `snap`, then merge (scripts/lib/archive-merge.sql). Two behaviours,
# per an explicit allowlist in that file: ARCHIVE tables insert + update and
# NEVER delete; everything else mirrors production exactly, deletes included,
# because for those a delete is a correction (character_inventory and friends
# are deleted and re-inserted on every upload — archiving them would show a
# character carrying items they no longer own).
#
# INSTALL: Unraid User Scripts, Custom `30 5 * * *` — half an hour after the
# backup. Swap it in for the old refresh script; do not run both.
#
# ⚠ FIRST RUN grows the database rather than replacing it, and it keeps growing.
# buff_casts alone lands ~9,500 rows/day (~46 MB per 7 days), so budget roughly
# 2.5 GB/year for it and expect the total to climb steadily. That is the point,
# but it is not free — watch the pool.

set -uo pipefail

DUMP="${DUMP:-/mnt/user/backups/wolfpack/latest.dump}"
CONTAINER="${CONTAINER:-supabase-db}"
DB="${DB:-postgres}"
SNAPDB="${SNAPDB:-wolfpack_snap}"
MERGE_SQL="$(dirname "$0")/lib/archive-merge.sql"

psql_c() { docker exec -i "$CONTAINER" psql -U postgres -d "$1" "${@:2}"; }

# --- preflight -------------------------------------------------------------
[ -r "$MERGE_SQL" ] || { echo "missing $MERGE_SQL"; exit 1; }
[ -r "$DUMP" ]      || { echo "no dump at $DUMP — has the backup run?"; exit 1; }
REAL="$(readlink -f "$DUMP")"; SIZE="$(stat -c%s "$REAL")"
if [ "$SIZE" -lt 50000000 ]; then
  echo "dump is only $SIZE bytes ($REAL) — refusing to merge from it"; exit 1
fi
docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true || {
  echo "$CONTAINER is not running"; exit 1; }

BEFORE_TOTAL="$(psql_c "$DB" -tAc "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public'" | tr -d '[:space:]')"
echo "local archive holds ~${BEFORE_TOTAL} rows; merging $(basename "$REAL") ($SIZE bytes)"

# --- 1. restore the snapshot into a scratch database ------------------------
# Torn down and rebuilt each run: it is a staging area, never the archive.
psql_c postgres -q -c "drop database if exists $SNAPDB" >/dev/null 2>&1
psql_c postgres -q -c "create database $SNAPDB" >/dev/null 2>&1 || {
  echo "could not create $SNAPDB"; exit 1; }
docker exec -i "$CONTAINER" pg_restore -U postgres -d "$SNAPDB" \
  --no-owner --no-acl --schema=public < "$REAL" 2>/tmp/arch-restore.err
SNAP_TABLES="$(psql_c "$SNAPDB" -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" | tr -d '[:space:]')"
if [ "${SNAP_TABLES:-0}" -lt 50 ]; then
  echo "snapshot restored only ${SNAP_TABLES:-0} tables — aborting before it can touch the archive"
  sed -n '1,5p' /tmp/arch-restore.err; exit 1
fi
echo "snapshot staged: $SNAP_TABLES tables"

# --- 2. expose it as schema `snap` -----------------------------------------
psql_c "$DB" -q -v ON_ERROR_STOP=1 <<SQL || { echo "postgres_fdw setup failed"; exit 1; }
create extension if not exists postgres_fdw;
drop schema if exists snap cascade;
drop server if exists snapsrv cascade;
create server snapsrv foreign data wrapper postgres_fdw
  options (host '127.0.0.1', port '5432', dbname '$SNAPDB');
create user mapping for current_user server snapsrv options (user 'postgres');
create schema snap;
import foreign schema public from server snapsrv into snap;
SQL

# --- 3. merge ---------------------------------------------------------------
psql_c "$DB" -q -v ON_ERROR_STOP=1 < "$MERGE_SQL" || { echo "MERGE FAILED — archive untouched by the failing table"; exit 1; }

# --- 4. tear down the staging area -----------------------------------------
psql_c "$DB" -q -c "drop schema if exists snap cascade; drop server if exists snapsrv cascade;" >/dev/null 2>&1
psql_c postgres -q -c "drop database if exists $SNAPDB" >/dev/null 2>&1

# --- 5. report --------------------------------------------------------------
echo
psql_c "$DB" -c "select table_name, mode, rows_before, rows_after, rows_kept as only_in_archive
                 from archive_meta.merge_log
                 where ran_at > now() - interval '10 minutes' and (rows_kept > 0 or rows_after <> rows_before)
                 order by rows_kept desc, table_name limit 20"
AFTER_TOTAL="$(psql_c "$DB" -tAc "select coalesce(sum(n_live_tup),0) from pg_stat_user_tables where schemaname='public'" | tr -d '[:space:]')"
KEPT="$(psql_c "$DB" -tAc "select coalesce(sum(rows_kept),0) from archive_meta.merge_log where ran_at > now() - interval '10 minutes'" | tr -d '[:space:]')"
echo
echo "archive: ~${BEFORE_TOTAL} -> ~${AFTER_TOTAL} rows; ${KEPT} rows exist ONLY here (production has pruned them)"

# Success means the core tables are queryable, not that a count went up.
CORE="$(psql_c "$DB" -tAc "select count(*) from encounters" | tr -d '[:space:]')"
[ "${CORE:-0}" -ge 1 ] || { echo "FAILED: encounters is empty after merge"; exit 1; }
echo "OK: archive merged (encounters=$CORE)"
