#!/bin/bash
# SUPERSEDED 2026-08-12 by scripts/refresh-local-archive.sh — use that instead.
#
# This script restores with --clean, which drops and reloads `public`, so the
# local copy faithfully mirrored production INCLUDING its retention deletes and
# was therefore no more of an archive than production is. Hitya's call: "local
# should not lose any history." Kept only for the case where you deliberately
# want an exact mirror of production rather than an accumulating archive.
#
# Refresh the LOCAL Supabase sandbox from the newest nightly dump.
#
# The mirror's data is a snapshot, not a replica (that was the deliberate call on
# 2026-08-11 — see docs/RUNBOOK-unraid-supabase-replica.md). A snapshot nobody
# refreshes is worth less every day, and worse, it silently stops representing
# production, so testing against it starts producing wrong answers. This runs
# after the nightly backup and rolls the newest dump into the local stack.
#
# It also re-proves the backup every single night: a dump that restores cleanly is
# a dump you can rely on in a real loss. That is the part most backup setups never
# get, and here it comes free as a side effect.
#
# ⚠ DESTRUCTIVE ON THE LOCAL SANDBOX BY DESIGN. --clean drops and recreates every
# object in the local `public` schema, so anything you changed there while poking
# around is gone. That is the point: the sandbox tracks production, it is not a
# place to keep work. It CANNOT touch the hosted project — it only ever talks to
# the local container over docker exec, and there is no network path to Supabase
# in this script at all.
#
# INSTALL (Unraid, User Scripts): schedule Custom `30 5 * * *` — half an hour after
# the 05:00 backup, which is comfortably longer than the ~4 min the dump takes.

set -euo pipefail

DUMP="${DUMP:-/mnt/user/backups/wolfpack/latest.dump}"
CONTAINER="${CONTAINER:-supabase-db}"
DB="${DB:-postgres}"

# --- preflight -------------------------------------------------------------
[ -r "$DUMP" ] || { echo "no dump at $DUMP — has the backup run yet?"; exit 1; }

# Follow the symlink and sanity-check the size, so a truncated or half-written
# dump can never wipe a working sandbox and leave nothing in its place.
REAL="$(readlink -f "$DUMP")"
SIZE="$(stat -c%s "$REAL")"
if [ "$SIZE" -lt 50000000 ]; then
  echo "dump is only $SIZE bytes ($REAL) — refusing to restore from it"; exit 1
fi

docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true || {
  echo "$CONTAINER is not running — start the Supabase stack first"; exit 1; }

AGE_H=$(( ( $(date +%s) - $(stat -c%Y "$REAL") ) / 3600 ))
echo "restoring $REAL (${SIZE} bytes, ${AGE_H}h old) into $CONTAINER:$DB"

BEFORE="$(docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  'select count(*) from encounters' 2>/dev/null || echo 0)"

# --- restore ---------------------------------------------------------------
# --schema=public only: auth/storage/realtime belong to the LOCAL stack's own
# services, and dropping them would take the sandbox's user accounts with them.
# --clean --if-exists makes the run idempotent; without it the second night fails
# on every duplicate key. Errors are reported but not fatal — a handful are
# expected every time (missing pg_trgm operator class, the auth.users FK that
# cannot attach under a public-only restore, the hosted-side publication).
set +e
docker exec -i "$CONTAINER" pg_restore -U postgres -d "$DB" \
  --clean --if-exists --no-owner --no-acl --schema=public < "$REAL" 2>/tmp/refresh-sandbox.err
RC=$?
set -e
ERRS="$(grep -c '^pg_restore: error' /tmp/refresh-sandbox.err || true)"

AFTER="$(docker exec "$CONTAINER" psql -U postgres -d "$DB" -tAc \
  'select count(*) from encounters')"

echo "encounters: $BEFORE -> $AFTER  (pg_restore rc=$RC, $ERRS non-fatal errors)"

# The real pass/fail is whether the data is queryable afterwards, not pg_restore's
# exit code — it returns non-zero for the expected errors above.
if [ "${AFTER:-0}" -lt 1 ]; then
  echo "FAILED: encounters is empty after restore — investigate /tmp/refresh-sandbox.err"
  exit 1
fi
echo "OK: sandbox refreshed"
