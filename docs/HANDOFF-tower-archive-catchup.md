# HANDOFF — Tower archive: the merge fails nightly. Fix it, then catch up.

**For a LOCAL session with Tower access.** A cloud session cannot do this — it
has the repo and Supabase, but not the box. Rewritten 2026-09-23.

⚠ **This replaces the first draft of this file, which was wrong.** That version
guessed "the cron was never installed" and told you to run backup-then-merge by
hand. A read-only investigation on Tower proved both wrong: the cron is
installed and firing, the backup is current, and **running the merge by hand
would have failed exactly the way every scheduled run has been failing.** Fix
the merge first. Everything below assumes you do.

This is self-contained. You do not need any prior conversation.

---

## 1. What the archive is for

Production Supabase prunes on timers — `raid_roster` 1h, `buff_casts` 7d,
`encounter_threat_snapshots` 30d, `who_observations` 60d, `target_observations`
1d. Tower is the **long-horizon record**: it keeps what those sweeps throw away,
which is what makes questions like *"threat patterns over months"* answerable at
all. Production can never answer them; its window is days.

Two scripts, both in this repo, run nightly via the Unraid **User Scripts**
plugin under the wrapper `wolfpack-nightly-archive`:

| Script | Schedule | What it does |
|---|---|---|
| the backup | `0 5 * * *` | Full `pg_dump` from Supabase → `/mnt/user/backups/wolfpack/`, repoints `latest.dump` |
| `scripts/refresh-local-archive.sh` | `30 5 * * *` | Restores that dump into scratch DB `wolfpack_snap`, exposes it through `postgres_fdw` as schema `snap`, merges into the archive |

The merge is **insert + update, NEVER delete** for allowlisted tables
(`scripts/lib/archive-merge.sql` — `encounter_threat_snapshots` is on that
list). So **re-running it is safe and idempotent**; it cannot lose history. Every
successful run writes one row per table to `archive_meta.merge_log`.

Everything lives in the `postgres` database on the `supabase-db` container.
`wolfpack_snap` is a throwaway the merge creates and drops each run — do not
query it.

## 2. What is actually broken

`scripts/lib/archive-merge.sql` merged tables in **alphabetical order**
(`order by c.relname`, old line 73). `charm_sessions` sorts before `encounters`,
the table it references. The first time a charm session pointed at an encounter
newer than the archive's copy of `encounters`, its insert failed the foreign key:

```
ERROR:  insert or update on table "charm_sessions" violates foreign key constraint
        "charm_sessions_encounter_id_fkey"
DETAIL: Key (encounter_id)=(…) is not present in table "encounters".
MERGE FAILED — archive untouched by the failing table
merge exit=1
```

The whole merge is **one statement**, so one FK violation rolls back every
table and writes **no `merge_log` row at all** — which is why the newest merge
entry is still 2026-09-06 and why nothing looked like it was failing. The
wrapper's later steps (VM XML dumps, the local archive's own `pg_dump`) kept
succeeding and printing OK. Seventeen nights, silent.

**Reproduced from the catalog alone** on a throwaway Postgres 16, with a fixture
shaped like the real tables — same error, same constraint name — and the fixed
version merges it clean. That reproduction is now a permanent test
(`scripts/test-archive-merge.sh`), mutation-checked in both directions.

### The fix

`scripts/lib/archive-merge.sql` now orders tables by the **real FK graph**
(`pg_constraint`, longest-path depth, cycle-capped) instead of by name, and runs
its two passes in **opposite directions**:

- **insert/update — parents first.** A child row cannot reference a parent the
  archive has not received yet.
- **mirror deletes — children first.** The same violation with the arrow
  reversed: a mirror parent whose row is gone upstream still has local children
  until their own turn.

Both directions are load-bearing. Alphabetical order got the delete direction
right by luck roughly half the time and the insert direction wrong. Measured
against production's real catalog, the graph is a clean 5-level DAG:
`encounters` at depth 2, `charm_sessions` and `encounter_threat_snapshots` at 3,
`encounter_players` at 4. No cycles.

`scripts/refresh-local-archive.sh` also gained one guard: it now fails if the
merge wrote no `merge_log` rows for this run. Its old success check was
`select count(*) from encounters >= 1`, which passes happily against a frozen
archive — that is the check that let this run silent.

## 3. Deploy the fix to Tower

The fix is on branch **`claude/sharp-lamport-dC0TW`** (commit `789ca70`). If
your local checkout is on `main` and does not have it yet:

