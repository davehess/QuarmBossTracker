# PATCH — Tower `archive-merge.sql`: keep raid positions (2026-10-05)

**For whoever has a terminal on Tower** (the guild lead, a local session, or a Claude in Chrome
session driving the Unraid web terminal). Self-contained; no prior conversation needed. About five
minutes. Why: `DECISIONS-2026-09-21.md` §161 — the raid recorder (bot 3.1.203) writes
`raid_track_minutes`, and Tower keeps the permanent copy. The merge only copies tables it knows,
so until this file is replaced Tower silently skips raid positions.

What changes: ONE file on Tower, `scripts/lib/archive-merge.sql` (adds `raid_track_minutes` to the
archive tables and creates the table if Tower lacks it). The self-test is downloaded to `/tmp`
only. `refresh-local-archive.sh` and the nightly schedule are not touched.

All commands run on the Unraid host, in the repo copy:

```bash
cd /mnt/user/backups/wolfpack/repo
```

**1 — Confirm Tower is running the version the repo last gave it.**

```bash
md5sum scripts/lib/archive-merge.sql
# expect 0b2ceb1a5956abbecf6ec480027153df   (installed 2026-09-23)
```

If it prints anything else, **stop and send the line back**: Tower is running something the repo
does not have, and overwriting it would lose that.

**2 — Keep a copy, then fetch the new file and the test** (pinned to the commit, so the bytes are
exactly the ones checked here):

```bash
cp scripts/lib/archive-merge.sql scripts/lib/archive-merge.sql.bak-20261005
R=https://raw.githubusercontent.com/davehess/QuarmBossTracker/04d9089016807bfb32ca413c5a1bc29fb048cca4/scripts
curl -fsSL -o scripts/lib/archive-merge.sql "$R/lib/archive-merge.sql"
curl -fsSL -o /tmp/test-archive-merge.sh    "$R/test-archive-merge.sh"
md5sum scripts/lib/archive-merge.sql /tmp/test-archive-merge.sh
# c08f309cd5ea09f6793aecf7ba1a5bed  scripts/lib/archive-merge.sql
# 10fb4b21c71aca2624fe4f25a73f46bf  /tmp/test-archive-merge.sh
```

**3 — Self-test on a scratch database** (never touches the archive; Unraid has no `psql`, so it
runs inside the container):

```bash
docker exec -i supabase-db mkdir -p /tmp/mt/scripts/lib
docker cp scripts/lib/archive-merge.sql supabase-db:/tmp/mt/scripts/lib/
docker cp /tmp/test-archive-merge.sh    supabase-db:/tmp/mt/scripts/test-archive-merge.sh
docker exec -i supabase-db bash -lc 'cd /tmp/mt && PGUSER=postgres bash scripts/test-archive-merge.sh'
docker exec -i supabase-db rm -rf /tmp/mt
```

Expect **22 `ok` lines and `PASS`**. The two new ones are
`merge creates raid_track_minutes and fills it` and `… still 2 after a snapshot row is gone`.

If anything says `FAIL`, put the old file back and send the output:

```bash
cp scripts/lib/archive-merge.sql.bak-20261005 scripts/lib/archive-merge.sql
```

**4 — Nothing else to run.** The next nightly job creates `raid_track_minutes` on Tower and copies
it from then on. Rows only appear once bot 3.1.203 is on `main` and a raid has run.

**Afterwards (a cloud session can do this):** read `select count(*) from raid_track_minutes` on
Tower as `claude_ro`. If that says permission denied, the read-only login needs
`grant select on public.raid_track_minutes to claude_ro;` (run as `postgres` inside
`supabase-db`) — `claude_ro`'s grants were given table by table.
