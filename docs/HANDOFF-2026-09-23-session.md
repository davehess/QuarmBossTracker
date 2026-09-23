# HANDOFF — the 2026-09-23 cloud session, to the next session

**Written 2026-09-23 ~13:10 ET by the outgoing cloud session, at the guild lead's
request:** *"give me a very verbose handoff doc to give to a new session that will
not have these issues with running sql commands. i cannot do this SQL approval
constantly with you. This is a months-long deployment channel for me with a ton of
real data buried here."*

This is self-contained. The next session does not need the old conversation. Every
number below was measured this session unless it says otherwise. Every "not done"
really is not done — nothing half-applied is hiding behind a "✅".

Read §0 and §1 before touching anything. §5 has a safety finding that changes what
is safe to do to production.

---

## 0. Sixty-second summary

**Where things are:**

| Thing | State |
|---|---|
| `main` | `2bc7b90` — bot **3.1.137**, web **1.7.46** |
| Branch `claude/sharp-lamport-dC0TW` | `059be02` — **18 commits ahead of `main`**, fast-forwardable. Bot **3.1.140**, web **1.7.47** |
| `beta` | `d0bd3d6` — agent **3.6.56**, Mimic line **2.6.9** (parked; the workflow auto-numbers `-beta.N`) |
| Production Supabase | Nothing destructive done to threat data. Five guild triggers disabled (§6). **No archive watermark set** — on purpose (§5) |
| Tower archive | **Caught up** 2026-09-23 after a 17-night outage (§7). One optional older dump still to merge (item 3) |

**The three things the guild lead asked for, in the order they asked:**

1. **Item 1 — build the per-fight "flattened threat graph married to player
   deaths".** STOPPED mid-investigation when this handoff was requested. **Nothing
   written to production for it.** The design is worked out in §5, and so is a
   safety finding (`thin_threat_snapshots` is an ungated deletion path) that has
   to be settled first.
2. **Item 2 — land the branch on `main`.** Not done. ⚠ **2026-09-23 is a
   Wednesday raid night: no `main` push 19:30 → 00:30 ET.** Either before 19:30 or
   after 00:30. Procedure in §3.
3. **Item 3 — merge the 2026-09-01 dump on Tower.** The guild lead runs this on
   Tower; the commands are in §4. It may already be done by the time you read this.
   Ask for the before/after query output.

---

## 1. Permissions — why SQL will not prompt in YOUR session, and what still will

### Why the old session prompted for every SQL call

`.claude/settings.json` allowlists `mcp__Supabase__execute_sql`. That rule landed
on **2026-09-22** (commit `ca4428b`), *during* the old session. **Claude Code reads
the allowlist once, at session start**, so the old session never had it, no matter
how often the file was fixed. A fresh session on ANY branch has it: `main`, `beta`
and `claude/sharp-lamport-dC0TW` all carry the rule (checked with `git show
<branch>:.claude/settings.json`).

**Start the new session on branch `claude/sharp-lamport-dC0TW`.** It has everything
`main` has plus today's work, and it is where items 1 and 2 continue.

### The full allowlist (19 entries, on the branch)

```
mcp__Supabase__execute_sql          mcp__Supabase__list_tables       mcp__Supabase__list_migrations
Bash(npm test)                      Bash(npm run lint)               Bash(npm run check:dashboard)
Bash(npm run golden:check)          mcp__github__actions_list        mcp__github__actions_get
mcp__github__get_job_logs           mcp__github__list_releases       mcp__github__get_release_by_tag
mcp__github__list_commits           mcp__github__get_commit          mcp__github__list_branches
mcp__github__get_file_contents      mcp__github__pull_request_read   mcp__github__issue_read
mcp__Railway__get-logs
```

⚠ `execute_sql` can WRITE as well as read. The guild lead allowlisted it anyway,
knowingly: *"Stop requesting execution for SQL on supabase, just do it."* That makes
YOU the only safeguard on destructive SQL. Read §5 before any DELETE, and never run a
destructive statement on threat, buff, chat or encounter data without checking the
archive first.

### What will STILL prompt, and why it has to

These must never go on the allowlist, because each one can run arbitrary code or
change state: `python3`, `node`, `perl`, `bash`, `awk`, `npx …`, `su`, `psql`,
`curl`, `git commit`, `git push`, `cp`, `rm`, `mcp__Supabase__apply_migration`.

