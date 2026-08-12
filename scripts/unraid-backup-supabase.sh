#!/bin/bash
# Nightly Supabase backup → Unraid share. (Phase 1 of
# docs/RUNBOOK-unraid-supabase-replica.md — decided 2026-08-11: backup first,
# dev sandbox second. The nightly dump doubles as the sandbox's seed.)
#
# INSTALL (on the Unraid box, not here):
#   1. Copy this file into the User Scripts plugin (Settings → User Scripts →
#      Add New Script), schedule "Custom": 0 5 * * *  (05:00 — after US raid
#      nights end, before the weekly eqemu sync starts moving rows).
#   2. Put the connection string in /boot/config/wolfpack-db-url (chmod 600).
#      Use the SESSION POOLER string from Dashboard → Connect (the one on
#      port 5432 via *.pooler.supabase.com, user postgres.zhtoekwakucbckvatfky).
#      ⚠ Session pooler, for two reasons: pg_dump does NOT need the replication
#      protocol, and the pooler host has IPv4 — so none of the IPv6 / IPv4
#      add-on constraints from the replication path apply to backups at all.
#      (The transaction pooler on 6543 will NOT work — pg_dump needs session
#      state. If the string says 6543, pick the other one.)
#   3. Run it once by hand, then run the RESTORE TEST below once. A backup that
#      has never been restored is a hope, not a backup.
#
# RESTORE TEST (once, and after any Postgres major-version change) — restore
# into the local Unraid stack, which runs Postgres 17.6 and so matches.
# STREAM it in on stdin; do NOT `docker cp` (2026-08-11: cp copies the
# latest.dump SYMLINK rather than its target — "Successfully copied 0B" — and
# leaves a dangling link in the container; it would also duplicate the whole
# dump inside docker.img):
#   docker exec -i supabase-db pg_restore -U postgres -d postgres \
#     --no-owner --no-acl --schema=public < /mnt/user/backups/wolfpack/latest.dump
#   docker exec supabase-db psql -U postgres -c "select count(*) from encounters"
# `-i` is required for stdin. --schema=public only: the archive also carries
# auth/graphql/pgbouncer, which belong to the LOCAL stack's own services.
# "already exists" notices during the restore are expected and non-fatal.
#
# ~1.2 GB database (measured 2026-08-11) → -Fc compresses to a few hundred MB.

set -euo pipefail

DEST="/mnt/user/backups/wolfpack"
KEEP_DAYS=30
DB_URL_FILE="/boot/config/wolfpack-db-url"

[ -r "$DB_URL_FILE" ] || { echo "missing $DB_URL_FILE (session-pooler URI, chmod 600)"; exit 1; }
DB_URL="$(tr -d '[:space:]' < "$DB_URL_FILE")"
case "$DB_URL" in
  *:6543*) echo "that is the TRANSACTION pooler — pg_dump needs the SESSION pooler (port 5432)"; exit 1 ;;
esac

mkdir -p "$DEST"
STAMP="$(date +%F)"
OUT="$DEST/wolfpack-$STAMP.dump"

# --no-owner --no-acl: roles on the hosted project don't exist locally; without
# these flags every restore into the sandbox fights ALTER OWNER errors.
#
# ⚠ postgres:17 is REQUIRED, not incidental. The hosted project runs 17.6
# (verified 2026-08-11) and pg_dump REFUSES to dump from a server newer than
# itself — a postgres:15 client aborts with "server version 17.6; pg_dump
# version 15.x". Dumping an OLDER server with a newer client is the supported
# direction, so this tag only ever needs raising, never lowering. If Supabase
# upgrades the project's major version, bump this tag to match.
#
# ⚠ NO `-f /dev/stdout`, and `--no-sync` (learned 2026-08-11). With `-f`,
# pg_dump treats the target as a real file and fsyncs it on completion —
# fsync on a redirected stdout fails with `could not fsync file "/dev/stdout":
# Invalid argument` AFTER the whole dump has been written, so the run exits
# non-zero and `set -e` discards a dump that was actually complete. Writing to
# the default stdout skips that fsync; --no-sync is belt-and-braces.
docker run --rm --network host -e DB_URL="$DB_URL" postgres:17 \
  pg_dump "$DB_URL" -Fc --no-owner --no-acl --no-sync > "$OUT.tmp"

# Refuse to keep an implausibly small dump — a silent auth failure writes ~0
# bytes, and rotation would then age out the last GOOD backup while every
# "backup" since is garbage. 100 MB floor against a ~1.2 GB source.
SIZE=$(stat -c%s "$OUT.tmp")
if [ "$SIZE" -lt 100000000 ]; then
  echo "dump is only $SIZE bytes — refusing to rotate; investigate"; exit 1
fi
mv "$OUT.tmp" "$OUT"
ln -sf "$OUT" "$DEST/latest.dump"

find "$DEST" -name 'wolfpack-*.dump' -mtime +"$KEEP_DAYS" -delete
echo "OK: $OUT ($SIZE bytes); $(ls "$DEST" | grep -c '^wolfpack-') dumps retained"
