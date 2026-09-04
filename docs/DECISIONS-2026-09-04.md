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

## Open — read this first

| Item | State |
|---|---|
| **Flip `flag_skip_uncurated_mobs`?** | Hitya's call. ON today; 97% of encounter writes, ~9 MB/day. `docs/DECISIONS-2026-09-04.md` |
| ⚠ **Is /me fast enough now?** | The attendance reads dropped to 60 days; the page was not timed before or after. If still slow, the next suspect is the per-character stats fan-out, not attendance |
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