**How to keep prompts rare — measured from the old session's 1,069 tool calls:**

- **Edit files with Edit/Write, never `sed -i` / `perl -0pi` / heredoc-into-file.**
  The old session broke this rule in its mutation checks (`perl -0pi` to break the
  code, `cp` to restore it). Do mutation checks with **Edit to break, Edit to
  restore.** It is also the rule in `CLAUDE.md`.
- **Run the suite as `npm test`** (exact, allowlisted, about 20 s for all 250 files)
  rather than `npx vitest run <file>`, which prompts every time. It was the
  single biggest source of prompts: 81 calls.
- **`npm run lint`, `npm run check:dashboard` and `npm run golden:check`** are all
  exact and allowlisted.
- **Batch your commits.** Each `git commit -F` / `git push` prompts once; commit
  messages still go through a file (`CLAUDE.md` rule, backtick hazard).
- **SQL: use `execute_sql` for everything, including DDL**, when a migration must
  also be committed. The Migrations rule says apply with the same name AND commit the
  identical file, and `apply_migration` prompts, so the least-friction route is
  `execute_sql` + the committed file. But `execute_sql` does not record the
  migration in `supabase_migrations.schema_migrations`, so note it in the
  commit (see §3's migration caveat).
- **Web access changed after this doc was first written:** the guild lead switched
  the cloud environment's Network access from Trusted to **Full** (2026-09-23).
  `www.pqdi.cc`, `www.eqemulator.org`, `quarm.guide` and `typesafe.ai` all answered
  that day. Use `www.pqdi.cc`, because bare `pqdi.cc` resets the connection. That
  means the Jev retention question (§9) and PQDI lookups can now be done from a
  cloud session.
- **Throwaway Postgres for local SQL tests:** `/usr/lib/postgresql/16/bin` exists in
  the container. It must run as the `postgres` user (so `su` prompts), with its
  socket in `/tmp/pgs`, because the scratchpad path is too long for a Unix socket.
  Worth it for anything that touches `scripts/lib/archive-merge.sql`, and nothing
  else.

---

## 2. Branches, versions, and where each change lives

### `main` — `2bc7b90`
Bot 3.1.137 (the archive-gated threat sweep, `[hotfix]`), web 1.7.46.

### Branch `claude/sharp-lamport-dC0TW` — `059be02`, 18 commits ahead of `main`

A straight descendant of `origin/main`, so landing it is a fast-forward. Grouped:

| Area | Commits | What |
|---|---|---|
| **Bot 3.1.138** | `29a79ab` | A disabled/deleted guild trigger now actually stops firing. The agents' no-change gate was `max(updated_at)` of ENABLED rows, which a disable can never move. Now a membership hash (`_guildTriggersVersion`). Test `test/guild-triggers-version.test.js` |
| **Bot 3.1.139** | `ecf87af` | Extended Target merges rows whose targeters report the SAME spawn id (position clustering had split one mob into `#1/3 #2/3 #3/3`). `target_id = 0` no longer mints a phantom `#0` instance. Test `test/ext-target-agreed-id.test.js` |
| **Bot 3.1.140** | `892c1c9` | mob-info tells same-name NPCs apart by capitalisation (`a_Shissar_acolyte` 162488 Warrior vs `A_Shissar_Acolyte` 162153 Wizard). 76 names differ this way, 19 in class. Test `test/mobinfo-case-variants.test.js` |
| **Web 1.7.47** | `4ba5917` | Roadmap entry for the 2026-09-23 beta release, titled with the plain version string (release names are the guild lead's call) |
| **Archive scripts** | `789ca70` `71651e4` `bffb587` `119552e` `0bf44d8` | The five Tower merge fixes, plus the report-window fix (§7) |
| **Docs** | the rest | Tower handoffs, `DECISIONS-2026-09-21.md` §6 (Jev) and §7 (today), STATUS ledger |
| **Settings** | `059be02` | +`npm run golden:check`, +`mcp__Railway__get-logs` |

### `beta` — `d0bd3d6`

| Commit | What |
|---|---|
| `d85f592` agent 3.6.54 | Enrage callouts speak (the #136 allow-list never had enrage); the Tank overlay counts every damage-shield return (the pairing only looked backward, so shield-then-swing counted 0 of 10); outside a raid Extended Target shows only your group; the Extended Target title bar no longer overlaps; the suggested "Mob is enraged" trigger matches the real line |
| `4932264` Mimic 2.6.9 line | Mute silences instead of hiding trigger alerts; tray Quiet mode now reaches the CH-chain and charm voices; "No overlays" in the tray; the tray Overlays list sorted A–Z; Settings in columns when maximized; "Trigger alerts" relabeled (it switches the whole trigger overlay off, not just the voice) |
| `b74f002` agent 3.6.55 | Slow callouts name the mob and its spawn id when Zeal proves it |
| `d0bd3d6` agent 3.6.56 | Target Info's cache keys on the case-kept name (the agent half of the acolyte fix — the bot half is 3.1.140 on the branch; BOTH are needed) |

The release builds for `d85f592`, `4932264` and `b74f002` all succeeded (GitHub
Actions "Release Mimic (Electron)"). `d0bd3d6`'s was not checked before this
handoff: check it with `mcp__github__actions_list` (allowlisted).

**Nothing from today is on the stable channel.** Stable users get it only when the
guild lead cuts a stable release (`CLAUDE.md` → Release playbook).

### Working on `beta` from this checkout — the method that worked

```bash
git worktree add -B beta-work /home/user/qbt-beta origin/beta
ln -s /home/user/QuarmBossTracker/node_modules /home/user/qbt-beta/node_modules
# …edit in /home/user/qbt-beta…
git -C /home/user/qbt-beta fetch origin beta
git -C /home/user/qbt-beta merge-base --is-ancestor origin/beta HEAD && echo fast-forward-ok
git -C /home/user/qbt-beta push origin beta-work:beta
```

Bump `packages/wolfpack-logsync/package.json` for agent changes. Do NOT bump
`apps/mimic/package.json` — it is parked at the line's version and the workflow
auto-increments `-beta.N`. Put member-facing bullets in a `<!--player-notes-->`
block in the commit: the release body and the #mimic-releases post come from it.

---

## 3. Item 2 — landing the branch on `main`

**Freeze: Sun/Wed/Thu 19:30 → 00:30 ET.** 2026-09-23 is a Wednesday. Check the clock
(`TZ=America/New_York date`) before pushing.

```bash
cd /home/user/QuarmBossTracker
git fetch origin main
git merge-base --is-ancestor origin/main HEAD && echo "fast-forward OK"   # must print
npm test && npm run lint                                                  # 250 files green on 059be02
git push origin claude/sharp-lamport-dC0TW:main
```

Then:

- **Railway** redeploys the bot from `main`. Watch it with `mcp__Railway__get-logs`
  (allowlisted). Railway shows the tip commit's message as the deploy name.
- **Vercel** redeploys web 1.7.47.
- **`sync-beta.yml`** merges `main` → `beta` automatically. Confirm it did not fail
  (`mcp__github__actions_list`). Any conflict outside the two version files means
  `main` and `beta` diverged on shared code, and the workflow fails on purpose.

### ⚠ Migration caveat — read before assuming anything applies itself

`supabase/migrations/20260923010000_retention_sweep_indexes.sql` has been on
`main` since bot 3.1.136 and **was never applied**: `schema_migrations`' newest row
is `20260914043836`. It uses `CREATE INDEX CONCURRENTLY`, which cannot run inside
the transaction a migration runner uses. `faction_hits` (`20260922200000`) is not
in `schema_migrations` either, even though the table exists: it was applied with
`execute_sql`. **So on this project, landing on `main` does NOT reliably apply
migrations.** Check the database after the push rather than assuming.

⚠ **And do NOT create that `snapshot_at` index by hand yet.** §5 explains why:
creating it may switch on an ungated nightly deletion.

---

## 4. Item 3 — the 2026-09-01 dump on Tower (the guild lead runs this)

The oldest dump on disk. It covers about 2026-08-25 → 09-01, so it recovers roughly
five more days of `buff_casts`, and full-resolution threat snapshots for that span
if thinning ever deleted them (§5). It reads files already on disk, so nothing is
pulled from production.

```bash
cd /mnt/user/backups/wolfpack/repo

docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select 'buff_casts' t, count(*), min(cast_at), max(cast_at) from buff_casts
   union all
   select 'threat', count(*), min(snapshot_at), max(snapshot_at) from encounter_threat_snapshots;"

DUMP=/mnt/user/backups/wolfpack/wolfpack-2026-09-01.dump bash scripts/refresh-local-archive.sh \
  && bash scripts/refresh-local-archive.sh            # latest LAST so mirror tables end current

docker exec -i supabase-db psql -U postgres -d postgres -c \
  "select count(*), min(cast_at) from buff_casts;"
```

**The script's own report will say "(0 rows)" and "0 rows exist ONLY here". That is
wrong, and here is why.** `merge_log.ran_at` is `now()` inside the merge's single
transaction, which is when the merge STARTED, so a "last 10 minutes" window misses
any merge longer than that. The repo's script is fixed (`0bf44d8`, a start marker
taken just before the merge), but **Tower runs its own drifted copy** of
`refresh-local-archive.sh`, which does not have the fix. Use the before/after
queries, not the report.

The threat line's `max(snapshot_at)` from the first query is the number a future
production watermark is set from (§5).

---

## 5. Item 1 — the per-fight threat graph, and the safety finding in front of it

### The ask, verbatim (the guild lead, 2026-09-22)

> "let's keep threat data until it gets pulled out into the backup database on my
> server. per fight, consolidate the threat data into a flattened graph, married up
> with the player deaths from those fights. make sure that the data isn't removed
> from the on-prem database then make deletions from the table"

**Order: consolidate → confirm on-prem → delete.** On-prem is now confirmed (§7).
Consolidation is not built. **So no deletion yet**, and that is why no watermark was
set.

### What the data looks like (production, measured 2026-09-23)

`encounter_threat_snapshots` — about **1.20M rows**, oldest **2026-07-02**. Columns:
`id uuid, guild_id, encounter_id uuid, boss_name, started_at, snapshot_at, uploader,
per_player jsonb, total numeric, created_at, target_name, raid_night_id`.

- **805,670 rows have `encounter_id IS NULL`** (unbound): 439k July, 239k August,
  127k September. Binding only started in August (July has just 376 bound rows).
  All 805,687 unbound rows carry `started_at`; 308,502 carry `boss_name`; 300,990
  carry `raid_night_id`.
- Bound rows cover 14,993 encounters, average 27 snapshots, max 3,420.
- `per_player` shape, per character: `{dmg, heal, proc, took, spell, swing, total,
  healRaw, tookMax, pet_owner, procDetail}`. The values are CUMULATIVE for the fight
  from that uploader's view. Cadence about 18 s (code comment).

### What already exists — reuse it, do not rebuild it

- **`public.encounter_timeline(p_encounter_id uuid, p_step_sec int default 5)`**
  **is already the per-fight graph.** It returns rows `(t_sec, char_name,
  pet_owner, dmg_delta, took_delta)` in 5 s buckets, taking for each character the
  uploader with the highest cumulative value, and ends `order by 1, 2`. It finds
  snapshots by `lower(boss_name) = npc_display_name(npc)` inside the encounter's
  time window ±2 min, **not by `encounter_id`**, so unbound boss snapshots feed it
  too. Defined in `supabase/migrations/20260809030000_encounter_timeline.sql`.
- **Its only caller:** `web/app/parses/[id]/page.tsx:209`, via
  **`supabaseAdmin()` (service role — bypasses RLS)**, paging with `.range(from,
  to)`. Curve rendering in `web/lib/fightCurve.ts`. `encounter_threat_snapshots` has
  RLS enabled and NO policies (only the service role reads it), so a new table
  next to it should follow the same pattern.
- **`rollup_threat_ranks(p_since_hours)`** already consolidates per-character rank
  stats into `encounter_threat_rank` (an archive table), including trash fights
  as `'(raid trash)'` per night. Trash snapshots feed nothing else, so they need no
  graph.
- **Deaths are NOT in any threat or death table** (no column named `%death%`
  anywhere). They live in **`contributions.raw_parse->'deaths'`**, one array per
  uploader: `{name, ts, class, riposteDeath, tsRaw, clockOffsetMs}`. `contributions`
  is an archive table and production never prunes it, so deaths are already
  durable. **The dedup rule exists in three mirrored places** —
  `utils/parseDeaths.js` (`dedupParseDeaths`), `web/app/parses/[id]/page.tsx`, and
  `web/lib/raidReview.ts` (`dedupEncounterDeaths`) — and a comment says any change
  to one must mirror the others. **Do not write a fourth copy in SQL.**

### ⚠ SAFETY FINDING — `thin_threat_snapshots` is an ungated deletion path

The bot's midnight block (search `index.js` for `archive_watermark_threat_snapshots`)
runs the archive-gated sweep and then, **unconditionally**:

```js
const thinned = await supabase.rpc('thin_threat_snapshots', { p_older_than_days: 7 });
```

Its definition, fetched from production:

```sql
create or replace function public.thin_threat_snapshots(p_older_than_days int default 7)
returns int language sql security definer set search_path = public as $$
  with ranked as (
    select ctid, row_number() over (
      partition by guild_id, uploader, boss_name, date_trunc('minute', snapshot_at)
      order by snapshot_at) as rn
    from encounter_threat_snapshots
    where snapshot_at < now() - make_interval(days => p_older_than_days)
  ), del as (
    delete from encounter_threat_snapshots
    where ctid in (select ranked.ctid from ranked where ranked.rn > 1)
    returning 1)
  select coalesce(count(*), 0)::int from del;
$$;
```

That deletes about two-thirds of every snapshot older than **7 days**, with **no
archive gate**. It breaks the guild lead's rule three ways:

1. It deletes data before Tower has it.
2. The per-fight graph is built from these rows at 5 s resolution. Thinned to one
   per minute before the graph is built, every graph older than a week comes out
   coarse.
3. **It may be dormant only because it fails the same way the sweep did** (no usable
   index, 10 s client abort). **Creating the `snapshot_at` index could switch it on.**

**Evidence it is dormant today:** merging the 09-11 and 09-17 dumps into Tower added
**zero** threat rows (`rows_before = rows_after = 1,201,796` both times). If thinning
had been deleting, those older dumps would have carried rows the 09-23 dump lacked.
**Confirm before relying on it** (read-only):

```sql
select date_trunc('day', snapshot_at)::date as day,
       count(*) as rows,
       count(distinct (uploader, coalesce(boss_name,''), date_trunc('minute', snapshot_at))) as uploader_minutes
  from encounter_threat_snapshots
 where snapshot_at > now() - interval '16 days'
 group by 1 order by 1;
```

If `rows / uploader_minutes` is about 1 for days older than 7 and about 3 for newer
days, thinning works and has been deleting ungated since 2026-07-09. If the ratio is
the same on both sides, it is dormant.

**✅ Run 2026-09-23: DORMANT.** 09-07 → 09-15 (older than 7 days) measured
3.78–4.77 rows per uploader-minute; 09-16 → 09-23 measured 3.67–4.78. That is the
same on both sides, so nothing has been thinned and full-resolution snapshots are
intact. The hazard stands exactly as described: the `snapshot_at` index could wake
it up, so gate it first.

**Recommended fix — the guild lead's call.** Gate thinning exactly like the sweep:
skip unless the archive watermark (and, once built, the graph watermark) covers the
rows. The alternative is removing thinning entirely, since once graphs exist the
30-day sweep makes it redundant. Gating is the conservative reading of their rule;
removal is a behavior change, so ask first. **Either way, do it before creating the
index.**

### Proposed design for the graph (NOT built — validate before building)

**A. Table `public.encounter_threat_graph`** — one row per encounter:

```
encounter_id  uuid primary key references encounters(id)
guild_id      text not null default 'wolfpack'
npc_name      text
started_at    timestamptz, ended_at timestamptz
step_sec      int not null default 5
rows          jsonb not null   -- [[t_sec, char_name, pet_owner, dmg_delta, took_delta], …] in (t_sec, char_name) order
deaths        jsonb not null   -- array of per-uploader RAW death arrays, i.e. the exact input of dedupEncounterDeaths
source_snapshots int, built_at timestamptz default now()
```

RLS enabled with no policies, matching the snapshots table (the reader is the
service role). Deaths are stored RAW per uploader, so readers apply the canonical JS
dedup and SQL never gets a fourth copy of it. `t_sec` for a death is `(ts −
started_at)` at read time.

**B. Rename the current `encounter_timeline` body to `encounter_timeline_live`**,
unchanged, and make `encounter_timeline` a plpgsql wrapper:

```sql
begin
  return query select * from public.encounter_timeline_live(p_encounter_id, p_step_sec);
  if found then return; end if;
  return query
    select (r->>0)::int, r->>1, nullif(r->>2,''), (r->>3)::bigint, (r->>4)::bigint
      from public.encounter_threat_graph g,
           jsonb_array_elements(g.rows) with ordinality as x(r, n)
     where g.encounter_id = p_encounter_id and g.step_sec = p_step_sec
     order by n;
end;
```

While raw rows exist the output is byte-identical to today's; after deletion it
falls back to the stored graph. Row order is preserved for the web's `.range()`
paging.

**C. `build_encounter_threat_graphs(p_limit int, p_settle interval default '1 day')`**
— picks encounters that started before `now() − p_settle` with no graph row, oldest
first, and inserts `rows` from `encounter_timeline_live(id, 5)` and `deaths` from
`contributions.raw_parse->'deaths'`. It writes a row even when the timeline is empty
(`rows = '[]'`), so the encounter is not retried forever. The 1-day settle gives late
uploads time to land, and is well inside thinning's 7 days.

**D. The graph watermark** — `started_at` of the oldest settled encounter still
lacking a graph (or `now() − p_settle` if none), stored in `bot_kv` as
`threat_graph_built_through`. **The sweep cutoff becomes `min(archive watermark,
graph watermark, now − 30d)`**, and thinning takes the same gate. A snapshot at time
X belongs to a fight that started at or before X, so "every fight that started
before T has a graph" covers every snapshot before T.

**E. The backfill** — about 17,700 encounters. Run it in batches with `execute_sql`,
e.g. `select build_encounter_threat_graphs(300);` repeated, outside raid hours.
Before trusting it, **verify for a sample**: `encounter_timeline_live(id,5)` must
equal the stored rows exactly. Pick a large fight (the 3,420-snapshot one), a normal
boss, an empty trash encounter, and one with deaths.

**F. Bot changes (next bot version, on `main`):**
- Call `build_encounter_threat_graphs` in the midnight block BEFORE thinning and the
  sweep.
- Read both watermarks.
- Gate thinning.
- Make the sweep delete in bounded batches through an SQL function (`delete … where
  id in (select id … where snapshot_at < $cutoff order by snapshot_at limit
  $n)`), looped with a time budget. The first run otherwise tries about 750k rows at
  once, which needs the `snapshot_at` index — and the index only after thinning is
  gated.

**G. The migration** — idempotent, `YYYYMMDDHHMMSS_encounter_threat_graph.sql`.
Apply with `execute_sql` (allowlisted) or `apply_migration`, and **commit the
identical file**.

### Two facts that change the value of deleting — tell the guild lead

- **A DELETE does not shrink the database.** Postgres marks the space reusable; the
  file, and so the "Database size" Supabase bills, stays the same until `VACUUM
  FULL` (locks the table while it runs) or `pg_repack`. The "~890 MB reclaimed
  immediately" figure in `CLAUDE.md` and `docs/COSTS.md` really means "no growth for
  about a month". Correct both files when you touch them.
- Deleting old snapshots stops `about_stats`' snapshot count from growing (vanity
  number, `supabase/migrations/20260809040000_about_stats.sql`). Harmless, but
  someone will ask.

---

## 6. Production data changes made this session (audit trail)

| When (UTC) | Table | Change | Reversible? |
|---|---|---|---|
| 2026-09-22 | `faction_hits` | Created via `execute_sql` (migration file `20260922200000_faction_hits.sql` committed; NOT in `schema_migrations`) | yes |
| 2026-09-23 14:41 | `guild_triggers` | **Disabled** (not deleted), each with a dated note appended: `Shaman Slow landed`, `Shaman Plague Slow landed`, `Enchanter Slow landed`, `Bard Slow landed`, `Divine Intervention fired (death save)`. Each duplicated a built-in agent callout on the same log line (slow: agent ≥3.4.17; DI DOWN: ≥3.5.59; all 32 players active in 14 days run ≥3.6.38). ⚠ One real difference: the built-in slow callout is main-target only, so slows on ADDS no longer call out | yes — set `enabled = true` |
| 2026-09-23 14:50 | `guild_triggers` | Touched `updated_at` on `Divine Intervention landed`, to force the agents to refresh (the version-gate bug, fixed properly in bot 3.1.138). No other effect | n/a |
| — | `bot_kv` | **`archive_watermark_threat_snapshots` NOT set**, on purpose (§5) | — |
| — | threat / buff / chat / encounter data | **Nothing deleted by this session.** Production's own `target_observations` sweep (1-day retention since bot 3.1.136) ran 2026-09-23 04:00 UTC and took 306,570 → 11,199 rows. Tower holds them (§7) | — |

No guild-vs-guild duplicate triggers exist: 4,321 spell landing/fade lines were
matched against every enabled guild trigger, with at most one trigger per line.

---

## 7. The Tower archive — state after the catch-up

**The outage:** the nightly merge failed **17 nights in a row** (2026-09-06 →
09-22), silently. Each failure rolled back the single-statement merge and wrote no
`merge_log` row, while the wrapper's later steps printed OK. Five bugs, each hidden
behind the one before:

1. **`encounters` was never in the snapshot.** Nine production tables default their
   id to `extensions.uuid_generate_v4()`, and the restore's `--schema=public` never
   creates the `extensions` schema, so their `CREATE TABLE` failed and the merge
   skipped them. Fix: prepare `extensions` + `uuid-ossp`/`pgcrypto`/`pg_trgm` in
   the scratch DB before `pg_restore`.
2. **Alphabetical merge order** (`charm_sessions` before `encounters`). Now FK-graph
   order, with deletes in their own children-first pass.
3. **`ON CONFLICT (id)` covered one index**, and 17 of the 25 archive tables have a
   second unique index. Now update-by-PK + a bare `on conflict do nothing`.
4. **`IS NOT DISTINCT FROM` on the key joins.** It has no hashable operator, so
   every join over postgres_fdw became a Nested Loop: 224 ms vs >60 s on 200k rows.
   Now `=`. Tower had hand-fixed this on 09-06, which is likely why that night's
   merge finished at all.
5. **Generated and identity columns** broke the insert. Tower had hand-fixed both;
   the repo now carries them.

Guards added: the merge **refuses to run** when an allowlisted archive table is
missing from the snapshot, and the repo's script fails a run that writes no
`merge_log` rows.

**On Tower now:**
- `scripts/lib/archive-merge.sql` = the repo file at `119552e`, md5
  `0b2ceb1a5956abbecf6ec480027153df`.
- `scripts/refresh-local-archive.sh` = **Tower's own drifted copy**: its
  `drop … with (force)` and snapshot connection settings, plus the extensions block
  inserted 2026-09-23. It does **not** have the repo's `0bf44d8` report fix.
- Backups next to them: `archive-merge.sql.bak-20260923` (pre-fix original),
  `archive-merge.sql.handpatched-20260923`, `refresh-local-archive.sh.bak-20260923`.
- ⚠ Tower's repo directory is **not a git checkout**. Files reach it by `curl` from a
  **commit-pinned** raw URL (branch URLs are cached for minutes), checked by md5.

**Result:** 131 → **141** tables staged. About 2.72M → **3.73M** rows (estimates).
- The 09-11 and 09-17 dumps alone restored **+78.6k `buff_casts`**, covering the
  09-06 → 09-15 gap the old session had wrongly written off.
- They also restored **+78.7k `target_observations`**, the rows production swept that
  morning.
- Threat snapshots in the archive: **1,201,796**, which matches production at the
  09-23 dump.

**Still open on Tower:**
- **Nobody advances the watermark nightly.** Needs a design: Tower writes `bot_kv`
  after each successful merge (it holds a production connection string for
  `pg_dump`), or a cloud session sets it by hand.
- **Schema drift:** a table created in production after Tower's archive was built
  never reaches it. `faction_hits` is in the snapshot, but Tower has no table to
  receive it. Needs a "create missing tables from the snapshot" step.
- **Monitoring:** `wolfpack-healthcheck` (every 15 min) does not look at the merge.
  Alert when `max(merge_log.ran_at)` is older than about 26 h, or on `merge
  exit≠0`.
- Port the `0bf44d8` report fix into Tower's drifted script (four lines: set
  `RUN_START` from `extract(epoch from now())` before the merge; replace the three
  `ran_at > now() - interval '10 minutes'` with `ran_at >=
  to_timestamp($RUN_START)`).

