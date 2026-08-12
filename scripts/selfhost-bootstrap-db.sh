#!/bin/bash
# Build the platform's database schema from an EMPTY Postgres.
#
# This is the "one-command bootstrap" DESIGN-external-tenancy.md called for, and
# the answer to a question that had never been tested: can this repo rebuild its
# own schema? Measured 2026-08-12 against a real empty Postgres 16:
#
#   migrations alone .............. 182/193 apply, 11 fail
#   bootstrap + migrations ........ 190/193 apply,  3 fail   ← what this script does
#
# The gap was SIX tables production uses that no migration creates — fun_events,
# pvp_kills, pvp_boss_kills, pvp_assists, mimic_sessions, trigger_timing_feedback
# — applied out-of-band without the file ever being committed, plus the roles,
# extensions, publication and auth helpers a hosted Supabase project just has.
# supabase/bootstrap/ supplies all of it. Those tables are created EMPTY: they are
# per-guild data (your fun events, your PvP kills, your sessions), never ours.
#
# The 3 that still fail are security-hardening and one-time data repair against
# objects and rows a fresh install does not have. They create no schema, so the
# result is a complete database. See "PARTIAL" below for the one that matters.
#
# USAGE
#   Against the local Supabase stack:
#     DB_URL="postgres://postgres@localhost:5432/postgres" bash scripts/selfhost-bootstrap-db.sh
#   Against a container:
#     CONTAINER=supabase-db bash scripts/selfhost-bootstrap-db.sh
#
# Safe to re-run: every bootstrap statement is idempotent, and migrations that
# already applied fail harmlessly on the second pass (they are reported, not fatal).

set -uo pipefail
cd "$(dirname "$0")/.."

CONTAINER="${CONTAINER:-}"
DB_URL="${DB_URL:-}"
DB="${DB:-postgres}"

if [ -n "$CONTAINER" ]; then
  psql_run() { docker exec -i "$CONTAINER" psql -U postgres -d "$DB" "$@"; }
  docker inspect -f '{{.State.Running}}' "$CONTAINER" 2>/dev/null | grep -q true || {
    echo "container $CONTAINER is not running"; exit 1; }
elif [ -n "$DB_URL" ]; then
  psql_run() { psql "$DB_URL" "$@"; }
  command -v psql >/dev/null || { echo "psql not found — set CONTAINER instead"; exit 1; }
else
  echo "set DB_URL=postgres://... or CONTAINER=supabase-db"; exit 1
fi

echo "=== 1/2  bootstrap (prereqs + the six uncaptured tables) ==="
for f in supabase/bootstrap/*.sql; do
  if psql_run -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>/tmp/bs.err; then
    echo "  ok       $(basename "$f")"
  else
    echo "  FAILED   $(basename "$f")"; sed -n '1,5p' /tmp/bs.err; exit 1
  fi
done

echo "=== 2/2  migrations ==="
ok=0; partial=0; failed=0; failed_names=()
for f in $(ls supabase/migrations/*.sql | sort); do
  n=$(basename "$f")
  if psql_run -v ON_ERROR_STOP=1 -q < "$f" >/dev/null 2>/tmp/mig.err; then
    ok=$((ok+1)); continue
  fi
  # Strict mode aborts the whole FILE at the first bad statement. That matters for
  # 20260718043553_pin_function_search_path, which pins search_path on 24 functions
  # and dies on the one this install does not have — taking 23 valid hardening
  # statements with it. Re-run non-strict so the rest land, and say so plainly.
  if psql_run -q < "$f" >/dev/null 2>>/tmp/mig.err; then
    partial=$((partial+1)); echo "  PARTIAL  $n (some statements skipped)"
  else
    failed=$((failed+1)); failed_names+=("$n")
    echo "  FAILED   $n — $(grep -oE 'ERROR:.*' /tmp/mig.err | head -1)"
  fi
done

TABLES=$(psql_run -tAc "select count(*) from information_schema.tables where table_schema='public' and table_type='BASE TABLE'" | tr -d '[:space:]')
FUNCS=$(psql_run -tAc "select count(*) from information_schema.routines where routine_schema='public'" | tr -d '[:space:]')

echo
echo "clean: $ok   partial: $partial   failed: $failed"
echo "schema: $TABLES tables, $FUNCS functions"
echo
echo "EXPECTED on a fresh install (measured 2026-08-12): 190 clean / 3 partial /"
echo "0 failed, 124 tables, 79 functions. The three partials are security"
echo "hardening and one-time data repair touching objects a new install does not"
echo "have; each one still applied every statement that DID apply, and none of"
echo "them create schema."

# The real pass/fail is whether the core tables exist, not the migration tally.
MISSING=""
for t in encounters encounter_players characters wolfpack_members wolfpack_roles \
         guild_triggers chat_messages buff_casts raid_roster contributions bosses_local; do
  [ "$(psql_run -tAc "select to_regclass('public.$t') is not null" | tr -d '[:space:]')" = "t" ] || MISSING="$MISSING $t"
done
if [ -n "$MISSING" ]; then
  echo; echo "INCOMPLETE — core tables missing:$MISSING"; exit 1
fi
echo; echo "OK: all core tables present. Next: seed data/bosses.json via /addboss,"
echo "and see docs/SELFHOSTING.md for the eqemu_* catalog (not included)."
