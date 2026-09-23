#!/bin/bash
# Self-test for scripts/lib/archive-merge.sql against any Postgres.
#
# The merge is the one piece of this system that can silently LOSE data, so it
# gets an executable proof rather than a claim. Not a vitest test because it
# needs a real Postgres; run it by hand after touching the merge SQL.
#
#   PGHOST=/tmp/pgs PGUSER=postgres bash scripts/test-archive-merge.sh
#   DB_URL=postgres://... bash scripts/test-archive-merge.sh
#
# ⚠ The merge runs as ONE statement, so any error rolls back every table — which
# is how a single foreign-key violation froze the real archive for 17 nights
# while the nightly job still reported OK. This script therefore fails on merge
# output, not just on row counts: a silent abort must never read as a pass.

set -uo pipefail
cd "$(dirname "$0")/.."
PSQL=(psql); [ -n "${DB_URL:-}" ] && PSQL=(psql "$DB_URL")
T=archive_merge_selftest
OUT="${TMPDIR:-/tmp}/archive-merge-selftest.log"

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

-- INSERT ORDER: a child that sorts alphabetically BEFORE its parent. This is
-- the shape that broke the real archive — charm_sessions ahead of encounters —
-- so the new charm session references an encounter the archive has not got yet.
-- Merged alphabetically, the FK fails and takes every other table down with it.
create table public.encounters (id int primary key, npc text);
insert into public.encounters values (1,'Lord of Ire');
create table snap.encounters (like public.encounters including all);
insert into snap.encounters values (1,'Lord of Ire'),(2,'Emperor Ssraeshza');
create table public.charm_sessions (id int primary key, pet text,
       encounter_id int references public.encounters(id));
insert into public.charm_sessions values (1,'a shissar disciple',1);
create table snap.charm_sessions (like public.charm_sessions including all);
insert into snap.charm_sessions values (1,'a shissar disciple',1),(2,'a vampire bat',2);

-- DELETE ORDER: the opposite direction, and the one that ordering by the FK
-- graph would get wrong if the deletes shared the insert pass. Both mirror
-- tables; production dropped the NPC and the boss row pointing at it, so the
-- parent cannot be deleted while the local child still references it.
create table public.eqemu_npc_types (id int primary key, name text);
insert into public.eqemu_npc_types values (100,'Lord Inquisitor Seru'),(101,'a shissar disciple');
create table snap.eqemu_npc_types (like public.eqemu_npc_types including all);
insert into snap.eqemu_npc_types values (100,'Lord Inquisitor Seru');
create table public.bosses_local (id int primary key, name text,
       npc_id int references public.eqemu_npc_types(id));
insert into public.bosses_local values (1,'Seru',100),(2,'disciple',101);
create table snap.bosses_local (like public.bosses_local including all);
insert into snap.bosses_local values (1,'Seru',100);

-- SECOND UNIQUE INDEX beside the primary key. 17 of the 25 archive tables have
-- one. The archive kept a row production later pruned and re-created under a
-- fresh id, so the snapshot offers the same observation under a DIFFERENT id:
-- no primary-key conflict, and the dedup index raises instead. Merged with
-- `on conflict (id)`, that one row takes the entire run down. (Names here are
-- invented, per the repo's public-docs convention.)
create table public.who_observations (id bigint primary key, "character" text,
       observed_minute timestamptz, uploaded_by text);
create unique index who_obs_dedup
    on public.who_observations ("character", observed_minute, uploaded_by);
insert into public.who_observations values (1,'Rethlan','2025-11-15 19:23:00+00','Nyssara');
create table snap.who_observations (id bigint primary key, "character" text,
       observed_minute timestamptz, uploaded_by text);
insert into snap.who_observations values (99,'Rethlan','2025-11-15 19:23:00+00','Nyssara'),
                                         (100,'Corvale','2026-09-20 21:00:00+00','Nyssara');

-- GENERATED column: cannot be inserted into or updated, and naming one is a
-- hard error — so it must be dropped from the column list and recomputed.
create table public.tells (id bigint primary key, body text,
       body_len int generated always as (length(body)) stored);
insert into public.tells (id, body) values (1,'hi');
create table snap.tells (id bigint primary key, body text, body_len int);
insert into snap.tells values (1,'hello',5),(2,'ok',2);

-- IDENTITY column: an insert that supplies the id fails without
-- `overriding system value`.
create table public.page_views (id bigint generated always as identity primary key, path text);
insert into public.page_views (id, path) overriding system value values (1,'/raid');
create table snap.page_views (id bigint primary key, path text);
insert into snap.page_views values (1,'/raid'),(2,'/parses');
SQL

fail=0
check() { # description, actual, expected
  if [ "$2" = "$3" ]; then echo "  ok   $1"; else echo "  FAIL $1 — got '$2' want '$3'"; fail=1; fi
}
q() { run -tAc "$1" | tr -d '[:space:]'; }

# Twice: must be idempotent. Either run erroring is a failure on its own, with
# the reason printed — an aborted merge leaves the archive untouched, which row
# counts alone can misreport as "nothing changed".
for pass in 1 2; do
  if ! run -q -v ON_ERROR_STOP=1 -f scripts/lib/archive-merge.sql >"$OUT" 2>&1; then
    echo "  FAIL merge pass $pass errored:"; sed -n '1,12p' "$OUT" | sed 's/^/       /'; fail=1
  fi
done

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
check "FK parent inserted before its child"       "$(q 'select count(*) from encounters')" 2
check "FK child that sorts first still merges"    "$(q 'select count(*) from charm_sessions where id=2')" 1
check "FK child deleted before its parent"        "$(q 'select count(*) from eqemu_npc_types')" 1
check "mirror child went with it"                 "$(q 'select count(*) from bosses_local')" 1
check "second unique index does not abort the run" "$(q 'select count(*) from who_observations')" 2
check "archive keeps ITS id, skips the new one"   "$(q 'select count(*) from who_observations where id=99')" 0
check "the genuinely new row still lands"         "$(q 'select count(*) from who_observations where id=100')" 1
check "generated column is recomputed, not copied" "$(q "select body||':'||body_len from tells where id=1")" hello:5
check "identity column takes the snapshot's id"   "$(q 'select count(*) from page_views')" 2
check "rows_before is counted pre-delete"         \
  "$(q "select rows_before||'->'||rows_after from archive_meta.merge_log
          where table_name='bosses_local' order by id limit 1")" "2->1"

# LAST, because it leaves the database unmergeable: an allowlisted ARCHIVE table
# the snapshot lacks must STOP the run, never be skipped. That silent skip is how
# `encounters` went unmerged from 2026-09-06 — its restore failed on a default in
# the `extensions` schema, the table was simply absent from `snap`, and nothing
# said so.
run -q -c "create table public.chat_messages (id bigint primary key, body text)"
if run -q -v ON_ERROR_STOP=1 -f scripts/lib/archive-merge.sql >"$OUT" 2>&1; then got=merged
elif grep -q 'missing from the snapshot: chat_messages ' "$OUT"; then got=refused
else got="failed for another reason: $(grep -m1 ERROR "$OUT")"; fi
check "archive table missing from snapshot STOPS it" "$got" refused

"${PSQL[@]}" -q -c "drop database if exists $T" >/dev/null 2>&1
rm -f "$OUT"
[ "$fail" = 0 ] && echo "PASS" || { echo "FAILED"; exit 1; }