Full step-by-step history: `docs/PATCH-tower-merge-order.md` (current procedure at the
top, older routes below), `docs/HANDOFF-tower-archive-catchup.md`, and `docs/STATUS.md`
("The merge then failed SILENTLY for 17 consecutive nights").

---

## 8. Everything else shipped this session (reference)

Earlier the same session, already on `main` (bot ≤3.1.137, web 1.7.44–1.7.46,
agent ≤3.6.53 on beta): the nav dropdown clip fix; review time-column widths;
agents page keeps two stables visible; the `0x004E138A` crash identified as a
graphics-driver reset (`docs/RUNBOOK-client-crash-triage.md`); the dgVoodoo URL in the
crash verdict; the EQ-log size warning on the Logsync tab; Target Info mana bar +
Factions tab + NPC spell identification (97.6% by `npc_spells_id` + level, 99.6%
with cast time); HP with tenths; NPC tells kept out of Discord DMs; the faction page
recency window + `faction_hits`; roster save reasons logged; `/register` creates raid
mains as `Recruit`; traders/non-raid alts kept out of OpenDKP; `target_observations`
1-day retention; the archive-gated threat sweep. All written up in
`docs/DECISIONS-2026-09-21.md` §1–§7 and the top of `docs/STATUS.md`'s work ledger.