```bash
git fetch origin claude/sharp-lamport-dC0TW
git show origin/claude/sharp-lamport-dC0TW:scripts/lib/archive-merge.sql > /tmp/archive-merge.sql
```

⚠ **Tower's copy of the repo is not a git checkout** (`fatal: not a git
repository`), so you copy the files by hand. Three files changed:

```
scripts/lib/archive-merge.sql        <- the fix
scripts/refresh-local-archive.sh     <- the freshness guard + a stale comment
scripts/test-archive-merge.sh        <- the FK-ordering tests
```

**First confirm Tower's copy has not drifted** — nothing on the box records
whether someone hand-edited it. Expected checksums of the version Tower should
currently be running:

```bash
md5sum /mnt/user/backups/wolfpack/repo/scripts/lib/archive-merge.sql
#   f040934378c642b33087a1e246ab8bb1   (144 lines, the broken version)
md5sum /mnt/user/backups/wolfpack/repo/scripts/refresh-local-archive.sh
#   caf5d19da4e13b02d0c81c5307b098c5
```

If either differs, **stop and say so** — Tower is running something that is not
in the repo, and overwriting it would destroy the only copy. (A spot check
already matched: Tower's line 73 reads `order by c.relname`, byte-identical to
the repo's broken version, and lines 7/24/36/49/77/92/140 match too.)

Then copy the three files over. The `.orig` siblings already on the box are from
the 2026-09-06 install; leave them, and take one more copy of what you replace:

```bash
cd /mnt/user/backups/wolfpack/repo
cp scripts/lib/archive-merge.sql       scripts/lib/archive-merge.sql.bak-20260923
cp scripts/refresh-local-archive.sh    scripts/refresh-local-archive.sh.bak-20260923
# …then write the three new files from the repo.
```

After copying, the new checksums should be:

```
b945adea99b7abf512c33555547dd3c9  scripts/lib/archive-merge.sql
591fa35842417d58537eeb9f22b47306  scripts/refresh-local-archive.sh
96f6318bde77b1b37c65b981b293f496  scripts/test-archive-merge.sh
```

## 4. Prove it on a scratch database first

The self-test never touches the archive. It creates a database called
`archive_merge_selftest`, builds fixtures in it, runs the merge twice, and drops
the database at both ends. Unraid's host has no `psql`, so run it inside the
container:

```bash
cd /mnt/user/backups/wolfpack/repo
docker exec -i supabase-db mkdir -p /tmp/mt/scripts/lib
docker cp scripts/lib/archive-merge.sql  supabase-db:/tmp/mt/scripts/lib/
docker cp scripts/test-archive-merge.sh  supabase-db:/tmp/mt/scripts/
docker exec -i supabase-db bash -lc 'cd /tmp/mt && PGUSER=postgres bash scripts/test-archive-merge.sh'
docker exec -i supabase-db rm -rf /tmp/mt
```

(`docker cp` is fine here — these are ordinary files. The rule further down is
specifically about `latest.dump`, which is a *symlink*.)

Expect 14 `ok` lines and `PASS`. Two of them are the point:
`FK parent inserted before its child` and `FK child deleted before its parent`.
Both were checked by mutation — reverting either direction in the SQL makes the
corresponding line fail with the real constraint name. If the test fails, **do
not run the real merge**; send the output back.

## 5. Run the catch-up

⚠ **Do NOT pull a fresh dump first.** Today's dump is already current
(`/mnt/user/backups/wolfpack/wolfpack-2026-09-22.dump`, 268 MB, written 05:05),
and a new `pg_dump` is real egress off a paid plan for no gain. The merge will
carry everything up to that dump's timestamp; the next scheduled run picks up
the rest.

```bash
cd /mnt/user/backups/wolfpack/repo
bash scripts/refresh-local-archive.sh
```

The merge preflights hard — it aborts *before touching the archive* if the dump
is missing or if the snapshot restores fewer than 50 tables. A bad dump cannot
corrupt anything.

**Expect this run to be slow and to grow the pool.** It is merging 17 days of
backlog across every archive table at once, ~275,000 threat-snapshot rows among
them. The local archive's own dump has sat at exactly 357.28 MB since 09-06;
after this it should jump.

## 6. Verify

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select count(*), min(snapshot_at), max(snapshot_at) from encounter_threat_snapshots;"

docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select table_name, mode, rows_before, rows_after, rows_kept, ran_at
     from archive_meta.merge_log
    where table_name in ('encounter_threat_snapshots','charm_sessions','target_observations')
    order by ran_at desc, table_name limit 9;"
```

