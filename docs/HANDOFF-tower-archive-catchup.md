# HANDOFF — Tower archive: catch up the threat-snapshot backlog

**For a LOCAL session with Tower access.** A cloud session cannot do this — it
has the repo and Supabase, but not the box. Written 2026-09-23.

This is self-contained. You do not need any prior conversation.

---

## 1. What the archive is for

Production Supabase prunes on timers — `raid_roster` 1h, `buff_casts` 7d,
`encounter_threat_snapshots` 30d, `who_observations` 60d, `target_observations`
1d. Tower is the **long-horizon record**: it keeps what those sweeps throw away,
which is what makes questions like *"threat patterns over months"* answerable at
all. Production can never answer them; its window is days.

Two scripts, both in this repo, meant to run nightly via the Unraid **User
Scripts** plugin:

| Script | Schedule | What it does |
|---|---|---|
| `scripts/unraid-backup-supabase.sh` | `0 5 * * *` | Full `pg_dump` from Supabase → `/mnt/user/backups/wolfpack/`, repoints `latest.dump` |
| `scripts/refresh-local-archive.sh` | `30 5 * * *` | Restores that dump into scratch DB `wolfpack_snap`, exposes it through `postgres_fdw` as schema `snap`, merges into the archive |

The merge is **insert + update, NEVER delete** for allowlisted tables
(`scripts/lib/archive-merge.sql` — `encounter_threat_snapshots` is on that
list). So **re-running it is safe and idempotent**; it cannot lose history. Every
run writes a row to `archive_meta.merge_log`.

Everything lives in the `postgres` database on the `supabase-db` container.
`wolfpack_snap` is a throwaway the merge creates and drops each run — do not
query it.

## 2. Current state, measured 2026-09-23

```
archive:      915,340 rows | 2026-07-02 04:00 → 2026-09-06 07:17
production: 1,192,104 rows | 2026-07-02        → now
gap:        ~275,000 rows that exist ONLY in production
last merge:  2026-09-06 20:00   (17 days ago)
```

⚠ **Both surviving `merge_log` entries ran at 19:43 and 20:00 — not the
`30 5 * * *` the script documents.** That reads like the merges were run by hand
once and **the cron was never installed**, rather than installed-and-failing.
Check that before assuming something broke.

**Why there is a clock on this.** Production's retention sweep is now gated on an
archive watermark (`bot_kv` key `archive_watermark_threat_snapshots`) and deletes
only up to the *older* of that watermark and the 30-day retention bound. Right
now retention is the binding bound, so the gate is invisible. Around
**2026-10-06** the retention cutoff overtakes the frozen 2026-09-06 watermark and
deletions stop entirely — safe, but the table then resumes growing ~23 MB/day.

## 3. Troubleshoot in this order

**1 — Did the BACKUP stop too, or only the merge?** This is the most likely
root cause; do it first.

```bash
ls -la /mnt/user/backups/wolfpack/ | tail -20
```

If the newest dump is also from 2026-09-06, the backup is the cause and the merge
was innocent — it would only ever have re-merged a stale dump. Also confirm
`latest.dump` is a symlink pointing at a file that still exists.

**2 — Are the User Scripts actually installed AND scheduled?**

```bash
ls /boot/config/plugins/user.scripts/scripts/
```

Look for both scripts, and check each has a `schedule` file carrying the Custom
cron. ⚠ Unraid silently does nothing if a script's schedule is left at "Manual" —
it will sit there looking installed forever.

**3 — Is the connection string present, and the right one?**

```bash
ls -l /boot/config/wolfpack-db-url
```

Must exist and be readable (`chmod 600`). ⚠ It has to be the **session pooler on
port 5432**, not the transaction pooler on 6543 — `pg_dump` needs session state
and will fail against 6543.

**4 — If they ran and failed, find out how.** Check the User Scripts log output,
and `/tmp/arch-restore.err`, where the merge writes `pg_restore` errors.

## 4. Catch up now

⚠ **Order matters.** Running the merge alone re-merges the 2026-09-06 dump and
changes nothing.

```bash
# 1. fresh dump from production  (~106 MB pull — real egress)
bash scripts/unraid-backup-supabase.sh

# 2. merge it into the archive
bash scripts/refresh-local-archive.sh
```

The merge preflights hard — it aborts *before touching the archive* if the dump
is missing or if the snapshot restores fewer than 50 tables. A bad dump cannot
corrupt anything.

**Then verify:**

```bash
docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select count(*), min(snapshot_at), max(snapshot_at) from encounter_threat_snapshots;"

docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select table_name, mode, rows_before, rows_after, rows_kept, ran_at
     from archive_meta.merge_log
    where table_name='encounter_threat_snapshots' order by ran_at desc limit 3;"
```

Expect `count` to rise by roughly 275,000 and `max(snapshot_at)` to reach today.
`mode` must read `archive`. (`rows_kept` counts rows the archive holds that the
snapshot had lost — it has been 0, which is consistent with production never
having successfully deleted anything.)

## 5. Report back

Paste both query outputs, plus what you found in steps 1–4.

⚠ **Do not write anything to production Supabase.** The watermark that authorises
deletions is set separately, once the new `max(snapshot_at)` is confirmed. A
watermark that runs ahead of what the archive actually holds is the one failure
mode that costs data.

## 6. Guardrails

- **Timing.** Running it by hand tonight is fine, but keep *scheduled* runs off
  **19:30–00:30 ET** — that is a full dump pulled from production while raiders
  are uploading.
- **Never `docker cp` the dump.** It copies the `latest.dump` *symlink*, reports
  `Successfully copied 0B`, and leaves a dangling link inside the container
  (2026-08-11). Stream it on stdin with `-i`, which both scripts already do.
- **Do not "fix" this by disabling production's retention.** The sweep is
  deliberately gated and is currently behaving correctly. The archive is the half
  that is behind.
- **Re-running the merge is safe.** If you are unsure whether a run completed,
  run it again rather than guessing — allowlisted tables never delete.