---

## 9. Open decisions — the guild lead's, not a session's

| Decision | Options | Recommendation |
|---|---|---|
| **Thinning** (§5) | gate it on the watermarks / remove it | Gate it (conservative) — but ask, since removing it is a behavior change |
| **When deletion starts** | after graphs + backfill verified / now | After. It was their stated order |
| **Extended Target narrow header** (beta) | toggles shrink to icons below 380px (shipped) / two-row header keeping the labels | Theirs to pick; the shipped one was measured clean from 280 to 420px |
| **Settings columns** (beta) | load-time section wrap (shipped) / pure CSS columns (cheaper, but splits a section across columns) | Shipped one |
| **Roadmap release name** | plain version string (current) / a name they choose | Theirs — never name a release without them |
| **Stable cut** of the 2.6.9 line | when they ask | — |
| **Slow callouts on adds** | leave the four guild slow triggers disabled / re-enable them for adds | Ask if raiders miss them |
| **Jev compaction** | privacy call (`DECISIONS-2026-09-21.md` §6) | Not adopted; needs the vendor's retention policy, which a desktop session can read |

---

## 10. Things that bit the old session — do not repeat them

- **A comment can absorb a mutation.** A `perl` substitution without `/g` replaced
  a phrase in a new *comment* that quoted the code, so the mutation "passed".
  Target the code line, and confirm the mutated text actually changed.