Expect `count` to rise from 915,340 by roughly 275,000, `max(snapshot_at)` to
reach **2026-09-22 05:0x UTC** — the dump's timestamp, not "now" — and `mode`
to read `archive`. `charm_sessions` should appear as `mirror`, which is the
table that has been blocking everything.

(`rows_kept` counts rows the archive holds that the snapshot has lost. It has
been 0, consistent with production's threat sweep never having successfully
deleted anything. It should stay 0 or small.)

## 7. Report back

Paste both query outputs, plus the three things the first investigation left
open — they are still open, and all three are one command each:

```bash
# a) which job writes the 05:05 dump
grep -rl "pg_dump\|wolfpack-" /boot/config/plugins/user.scripts/scripts/*/script

# b) where latest.dump points
ls -l /mnt/user/backups/wolfpack/latest.dump && readlink -f /mnt/user/backups/wolfpack/latest.dump

# c) the merge_log row for the table this is all about
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select * from archive_meta.merge_log where table_name='encounter_threat_snapshots' order by ran_at desc limit 5;"
```

⚠ **Do not write anything to production Supabase.** The watermark that authorises
production deletions is set separately by a cloud session, once the new
`max(snapshot_at)` above is confirmed. A watermark that runs ahead of what the
archive actually holds is the one failure mode that costs data.

## 8. What the outage already cost, and what is still at risk

The gate on the threat sweep held — production has deleted **nothing** from
`encounter_threat_snapshots`, whose oldest row is still 2026-07-02. Two other
tables were not so lucky, and one of them is a live clock:

| Table | Retention | Oldest row in production | Status |
|---|---|---|---|
| `encounter_threat_snapshots` | 30d | 2026-07-02 | safe — sweep is gated on the watermark |
| `who_observations` | 60d | 2023-11-10 | safe — sweep evidently not deleting either |
| `buff_casts` | 7d | **2026-09-15** | ⚠ **2026-09-06 → 09-15 is gone for good.** Production pruned it; Tower never received it. Roughly nine days, ~85k rows. Nothing recovers this |
| `target_observations` | **1d** (was 90d until bot 3.1.136) | 2026-08-04 | ⚠ **at risk right now.** 306,570 rows spanning 50 days, and Tower's copy stops at 09-06. The sweep has no archive gate |
| `raid_roster` | 1h | 2026-09-22 | always been near-empty at 05:30; nothing meaningful lost |

**`target_observations` is the one to act on.** Its retention dropped from 90
days to 1 on 2026-09-22 at the guild lead's call (*"Target observations do not
matter the next day"*) — which is right for production, and is exactly why Tower
should have them. The first midnight sweep that completes inside its 10s timeout
takes ~50 days of them with it. Catching the archive up tonight is what saves
them; after that, production pruning them daily is fine and intended.

It has not fired yet only because the index that would make the sweep fast
(`supabase/migrations/20260923010000_retention_sweep_indexes.sql`) has **not
been applied** — `CREATE INDEX CONCURRENTLY` cannot run inside the transaction
the migration runner uses. That is a cloud-session fix, tracked separately. Do
not treat it as protection; it is a bug that happens to be buying time.

## 9. Then the alert, so this cannot go quiet again

`wolfpack-healthcheck` runs every 15 minutes and does not look at the merge.
Seventeen nights is how long that costs. Add either check — both are cheap:

```bash
# the merge wrote nothing in the last 26 hours
STALE=$(docker exec -i supabase-db psql -U postgres -d postgres -tAc \
  "select case when max(ran_at) < now() - interval '26 hours' then 1 else 0 end
     from archive_meta.merge_log")
[ "$STALE" = "1" ] && echo "ALERT: wolfpack archive merge has not succeeded in over a day"
```

…and/or have `wolfpack-nightly-archive` shout on `merge exit≠0` rather than only
printing it. The wrapper already exits with the merge's code; nothing reads it.

## 10. Guardrails

- **Timing.** Running it by hand tonight is fine, but keep *scheduled* runs off
  **19:30–00:30 ET** — that is a full dump pulled from production while raiders
  are uploading.
- **Never `docker cp` the dump.** It copies the `latest.dump` *symlink*, reports
  `Successfully copied 0B`, and leaves a dangling link inside the container
  (2026-08-11). Stream it on stdin with `-i`, which both scripts already do.
- **Do not "fix" this by disabling production's retention.** The threat sweep is
  deliberately gated and is currently behaving correctly. The archive is the
  half that is behind.
- **Re-running the merge is safe.** If you are unsure whether a run completed,
  run it again rather than guessing — allowlisted tables never delete.
