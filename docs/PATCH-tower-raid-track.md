# PATCH — Tower `archive-merge.sql`: keep raid positions and raid looks (2026-10-05)

**For whoever has a terminal on Tower** (the guild lead, a local session, or a Claude in Chrome
session driving the Unraid web terminal). Self-contained; no prior conversation needed. About five
minutes. Why: `DECISIONS-2026-09-21.md` §161 and §166 — the raid recorder (bot 3.1.203) writes
`raid_track_minutes`, the appearance snapshot (bot 3.1.208) writes `raid_night_appearance`, and
Tower keeps the permanent copy of both. The merge only copies tables it knows, so until this file is
replaced Tower silently skips them.

What changes: ONE file on Tower, `scripts/lib/archive-merge.sql` (adds `raid_track_minutes` and
`raid_night_appearance` to the archive tables and creates them if Tower lacks them). The self-test is
downloaded to `/tmp` only. `refresh-local-archive.sh` and the nightly schedule are not touched.
(Revised 2026-10-05 evening to the bot 3.1.208 file before anyone had run the first version.)

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
R=https://raw.githubusercontent.com/davehess/QuarmBossTracker/7ae47c7ffbd4b56f07027fa65035d1916e8bad82/scripts
curl -fsSL -o scripts/lib/archive-merge.sql "$R/lib/archive-merge.sql"
curl -fsSL -o /tmp/test-archive-merge.sh    "$R/test-archive-merge.sh"
md5sum scripts/lib/archive-merge.sql /tmp/test-archive-merge.sh
# 86ccf9036d770a2a2081104c3eba7df4  scripts/lib/archive-merge.sql
# 2a51abe3052609eca3481ea89bae094a  /tmp/test-archive-merge.sh
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

Expect **24 `ok` lines and `PASS`**. The four new ones are
`merge creates raid_track_minutes and fills it`, `raid_track_minutes keeps a minute production dropped`,
`merge creates raid_night_appearance and fills it, arrays and all` and
`raid_night_appearance keeps a look production dropped`.

If anything says `FAIL`, put the old file back and send the output:

```bash
cp scripts/lib/archive-merge.sql.bak-20261005 scripts/lib/archive-merge.sql
```

**4 — Nothing else to run.** The next nightly job creates both tables on Tower and copies them from
then on. Rows only appear once a raid has run on bot 3.1.208 or later (the first is Wednesday
2026-10-07).

**Afterwards (a cloud session can do this):** read `select count(*) from raid_track_minutes` and
`select count(*) from raid_night_appearance` on Tower as `claude_ro`. If that says permission denied,
the read-only login needs `grant select on public.raid_track_minutes, public.raid_night_appearance to
claude_ro;` (run as `postgres` inside `supabase-db`) — `claude_ro`'s grants were given table by table.
