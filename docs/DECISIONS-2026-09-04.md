# Decisions — 2026-09-04

## Attendance grids, round two: what a night actually is

Hitya's morning-after on the 09-03 heatmaps, verbatim: *"me is slow to load
now … load the last 60 days by default. the timeline itself only needs to be
our official raid nights and we have others included. first time kill bonuses
don't need to show up … same thing on the raid history it should just be our
raid days."* Shipped web 1.7.21.

- **`opendkp_raids.ts` is the row's CREATION day, not the raid's.** Yesterday's
  decision said the Eastern day of `ts` is the night. It is — except when an
  officer pre-creates the next raid the evening before, which is common:
  "9-2-26 Seru + Kael" is stamped Sep 1 (a Tuesday), "8-23-26 Vex Thal" Aug 22
  (a Saturday), "05/13/2026 - VT 1" May 12, "7-23-26 Seru + Misc" Jul 22. Every
  raid on a non-raid-day row in the last 400 days was one of these or a bonus
  row. **The date the officer typed into the name is the night.**
  `raidNightKey` parses the four shapes seen (YYYY-MM-DD, M-D-YY, MM/DD/YYYY,
  M/D) and trusts the result within **3 days** of the stamp; a typo'd year
  ("1-14-25" on a 2026 raid) falls back to the stamp rather than teleporting a
  night into last year.
- **Bonus rows are not nights.** First Time Kill Bonus, Sign Up Bonus,
  Thanksgiving Bonus DKP, the DKP Market — name-matched on "Bonus" / "DKP
  Market". Their ticks are boss names rather than "Tick N", but the name is the
  officer's own label and it has said Bonus every time. A real raid with a
  first kill IN it ("(Gozz First)") stays.
- **Rows are the guild's raid days.** `RAID_DAYS` on the web deployment,
  default `0,3,4`; `rowsFor` adds any weekday that actually carries an official
  raid, so a holiday move is drawn rather than hidden. Three rows instead of
  seven — the grid is a third the height and the cadence is the structure.
- **`/me` reads 60 days, `/raidhistory` keeps the year.** The slow /me was the
  ask; the year-long grid on a page that already loads per-character stats was
  the cost. Same three narrow reads, a fifth of the rows.
- **Attendance is a RATE first.** "83" beside "of 151 held" read as a count —
  the wrong number to skim. Now "83%" with "125 of 151 raids" under it.
- ✅ The `.neq('attendees', '{}')` filter flagged unverified yesterday rendered
  live overnight. Closed.

## Uncurated mobs: what tracking them costs, and the gate

Hitya: *"we're still displaying all of these non-raid mobs that people are
fighting. how much is it costing us to track these and can we add a flag into
the setup to turn those off to minimize additional tracking for other guilds
that may use this."* The Saturday Aug 22 review showed **470 kills** — one
member's Ssra farm.

**Measured 2026-09-04** (auto_registered = the 587 rows the ingest path
self-registered since 2026-08-17, vs 132 curated):

| | Curated | Auto-registered |
|---|---|---|
| Encounters, all time | 1,709 | 5,937 |
| Encounters, last 30 days | 180 | **5,789 (97%)** |
| Encounters, last 7 days | 43 | 2,637 |
| `encounter_players` rows | 40,652 | 24,398 |
| `encounter_combat_rollup` rows | 41,728 | 42,392 |
| `encounter_events` rows | 37,760 | 26,458 |
| `contributions` rows | 4,576 | 8,785 |
| `encounter_threat_snapshots` rows | 80,851 | 117,707 |

At the tables' measured bytes/row that is roughly **170 MB of uncurated data
in 18 days — ~9 MB/day** — threat snapshots ~124 MB of it (they are ~1.1 KB a
row), rollups ~18 MB, events ~12 MB, contributions ~9 MB, players ~5 MB,
encounters ~3 MB. In dollars it is nothing on Pro (8 GB included, $0.125/GB
over). In *rate* it is 97% of everything the encounter pipeline writes now,
and on a Free project it would be the whole 500 MB database in under two
months. The threat-snapshot share also lands on the retention sweep that has
never worked (`DECISIONS-2026-09-01.md`).

**The gate (bot 3.1.122):**
- env `TRACK_UNCURATED_MOBS=0` — off at boot (the deployment default);
- tuning `flag_skip_uncurated_mobs=1` in `/admin/overlays` → Kill switches —
  off live, ~60s, checked = off (matches the shed-flag polarity the UI already
  has: checked = 1, unchecked = key omitted = env default).
