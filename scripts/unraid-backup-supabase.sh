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
# RESTORE TEST (once, and after any Postgres major-version change):
#   docker run --rm -v /mnt/user/backups/wolfpack:/b postgres:15 \
#     bash -c "createdb -h <any pg> t && pg_restore -d t --no-owner /b/latest.dump"
#   — or restore into the Phase 2 sandbox, which is the same test with a purpose.
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
docker run --rm --network host -e DB_URL="$DB_URL" postgres:15 \
  pg_dump "$DB_URL" -Fc --no-owner --no-acl -f /dev/stdout > "$OUT.tmp"

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