- **A text assertion can guard nothing.** The old "Mute still flashes" test only
  proved a `flash()` function existed, and passed while Mute hid every alert.
  Prefer running the real function with stubbed side effects.
- **A green result from the wrong script proves nothing.** Tower ran its own old
  9-assertion self-test and printed PASS. Check the assertion count (now 20) and the
  md5.
- **Never infer that a step worked from silence.** "(0 rows)" was a report bug, not
  an empty merge. A missing `snap.encounters` in a NOTICE list was the root cause of
  a 17-night outage.
- **Fixture names in new tests:** real character names from production are DATA in
  old fixtures, but NEW fixtures use invented names (`Aldenmar`, `Brackwyn`,
  `Corvale`, `Rethlan`, `Nyssara`, `Zarrin`). The repo is public.
- **Time zones:** Tower's clock is Pacific. Dumps land about 05:05 PT (12:05 UTC),
  the nightly merge runs 05:30 PT, and production's midnight sweeps run 00:00 ET
  (04:00 UTC).
- **Dump windows:** each dump holds 7 days of `buff_casts`, and the archive only ever
  receives what some dump captured. Older dumps are recovery material — do not let
  anyone prune `/mnt/user/backups/wolfpack/wolfpack-*.dump` without asking.

---

## 11. Paste this as the new session's first message

> Read `docs/HANDOFF-2026-09-23-session.md` on branch `claude/sharp-lamport-dC0TW`
> first, all of it. Then: (1) run the §5 thinning check (read-only) and report what
> it shows; (2) land the branch on `main` per §3 if it is outside the Sun/Wed/Thu
> 19:30–00:30 ET freeze; (3) build the per-fight threat graph per §5's design — but
> gate or disable `thin_threat_snapshots` BEFORE creating any `snapshot_at` index,
> and do not delete any threat snapshots until the graphs are backfilled and
> verified. Use Edit/Write for every file change and `npm test` for tests, so you
> don't trigger permission prompts.