- Off means: `_resolveBossForPersist` stops self-registering, and returns a
  distinguishable `{ gated: 'uncurated' }` for already auto-registered rows so
  the call site logs once per mob instead of warning per upload. Curated bosses
  persist exactly as before; the review's "Trash cleared" tally runs off the
  upload stream and is untouched; `_promoteLockoutBoss` still curates a row the
  server hands a loot lockout for, and it persists from then on.
- **Left ON for us.** First kills in new content are why open collection
  exists (the 2026-08-16 Final Arbiter miss). Whether to flip it is Hitya's
  call — the number to weigh is 9 MB/day against 8 GB.

**Display:** both `/raid/review` pages now filter to `curatedNpcIds` in the
query, exactly as `/parses` has since 3.1.52. A night that was only farming no
longer appears in the review index at all.

## Round three (afternoon): six more, from the screenshots

- **Leaderboard inflation cannot be repaired in the data.** The doubling was the
  old merge rule — max damage per player across uploaders, one over-counting
  parser winning every row — replaced by the median on 2026-07-14. Every
  pre-cutover multi-uploader encounter (427 of 427) has had its raw parses
  pruned, so `merge_encounter_players` has nothing to rebuild from. Policy on
  `/leaderboards`: curated bosses only, fights over 45 minutes out (one
  3.1.45-era parser reported 67-, 105- and 127-minute "fights"), pre-cutover
  rows hidden unless `?legacy=1`, which shows them with a warning.
- **"Last seen" is any stream, not the encounter stream.** Hitya's own row read
  "29m ago" with Mimic running, because faction, inventory, quarmy and chat had
  all uploaded within the last two minutes and the banner only looked at
  encounters. One paged read of `agent_upload_stats` for the family now feeds
  both "last seen" and "last fight".
- **The week×weekday grid is gone, same day it was reduced to three rows.** At
  12px a cell cannot carry a date, and three rows in a wide panel read as a
  strip. Month blocks of 44px chips (weekday, day, raider count) tile
  four-across on desktop and stack on a phone with one markup. `RAID_DAYS`
  went with the grid — it only ever chose which rows to draw.
- **The raid NAME is the record for 2024.** For a 2024 night Supabase holds
  OpenDKP ticks (who came), loot, and the raid's name ("9-8-24
  Trak/VS/Faydedar/Hate") — and nothing else: no encounters, `bot_boards` keeps
  only the latest kill per boss, no guild chat that night. So the review index
  lists every OpenDKP night and a night's page opens with the raid name, the
  raiders by class, and the zone from `raid_nights` (2025+). "Bosses killed"
  for those nights is the officer's own name for the raid; the page says so.
- **Mechanics group by fight; the victim is inferred.** `encounter_events` fire
  rows carry `actor: null` — the agent relays the trigger name, not the line.
  The review names deaths from 2s before to 8s after a fire beside it, which is
  the answer for a Death Touch and context for anything else. Recording the
  target at ingest is the proper fix and is an agent+bot change (open table).

## UI ships as options, previewed on beta (a standing rule from tonight)

Hitya, after three UI changes landed on production in one day with no
alternatives offered: *"When a request involves UI, don't give me one design.
Give me two or three genuinely different approaches to choose from … deploy
each variant as its own preview and give me URLs to compare … Never touch
production or promote a variant without asking me first."* Now a working rule
in `CLAUDE.md` (with the platform-specific mechanics: `?v=` variants on `beta`,
read at `b.wolfpack.quest`, because member pages cannot sign in on any other
preview host). Cost is broken out four ways — build, maintenance, runtime,
change — never collapsed into "harder".

Applied retroactively to the one design decided unilaterally today, the
attendance layout: the month blocks stay on production as the baseline, and
two genuinely different alternatives go up on beta for a side-by-side.

**Picked the same evening (Hitya): "I like blocks and strips, let's keep both
as options, default to strips."** So both ship as a member-facing switch on
`/me` and `/raidhistory` (web 1.7.23), strips by default, the choice kept in a
`wp_raid_layout` cookie the way the timezone picker keeps `wp_tz`, with
`?layout=` for a shared link. The mini-calendar variant is deleted, not
parked — a variant nobody chose is dead code. Graduated beta → main by
cherry-pick; the `?v=` preview switcher is gone from both branches.

⚠ **The graduation shipped in two pushes, and the first was wrong twice
over.** `git cherry-pick -q` is not a flag, so the chain failed silently and
the gate ran green against main's OLD web tree; web 1.7.23 went out as docs +
roadmap claiming a switch the code did not contain. Worse, the mutation helper
(`cp file bak; sed; cp bak file`) hit a file that did not exist on main, and
its `cp bak file` restored the PREVIOUS mutation's backup — the review index
page — into `web/lib/raidLayout.ts`, which `git add -A` then committed. Caught
within minutes; the real code landed as **web 1.7.24**. Two rules: a
cherry-pick step gets its own `|| exit`, and a mutation helper must refuse a
missing target and use a per-call backup name. Green tests on the wrong tree
are the same trap as green tests on a SyntaxError slice.

