#!/bin/bash
# Self-test for scripts/lib/archive-merge.sql against any Postgres.
#
# The merge is the one piece of this system that can silently LOSE data, so it
# gets an executable proof rather than a claim. Not a vitest test because it
# needs a real Postgres; run it by hand after touching the merge SQL.
#
#   PGHOST=/tmp/pgs PGUSER=postgres bash scripts/test-archive-merge.sh
#   DB_URL=postgres://... bash scripts/test-archive-merge.sh

set -uo pipefail
cd "$(dirname "$0")/.."
PSQL=(psql); [ -n "${DB_URL:-}" ] && PSQL=(psql "$DB_URL")
T=archive_merge_selftest

"${PSQL[@]}" -q -c "drop database if exists $T" -c "create database $T" || exit 1
run() { psql ${DB_URL:+"$DB_URL"} -d "$T" "$@"; }

run -q <<'SQL'
create schema snap;
-- ARCHIVE: production pruned 1,2 on its retention timer and corrected 4.
create table public.buff_casts (id bigint primary key, spell_name text, target text);
insert into public.buff_casts values (1,'Turgur''s Insects','MobA'),(2,'Slow','MobB'),
                                     (3,'Malo','MobC'),(4,'Cripple','MobD'),(5,'Tash','MobE');
create table snap.buff_casts (like public.buff_casts including all);
insert into snap.buff_casts values (3,'Malo','MobC'),(4,'Cripple','MobD-CORRECTED'),
                                   (5,'Tash','MobE'),(6,'NewSlow','MobF');
-- MIRROR: delete-and-reinsert upstream means the old item is genuinely gone.
create table public.character_inventory (id bigint primary key, character_name text, item text);
insert into public.character_inventory values (1,'Rockin','Rusty Dagger'),(2,'Rockin','Old Cloak');
create table snap.character_inventory (like public.character_inventory including all);
insert into snap.character_inventory values (2,'Rockin','Old Cloak'),(3,'Rockin','Fungi Tunic');
-- Composite primary key, to prove the conflict target is built correctly.
create table public.encounter_players (encounter_id int, character_name text, dmg int,
       primary key (encounter_id, character_name));
insert into public.encounter_players values (1,'Rockin',100),(2,'Hitya',200);
create table snap.encounter_players (like public.encounter_players including all);
insert into snap.encounter_players values (2,'Hitya',999),(3,'Fargan',300);
SQL

run -q -f scripts/lib/archive-merge.sql >/dev/null 2>&1
run -q -f scripts/lib/archive-merge.sql >/dev/null 2>&1     # twice: must be idempotent

fail=0
check() { # description, actual, expected
  if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 — got '$2' want '$3'"; fail=1; fi
}
q() { run -tAc "$1" | tr -d '[:space:]'; }

echo "archive-merge self-test:"
check "archive keeps rows production pruned"      "$(q 'select count(*) from buff_casts')" 6
check "archive still has the oldest pruned row"   "$(q 'select count(*) from buff_casts where id=1')" 1
check "archive takes production's correction"     "$(q "select target from buff_casts where id=4")" MobD-CORRECTED
check "archive inserts new rows"                  "$(q 'select count(*) from buff_casts where id=6')" 1
check "mirror DELETES what production removed"    "$(q 'select count(*) from character_inventory where id=1')" 0
check "mirror keeps current rows"                 "$(q 'select count(*) from character_inventory')" 2
check "composite pk merges, not duplicates"       "$(q 'select count(*) from encounter_players')" 3
check "composite pk takes the update"             "$(q "select dmg from encounter_players where character_name='Hitya'")" 999
check "second run changed nothing (idempotent)"   "$(q 'select count(*) from buff_casts')" 6

"${PSQL[@]}" -q -c "drop database if exists $T" >/dev/null 2>&1
[ "$fail" = 0 ] && echo "PASS" || { echo "FAILED"; exit 1; }