## Tower, written down as one picture

Hitya: *"can you give me an MD about coolify and supabase backups on tower."*
`docs/TOWER-coolify-and-supabase-backups.md` — the overview on top of the two
2026-08-11 runbooks: what runs on the box and why, the backup's parts and the
reason for each, the archive merge, the Coolify VM, three restore cases, a
five-minute health check, and the open list. Two things it surfaces that the
runbooks did not:

- **The backup is an egress cost.** Table data is 1,162 MB of the 1,833 MB
  hosted database (indexes are the rest and are not dumped), so each nightly
  pull is ~1.1 GB — ~33 GB a month, ~13% of Pro's allowance. 754 MB of that is
  `encounter_threat_snapshots`, the table whose sweep has never run. Fixing the
  sweep shrinks the database, the wire and the dump in one move; a lean nightly
  is the fallback lever, recorded not implemented.
- **What is verified and what is not.** The dump, the restore, the stack and
  the local site were all proven 2026-08-11. The two User Scripts schedules,
  the corrected backup copy, local Discord sign-in, and the auto-deploy timer
  were committed ready but no session has confirmed them on the box. The check
  in §6 answers each in one command.

## Open — read this first

| Item | State |
|---|---|
| ✅ **Attendance layout picked** | Strips (default) + blocks as a member switch, web 1.7.24 (1.7.23 was the docs without the code). Calendars dropped |
| ⚠ **Tower: are the 05:00 backup and 05:30 merge actually scheduled?** | Unconfirmed since 2026-08-11. `TOWER-coolify-and-supabase-backups.md` §6 — five commands on the box |
| **Flip `flag_skip_uncurated_mobs`?** | Hitya's call. ON today; 97% of encounter writes, ~9 MB/day. `docs/DECISIONS-2026-09-04.md` |
| ⚠ **Is /me fast enough now?** | The attendance reads dropped to 60 days and the heartbeat read went from N queries to one paged read; the page was not timed before or after. If still slow, the next suspect is the per-character stats fan-out |
| **Record the Death Touch VICTIM at ingest** | `encounter_events` fire rows have `actor: null`; the review infers it from deaths within 8s. The agent's trigger relay would need to carry the captured target and the bot store it — agent + bot change |
| ✅ **Zeal PR #229 — MERGED** | Waiting on a tagged Zeal RELEASE, then on raiders updating. Everything our side is shipped and inert until a client sends an id |
| ⚠ **The issue #218 comment, still unposted** | `docs/upstream/zeal-spawn-id/issue-218-comment.md`; drop its stale "no Windows/MSVC setup" paragraph first |
| **`mob-info` is still name-keyed** | ✅ `target-casts` joined `target-buffs` on spawn-id-first keying (bot 3.1.113 · agent 3.6.24). `mob-info` is the last of the three |
| ⚠ **The Buffs tab has never been LOOKED at** | It ships in Mimic 2.6.4 and its logic is tested, but no session has seen it render. First raider to open it is the first visual check |
| **The API request to Moncs** | Still unsent |
| **Two local OpenDKP fixes, recommended before sending** | Gate the roster walk on a `Character Created/Updated` audit signal; make `dkpTick._resolveCharacterIds` read `characters.opendkp_id` |
| **`_logStandingsShapeOnce`** | Prints on the next raid-window standings refresh — resolves the DKP field-name question |
| **Autobid button** | Deliberately NOT shipped; needs a ceiling column that does not exist |
| **`bump_agent_upload_stat` has three overloads** | Nothing broken; drop the two stale ones once the fleet is on bot ≥3.1.107 |
| **The weekly OpenDKP sweep is TEMPORARY** | Revert to `OPENDKP_LIST_FULL_SWEEP_DAYS=0,3,4` when OpenDKP ships `since` |
| 🔴 **`encounter_threat_snapshots` retention has never run** | 946 MB, 897k rows. Needs an index + a batched delete. Destructive — awaiting a go-ahead |
| ⚠ **Supabase Spend Cap + current egress** | Both dashboard-only, both unread |
| ✅ **Tag channel autojoin file-write** | Shipped (agent 3.6.34). Still needs `TAG_CHANNEL_SPEC` / `OFFICER_CHANNEL_SPEC` set on Railway or in `/admin/overlays` |
| **Silverwing encounter d78bcea4 (2025-03-21)** | Players wiped by the old merge RPC; restore via the Parses Log `/restore` is Hitya's call |

_Carried forward from `DECISIONS-2026-09-03.md`._
