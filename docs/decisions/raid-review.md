# Parses & raid review

Encounters, meters, threat, kills and wipes, raid nights and sessions, attendance. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-07/2 — Attendance
*2026-08-07 · DECISIONS-2026-08-07.md · Attendance measured against attendable ticks only*

**RA is measured against ticks the member could have attended.** The denominator
is now per-family, floored at that family's first tick, for every window —
`GREATEST(window_start, first_attended)`, the same rule OpenDKP applies.
Previously every member was measured against all 1,492 guild ticks ever, so
everyone who joined after the guild started was under-reported, worst for the
newest people. a member went 64% → 100%, which matches ground truth: he has never
missed a tick.
→ migration `20260808030000_attendance_denominator_member_floor.sql`.

**Roster counts: two different questions, both right.** The leader's sheet
filters to ≥50% RA over 30 days (41 people); ours counts every raiding rank
(64). Neither is wrong — ours is not the recruiting number. a member and a member
sit at exactly 50%, which is where 41-vs-42 comes from.

## 2026-08-13/2 — Attendance has two sources, and the ephemeral one is the one that answers questions
*2026-08-13 · DECISIONS-2026-08-13.md · Attendance from signups as well as ticks*

**The correction (guild lead, 2026-08-13):** asked to break out which raiders can only
make one or two nights and who joins late, the first pass answered entirely from
`opendkp_ticks` — who turned up. The guild lead pointed out that the attendance piece is
exposed by **Raid-Helper, whose contents only last until the day of the raid**.

**Why that reframes it.** Ticks measure behaviour; Raid-Helper measures *intent*.
The first pass explicitly caveated that it "measures showing up, not availability"
and that separating "can't make Wednesdays" from "chooses not to" was a
conversation rather than a query. That was wrong — the data exists, in
`rh_signups`, with `absence` / `tentative` / `late` / `bench` statuses, and it
settles both questions:

- **One raider marked 19 of 19 Wednesdays `tentative`**, while signing in on
  18/19 Sundays and 19/19 Thursdays. Zero accepts, zero absences on that night.
  The inferred "blocked Wednesday" (p<0.0001 off the ticks) was their own
  declared, unbroken, four-month standing conditional. Nobody had aggregated it.
- **The late question improves into "who warns you".** a member declares `late` 18
  times against 14 actual late arrivals — the most-late raider is also the most
  reliable signaller. a member declares 0 across 55 firm sign-ins and is late 47%
  of nights; same shape for a member (0 / 40%) and a member (0 / 37%). The
  actionable ask is not "be on time", it is "click late".

**We already capture it — and that capture is load-bearing.**
`utils/raidhelperApi.js` has been mirroring the board every 30 min since
2024-08: 292 events, 14,741 signups, no gaps against the DKP raid list.
**Because the upstream expires, the mirror is the archive, not a cache** — a sync
outage loses that window permanently rather than delaying it. Nothing monitors
the sync today; a silent failure looks exactly like a quiet signup board. That
is now the top open item below.

**Docs failure worth recording.** `HOW-ITS-BUILT.md` still claimed the mirror
"is empty as of 2026-07-31, so this path is unverified in prod." It had been
live for weeks. That single stale line is what made the first pass ship a
"we can't know that" caveat about data we had two years of — precisely the
failure mode the "answer from the index, not one grep" rule exists to prevent,
except here the index itself was wrong. Corrected in place with a ⚠ marker
naming the cost, plus a real feature entry for the archive.

**Method note for re-runs.** Raw per-night counts mislead: at 72 people × 3
nights, a raider attending 40% of raids looks "light on Thursday" a third of the
time by chance. Test each night against that person's *own* overall rate
(hypergeometric, one-tailed) and only six of 72 survive. Two other traps that
bit this analysis: six `opendkp_ticks` rows are named with raw filenames
(`RaidTick-*.txt`) plus one "Sign up Bonus" and so carry no tick position —
filter on `description ~ '^Tick [1-4] '` and require all four; and a raider who
*stopped* reads identically to one with a night constraint over a 120-day window,
which is how a member got flagged "light on Sunday" when he had actually attended
2 of the last 25 raids.

## 2026-08-14/15 — 2026-08-16 raid night — 3-tick short raids until PoP (the guild lead, live mid-raid)
*2026-08-14 · DECISIONS-2026-08-14.md · Short three-tick raids until Planes of Power*

**The call:** *"tonight's raid should only be 3 ticks, new change. two types
of raids are going to be 3 ticks, 2 hours. alt raids and Seru+misc nights,
until planes of power."*

**Where it lands.** Mostly OpenDKP operations (officers award 3 ticks), not
code: the platform's tick math is count-agnostic — roster RA is distinct
ticks attended ÷ total valid ticks, and nothing assumes 4 per night. Updated
the CLAUDE.md raid-schedule policy line. Checked and deliberately NOT
changed: the 19:30→00:30 ET deploy freeze (short raids can spill; shortening
it is a separate call for the guild lead), `utils/timezone.js` RAID_WINDOW
(20:30–23:30, cosmetic consumers), `utils/raidNight.js` night bucketing
(day-keyed, unaffected).

**Same night, for the record:**
- **Pre-raid Zlandicar for ST keys** (killed 20:08 ET, 187s, encounter
  `719dff28`) — and the **Caustic Mist dance trigger fired 3× on it** via
  the documented shared line (Zlandicar's Putrefy Flesh prints the same
  "…flesh begins to liquefy."). Predicted in the trigger's notes; now
  observed. Open call: leave it (rare fight, 3 callouts of noise) or find a
  scoping mechanism — the LINE cannot distinguish the two spells, so a
  text-level fix does not exist; deferred to the guild lead, NOT a mid-raid edit.
- **The Tunare kite FAILED — no kill.** As of ~20:35 ET no Tunare encounter
  row exists at all. Post-raid: check what (if anything) recorded once
  agents flush, and classify any wipe engagement so it stays out of kill
  counts.

## 2026-08-14/5 — A character swap ends when they log back in — and POSITION is what proves it
*2026-08-14 · DECISIONS-2026-08-14.md · Character swap ends on logging back in*

**The report (the guild lead, live).** */raid* showed **a member** under "Not seen /
offline — *(swapped to a member)*", 2h ago, and Group 2 rendered "5 chars"
without her. In game she was right there in Group 2 with a full health bar.
The roster entry and the game disagreed because a second raider was playing
that cleric at the time — a routine hand-off the roster had no way to see.

**Everything upstream was correct.** Earlier in the night a member really did
play her toon on his client, and the same-pid detector in `apps/mimic/main.js`
stamped a legitimate swap at **00:12:40**. The defect is that nothing ever ends
a swap: `swapFor` honoured the marker for a flat six hours, and a marked
character has `raidGroup` nulled and `inRaid:false`, which files them under
"Not seen / offline".

**Measured at 02:59, from `raid_roster`:**

| | group | loc | sampled |
|---|---|---|---|
| a member | 2 | 109.13, −1705.99 → 109.14, −1705.95 (moving) | 0.3s ago |
| a member | 8 | −392, −567 | 0.3s ago |

Two bodies, two groups, two positions, same instant, both moving. **One client
cannot do that**, so the swap was over hours earlier.

**The discriminator is POSITION, not presence** — and getting that right is the
whole decision. Presence in the raid window proves nothing: EQ keeps listing
people who camped, which is exactly *why* the swap marker was needed. But Zeal's
raid stream reads loc off a live `Entity*`, so **only someone actually in the
zone has one** — a camped body has none. A position stamped after `swapped_at`
(plus a 30s grace, since snapshots arrive ~1/sec and one can land from just
before the swap) means they logged back in. HP counts too; it is entity-derived
the same way.

Note the asymmetry that makes this safe: *presence* of loc proves life, *absence*
proves nothing (an online raider in another zone has no entity here either). The
rule only ever CLEARS a swap on positive evidence, never sets one.

Web 1.1.51, `web/app/raid/page.tsx`. Tests: `test/raid-swap-return.test.js` — 15
cases, including the ones that must NOT clear it.

## 2026-08-14/6 — Live combined damage comes off the in-fight view
*2026-08-14 · DECISIONS-2026-08-14.md · Remove live combined damage; add history tab*

**The call (the guild lead).** *"Instead of displaying the combined damage during the
fight, perhaps we just have the overlay give the last few mobs in a history tab
that can be opened up once it's properly deduped — the overcount from time skew
and whatnot is too much to account for in a live stat review and it is
legitimately doubling damage."*

Bot 3.1.44's corroboration estimator got the headline numbers right (a member
99,979 vs his own 100k; the guild lead, a member and a member all within ~1%), but
corroboration is a settling process and mid-fight it has not settled. The
decision is about **when** a number is shown, not whether the estimator works:
combined damage becomes a post-fight artifact, and the live view stays on what
this client observed itself. Task #38.

## 2026-08-20/10 — /parses: raid kills split from everything else (the guild lead, mid-raid)
*2026-08-20 · DECISIONS-2026-08-20.md · Parses split raid kills from other kills*

**The call.** *"separate raid kills from no raid kills"*, then the spec when the
first cut showed three zones: *"tonight is Seru and VT trash, so it should just
be two zones."*

**Two conditions, because one wasn't enough.** `encounters.raid_night_id` (the
bot stamps it during a raid night, and through the post-midnight spillover) is
the right anchor — better than deriving a 20:30-23:30 window, which mis-bins
every short night, and the Seru/alt nights run 3 ticks until PoP. But the night
tag is TIME-based, so it also caught `a_ferocious_wolf` in The Dawnshroud Peaks
— 54 damage, one player, someone clearing a path to Vex Thal — and reported it
as a third raid zone. A kill is the raid's only if **enough of the raid was on
it**: a quarter of that night's peak participation, floor of a full group. The
bar is RELATIVE so it calibrates to the raid's size instead of hard-coding
ours, which the self-host wizard inherits.

**Evidence.** Every genuine raid kill that night had 10-31 players; across
August 37 raid-night-tagged encounters have ≤5 players and 198 have ≥7. Verified
against the night: Sanctus Seru 12 + Vex Thal 3 as raid, wolf out. Web 1.1.85.

**Known, not fixed:** day bucketing still uses `started_at` in ET, so a raid
running past midnight puts its late kills on the next calendar day even though
`raid_night_id` knows better. Raised with the guild lead; unanswered.

## 2026-08-20/2 — /parses: collection is open, DISPLAY is curated (Guild lead: "not the right parses for nonbosses")
*2026-08-20 · DECISIONS-2026-08-20.md · Parses page shows curated bosses only*

**The call.** Bot 3.1.52's self-registration (first kills are sacred) turned
out to have removed the page's only boss filter — one overnight farm session
put 336 trash cards on /parses and ate the 250-row query window. Collection
stays open; display gets its own axis: `bosses_local.auto_registered`
(migration, backfilled for the 188 rows since 3.1.52). Cards = curated rows
only; everything else rolls up to one 🗡 line per zone per night
(`parses_offcard_rollup` RPC, zone derived from npc_id = zone_id*1000+n — the
page finally says Ssraeshza Temple instead of "Unknown zone").

**Where it landed.** Web **1.1.77** + bot **3.1.60**, two migrations (applied
via MCP 2026-08-20 ~02:1x UTC, identical files committed).

**Post-deploy leak + cleanup (the guild lead, Thu morning: "Still seeing a bunch of
trash").** The backfill ran at 02:13 UTC but the flag-stamping bot only
deployed at 13:46 UTC — for those ~11.5 hours the OLD bot kept self-registering
first-seen mobs with the column DEFAULT (false = curated), so last night's
Sebilis frogloks/myconids and Thursday's farm (34 rows, 03:23–13:32 UTC) came
through as cards. Flipped by hand at ~14:10 UTC with the exact gap-window
predicate; verified the 2-day card query then returned only the 11 real raid
bosses. Lesson: **a default-valued backfill has a race against the still-running
old writer — re-run the backfill after the writer deploys, or write the
migration idempotently enough to re-apply.** Open-world farm nameds caught in
the sweep (Tolapumj, Prophet Grikplag, Centurion Regorator, Legionnaire Rukos)
stay off-card by the lockout rule; any that ever appears in a lockout/bosskill
relay self-promotes.

## 2026-08-20/4 — /announce for a future event DEFERS its parse session (Guild lead: "it hasn't happened yet!")
*2026-08-20 · DECISIONS-2026-08-20.md · Announcing future event defers parse session*

**The call.** The All-Night Leaderboard appeared at 12:21 AM in the "Sanctus
Seru — Thu, Aug 20, 10:30 PM EDT" thread, full of overnight FARM kills.
`/announce` auto-opened the parse session at ANNOUNCE time whenever none was
active — and the event was announced just after midnight, right after the
midnight chain cleared Wednesday's session, so tomorrow-night's thread became
"tonight's session home" for every agent upload. Bot **3.1.62**: announce
opens the session only when the event starts ≤2h out; further-out announces
park `pending_parse_session` in `bot_kv` (NOT state.json — deploys wipe it)
and the spawn checker opens it 30 min before start. /adjusttime + /adjustdate
move it, cancel clears it, an officer /raidnight supersedes it, start+6h
drops it unopened.

**One-off for tonight (2026-08-20 10:30 PM).** The event was announced BEFORE
3.1.62, so no pending record exists, and the deploy wipes the polluted
session. An officer should run `/raidnight here` in the event thread at raid
time (or re-announce ≤2h out, which now opens immediately). Also: the stale
All-Night Leaderboard message from 12:21 AM in that thread is farm data —
delete it by hand.

## 2026-09-03/1 — Raid attendance heatmaps: what a night is, and what "full" means
*2026-09-03 · DECISIONS-2026-09-03.md · Attendance heatmaps: what a night is*

The guild lead asked for a GitHub-style attendance grid on `/me` and a guild-wide
`/raidhistory` page coloured "red at half raiders to green full raiders, orange
middle of the way." Shipped web 1.7.19. The calls that had to be made, and why:

- **The reality signal is the OpenDKP tick mirror** (`opendkp_raids` +
  `opendkp_ticks`), the same one `/admin/attendance` and `/roster` read. Not
  `raid_attendance_ticks` (capture-only), not the Raid-Helper signups (declared
  intent, not presence).
- **A night is the Eastern day of `opendkp_raids.ts`.** OpenDKP stamps `ts` at
  noon UTC on the raid's calendar date, so the Eastern day-key is the night.
  Measured: 416 raids on 389 nights; 25 nights carry two raids (e.g. "7-22-26
  SSRA" and "7-23-26 Seru + Misc" both stamped 2026-07-22). Both raids fold into
  one cell and both names show in its tooltip.
- **Attended = present in ANY of the night's ticks.** Per-night raiders is the
  DISTINCT union across every tick of every raid that night — one person on two
  characters is one raider. On `/me` the union runs across the member's whole
  character family, so an alt night counts exactly like a main night.
- **Empty-attendee ticks are sync gaps, not empty raids** (14 of 1,546), and
  they drop before anything is counted — the `/admin/attendance` rule. A raid
  row with no valid ticks is therefore not a night; it is not coloured red.
- **"Full" is the guild's own raid target: the 60-man `raid_targets` row set
  summed (60 today), edited on `/admin/attendance`.** Fallback 60 if the table
  is empty; `?full=` overrides for a what-if read. Two columns that LOOK like
  the answer and are not: `opendkp_raids.attendance` is null on 406 of 416 rows
  and `1` on the rest, and `raid_nights.raid_size_expected` is a stale 30 on all
  207 rows. Neither is read.
- **The scale is a three-stop interpolation on the platform's own tokens** —
  red (`#f85149`) up to half, orange (`#ffa657`) at three-quarters, green
  (`#56d364`) from full — not a gradient from zero. Median night is 46 of 60,
  which reads orange-going-green; the 72-raider alt nights are solid green.
- **On `/me`, gold intensity = the member's tick share** (one tick of four reads
  dimmer, still gold), and a missed night is an OUTLINE in gold, not a red
  square. Red on this platform means death or conflict; missing a Wednesday is
  neither.
- **Only Sun/Wed/Thu rows are labelled.** The guild's cadence is visible in the
  structure, and a lit Saturday stands out as the exception it is.
- **The tooltip is one `position: fixed` element in a client component.** A
  CSS-only tooltip is clipped by the horizontal scroller the grid needs on a
  phone (overflow-x clips both axes), and a native `title` cannot put the raid
  name on its own line. Every night cell is also a real link to
  `/raid/review/<date>`, so a tap on a phone still goes somewhere.
- **Reads are paged (`selectAll`), never `.limit()`ed.** `/raidhistory` pulls
  attendee arrays for the window (~150 raids × 4 ticks × ~50 names for a year —
  the one wide read, and it needs them for the distinct count). `/me` pulls
  tick IDS only, twice: held ticks and the family's ticks via
  `.overlaps('attendees', names)`.

⚠ **Not verified from this session: the `/me` loader's `.neq('attendees', '{}')`
PostgREST filter.** The REST endpoint is blocked by the cloud egress proxy
(CONNECT 403), so the ids-only "held ticks" read could not be exercised. The
SQL it should emit (`attendees <> '{}'`) was run directly and is correct. It
fails soft — no held ticks while raids exist ⇒ the section hides rather than
drawing a year of "missed" — so the symptom, if the filter is wrong, is a
MISSING section for everyone, and the fix is to fetch the arrays and filter in
JS as `/raidhistory` does.

## 2026-09-04/1 — Attendance grids, round two: what a night actually is
*2026-09-04 · DECISIONS-2026-09-04.md · Heatmap round two: official raid nights only*

The guild lead's morning-after on the 09-03 heatmaps, verbatim: *"me is slow to load
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

## 2026-09-04/2 — Uncurated mobs: what tracking them costs, and the gate
*2026-09-04 · DECISIONS-2026-09-04.md · Option to stop tracking uncurated mobs*

Guild lead: *"we're still displaying all of these non-raid mobs that people are
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
  exists (the 2026-08-16 Final Arbiter miss). Whether to flip it is the guild lead's
  call — the number to weigh is 9 MB/day against 8 GB.

**Display:** both `/raid/review` pages now filter to `curatedNpcIds` in the
query, exactly as `/parses` has since 3.1.52. A night that was only farming no
longer appears in the review index at all.

## 2026-09-04/3 — Round three (afternoon): six more, from the screenshots
*2026-09-04 · DECISIONS-2026-09-04.md · Leaderboard inflation and other afternoon fixes*

- **Leaderboard inflation cannot be repaired in the data.** The doubling was the
  old merge rule — max damage per player across uploaders, one over-counting
  parser winning every row — replaced by the median on 2026-07-14. Every
  pre-cutover multi-uploader encounter (427 of 427) has had its raw parses
  pruned, so `merge_encounter_players` has nothing to rebuild from. Policy on
  `/leaderboards`: curated bosses only, fights over 45 minutes out (one
  3.1.45-era parser reported 67-, 105- and 127-minute "fights"), pre-cutover
  rows hidden unless `?legacy=1`, which shows them with a warning.
- **"Last seen" is any stream, not the encounter stream.** the guild lead's own row read
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

## 2026-09-06/5 — Two that looked like bad data and were not (web 1.7.25)
*2026-09-06 · DECISIONS-2026-09-06.md · Damage chart drew half fight from row cap*

**The damage-over-the-fight chart drew half a fight.** `encounter_timeline()`
returns 1,846 rows for encounter `57f45a22`, totalling **1,198,871** damage
across **340s** — which is the mob's whole 1.2M health bar, so the server-side
curve was exactly right. The page called the RPC unpaged, PostgREST capped the
response at **1,000 rows**, and those sum to **663,568** and stop at **195s**.
The chart rendered that faithfully: "664k total" and bands ending at 3:15.

The lesson is one the repo already learned for selects and never carried over:
**the 1000-row cap applies to an RPC too, and it truncates silently.** Now paged
through `selectAll`, whose contract this fits — the function's own
`order by t_sec, char_name` makes range paging stable. Rows per bucket scale
with raid size, so this only ever bit the big fights, which is exactly why it
survived: a 20-man parse fits under the cap and looks perfect.
⚠ `db-read-discipline.test.js` ratchets `.limit(>1000)` and would never have
caught this — an unpaged `.rpc()` has no limit to notice.

**The header folded to "Menu" on hover, on desktop.** Nav renders a hovered
group's links IN FLOW inside the header row, deliberately, so they can never
cover a phone's first viewport. In flow means they count toward `scrollWidth`,
so hovering Prep (seven links) was a *real* overflow by the measurement's own
definition — and because folding to compact REMOVES the overflow, the
hysteresis that exists to stop oscillation then pinned the bar compact until
the window grew 64px wider. Hover once, lose the nav for the rest of the visit.

Fixed by marking the revealed row `data-nav-revealed` and having the fit
measurement skip while it is present: transient chrome is not a claim about
whether the bar fits. The overflow fold and its hysteresis are untouched —
this is not a blanket "never fold".

## 2026-09-10/14 — Damage shields need evidence, not adjacency (guild lead, 2026-09-13)
*2026-09-10 · DECISIONS-2026-09-10.md · Damage shields need evidence, not adjacency*

The guild lead, on the Tank overlay during Kaas Thox: *"This is misleading, i don't
think he's getting thorns damage returned, or we're not seeing it. These look
like 150 dd procs."* Confirmed in the rollup: sixteen anonymous hits of exactly
150, spread over five raiders as `ds:non-melee`, one flavor line all fight.
The agent had credited any anonymous `was hit by non-melee` on a mob to
whoever that mob connected on in the last 1.5 s — and a boss connects on the
tank every second, so nearly every proc and direct-damage spell in range
became the tank's shield.

**The call:** the swing names the only possible wearer; it never proves the
hit was a shield. A hit is a damage shield only when the log names one on
that mob within the one-second pair window (`was pierced by thorns.`), or the
tank is known to wear a DS buff and the amount fits it (+30 per hit for
worn/AA shield we cannot see — era shields return single digits to a few
dozen, so a 150 fails even with a same-second flavor line). Uncorroborated
hits fall where they always did outside the window: the parser's own column.
That column's older ambiguity (a bystander's proc looks like mine) is a
separate, known limitation — not widened, not fixed here. Overlay copy no
longer guesses "likely worn gear/AA".

Landed on `beta` as agent 3.6.41 (2.6.8-beta.6): the candidate is held out of
the fight for the pair window and re-added decided, so the live meter, the
upload rollup and the overlay tally see it once, already attributed
(`_settleDsPending`, `_knownDsPerHitFor`; `test/ds-attribution.test.js`,
mutation-checked — the "always credit" mutant fails five of eleven).
Open question the data cannot answer yet: whether bystanders see the flavor
line at all (one line for sixteen hits says it may be wearer-only). If they
do not, a tank without Mimic and without an observed DS landing shows no
shield card on anyone else's overlay — the honest direction.

## §237 — Raid night 2026-10-11: spectator HP, Bastion of Thunder slow mode, a logout crash, a freeze slip
*2026-09-21 · DECISIONS-2026-09-21.md · Raid night fixes: spectator HP, crash, slow mode*

- **Spectator HP** (the guild lead: *"Spectator keeps only showing one group's HP then showing everyone else"*).
  Measured live: 8 of 21 uploaders send HP for the whole raid, 13 only for their own group. `spectator_positions`
  read `hp_pct` off whichever row won the position, so the column flipped with the last writer. HP now comes from
  the freshest non-null reading in the same 30 s window (migration `20261012013000_spectator_positions_hp`). It is
  DB-only (restarts nothing), so it was applied through MCP mid-raid; live check 45 of 45 with HP. The file landed
  after the freeze.
- **Slow mode** (the guild lead: *"When we kill mobs in 'slowmode' it sets the spawn for those to 18 hours"*, then
  *"Just the second floor BOT named tonight, not the first floor ones"*; picked C, a switch now plus auto-detect).
  - The second-floor named are picked by spawn height in `eqemu_spawn2` (z ≈ 1,470 to 2,330): Auliffe Chaoswind,
    Brynju Thunderclap, Kuanbyr Hailstorm and Eindride Icestorm get `slowModeHours: 18`. The first floor
    (z ≈ -1,400: Gaukr, Hreidar, Laef, Oreen) keeps 3 h.
  - The switch lives in `bot_kv` (`slow_mode`) and is judged by each kill's own time. One rule at the
    `recordKill` wrapper plus the boot/6h reconcile. Officers flip it with `/slowmode`; it turns itself off after
    8 h.
  - The server's end-of-slow-mode guild line (*"Druzzil Ro tells the guild, 'A ripple passes through your guild's
    thread of time. … Time has returned to its natural pace…'"*) turns it off via `POST /api/agent/slow-mode`.
    The agent side is still to come on beta. The STARTING line has not been captured, so nothing turns it on
    automatically yet; the guild lead was asked for it.
  - Tonight's window (20:13 ET from guild chat, to 21:43:36 ET from the end line) is stored in `bot_kv`, so the
    startup rebuild gives tonight's second-floor kills (Auliffe, Brynju, Kuanbyr) their 18 h without hand edits.
    Bot 3.1.244.
- **Logout crash** (Zeal test-all `e1fde3d`, 9 s after camping): a minidump walk puts it inside the client's own
  world teardown. dpvs.dll called through a garbage pointer under `CDisplay::StopWorldDisplay`, with no Zeal frame
  on the stack. About 85% not a Zeal bug. The one Zeal path in that teardown is the nameplate font sprite swap
  (long-standing, in official Zeal too). Next step only if it recurs: a night with Zeal nameplate fonts off, and
  a richer minidump (`MiniDumpWithIndirectlyReferencedMemory`) on the test-all build if the guild lead wants it.
- **Freeze slip:** the DECISIONS 236 docs push landed on main at 21:23 ET, inside the Sunday freeze. Railway
  SKIPPED it, and Vercel builds only `web/` changes, so nothing restarted. Check the ET clock before every main
  push on a raid night; the session clock read UTC.

## §313 — DPS meter: each row's seconds are its own active time (agent 3.7.171, beta `a79291e6`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · DPS rows use each player's own active time*

- **The ask (the guild lead, 2026-10-14):** *"dps METER counts the same amount of time for everyone versus just when the person engaged.
  That makes the DPS calculation incorrect."*
- **Call:** EQLogParser-style. A row's Sec = its first damage → last damage (≥ 1 s, ≤ the fight); an owner's span covers its pets'. The
  total row, the Tank tab, old saved fights and a guild-settled player this machine saw under 80% of keep the fight's seconds (a partial
  local span would inflate DPS). Spans ride beside `perPlayer`, never inside it, so the threat-snapshot upload (58% of the database) does
  not grow. The copied `/rs` line writes each raider's own "in Ns", which the bot's `/rs` parser already reads as per-player seconds.
- **Open (needs a pick):** the Me HUD fight DPS / tonight average, the My parses ledger (saved `dur`) and the Trend view still divide by
  fight time and must move together; the bot's merged-parse DPS (`index.js` `/rs` and merge paths, `utils/killRecap.js`) also uses one
  duration for everyone.

## §335 — Raid replay: A (night scrubber) now, then C (3D walls); tonight's slides from our own flag data (web 1.8.160, 2026-10-15)
*2026-09-21 · DECISIONS-2026-09-21.md · Raid replay night scrubber then 3D walls*

- **The pick (the guild lead, 2026-10-15: *"A, then C"*):** the replay look left open in §161 is A, the night
  scrubber, shipped live as a new [beta] page `https://wolfpack.quest/spectator/replay`; C, the recording inside
  raised 3D walls from the EQEmu collision mesh (3D-A of §220), comes next and reuses the same reader. B (fight
  replays on the raid review) is not planned.
- **What last night looked like in the data:** 217 minutes, 00:00–03:41 UTC, ~210k samples, 64 characters, 12
  zones (Tranquility as the hub; Disease, Innovation, Nightmare and its lair, Valor, Halls of Honor A, Bastion of
  Thunder). The recorder's frame layout is `[dt, i,x,y,z,h,hp,zi, …]` with a per-sample zone index, so a raider in
  the Bazaar is not drawn over the raid zone. Nine of the twelve zones already had map lines cached; the rest are
  fetched on first view.
- **Slides for 2026-10-15** (Bertox, Bastion of Thunder, Halls of Honor A trials, Mithaniel Marr, Tactics) were
  written straight into `raid_screen_slides` (12 slides) from `web/lib/popGuide.ts`, `web/lib/popFlags.ts`, the
  `pop-2026-10` trigger pack and `utils/hailBoard.js`. Flag counts come from `pop_flags` for the 62 characters with
  60+ minutes in the last raid: 25 have no PoP flags recorded by Mimic, so the slides say "not seen", never
  "missing". Marr's projection cap reads 144 in the script because one hail ticks twice; it is 72 people.
- **C, first cut, on beta only (web 1.8.161 `c23af97e`):** the replay page already existed on main, so this
  iteration previews at `https://b.wolfpack.quest/spectator/replay` before graduating. A 2D/3D switch on the same
  board; one playback loop feeds both. `/api/spectator/mesh?zone=` (members only, no database) packs the EQEmu
  collision mesh as Int16 triangles in the server frame (`web/lib/zoneMesh.ts`), walls only unless `floors=1`,
  capped at 100k triangles: Bastion of Thunder 33k triangles / 602 KB, Tranquility 42k / 764 KB. three.js
  0.169.0 loads only when 3D is first shown (130 KB gzipped). Axes checked on a real Tranquility minute: raiders
  stand 2–10 units above a mesh floor with the swap, on nothing without it. Not yet seen in a browser.
- **The guild lead's first look at 3D** (*"it looks REALLY cool so far"*) asked for: follow and highlight players,
  the bosses being targeted, filled-in walls, and split screen when two zones are busy. Landed the same day:
  - **Bot 3.1.274 (main, `5a1e7228`): the recorder keeps the raid's NPC targets** — each frame takes
    `utils/raidTargets.js` `snapshot()` (the most-targeted 20 NPCs among the frame's raiders), written as optional
    `mobs` / `mf` keys in the minute row; position swapped back to the roster frame; a COUNT of targeters, never
    who. Tonight (2026-10-15) is the first night recorded with targets. `docs/PRIVACY.md` retention line updated.
  - **Web 1.8.162 (beta, `d16ad4ed` + `ef3062da`):** raider picker + tap-to-pick, highlight (others dim), Follow
    (2D centre, 3D orbit target; survives zone changes; `?follow=` / `?hl=` in the link); floors as a second,
    darker mesh layer (`/api/spectator/mesh?floors=only`, a Floors switch, default on); recorded targets drawn as
    red markers sized by how many raiders were on them; **older nights get the curated bosses at their spawn points**
    during each kill (`/api/spectator/replay/bosses`: encounters with `ended_at` and no classification, curated by
    `bosses_local.auto_registered = false`, joined `eqemu_spawnentry` → `eqemu_spawn2`). Checked on 2026-10-14's
    data: Manaetic Behemoth's spawn (1125, 0) sits where the raiders stood (1120, −2 after the swap), so spawn2 x/y
    are the server frame as used. Event-spawned bosses (Terris Thule) have no spawn point and show nothing; a
    wrong `encounters.zone_short` (Aerin`Dar filed as postorms) falls back to the NPC's real spawn zone.
    **Split screen** opens when a second zone holds ≥ 5 raiders and ≥ 25% of the busiest (stays while ≥ 3 and
    ≥ 15%, held 30 s), side by side or stacked on phones, two 3D views while split; `?split=off`.
  - Beta's suite carries four Mimic test failures that predate this (tray-menu-layout, mimic-agent-only-mode,
    mimic-destroyed-window-guard, window-process-names — red on bare `origin/beta` too).
- Open: the heading direction (unchanged from §161); whether the lower Crypt door needs each raider's Tarkil Adan
  key (the guide marks the key `check: true`).

## §420 — The guild lead's picks, 2026-10-23 (afternoon) — and where they landed
*2026-09-21 · DECISIONS-2026-09-21.md · Night slicing pick and graduation*

- **Night slicing: B, `?v=segments`** (confirm detected segments) → the session page's default, with "Start a new raid here"; the
  draw-spans variant deleted. Graduated with the window-only kills, share start/end, the end-date roll and raidmimic.com layout D +
  its 13 captures: **web 2.1.11 on main and beta** (identical files). The unflagged session cutting where the roster turns over
  (web 2.1.6's base) came along because the graduating files are built on it.
- **Shares that follow the raid: A, self-refresh** every 60 s, held while the viewer has interacted in the last 30 s or parked the
  playhead away from the end. The per-share page ceiling went 600 → 3,000 an hour, because each follower refreshes once a minute;
  the review cache is per minute-rounded window, so followers share one read.
- **Actor emails: A, sweep** → web 2.1.4; the 3 stored addresses (2 fight notes, 1 spell note) rewritten to names.
- **Wipes reading as kills: A** → bot 4.0.11: the nightly reconcile no longer stamps `ended_at` on a marked wipe or on a curated
  boss that lost under 90 % of its HP; web 2.1.5 shows such a fight as "no kill seen" after 90 min instead of ENGAGED forever.
- **Old fights: A** → `ended_at` cleared on the 651 reconcile-stamped fights on curated bosses that lost under 50 % (2024-07-16 →
  2026-10-23). Backup: bot_kv `backup:wipe_ended_at_2026-10-23` (id, old ended_at). The 50–90 % band (~330) left as is.

## §8 — The per-fight threat graph — built; deletion still waits on July (2026-09-23)
*2026-09-23 · DECISIONS-2026-09-21.md · Per-fight threat graph built; deletion waits*

The guild lead, 2026-09-22: *"per fight, consolidate the threat data into a
flattened graph, married up with the player deaths from those fights. make sure
that the data isn't removed from the on-prem database then make deletions from
the table."* Consolidate → confirm on-prem → delete.

**Consolidate — DONE (migration `20260923200000`, applied live via `execute_sql`,
file committed).** The graph already existed as a query: `encounter_timeline`
(5 s buckets, per character, damage and damage-taken deltas, best uploader per
character). It is now stored once per fight in `encounter_threat_graph`:
- `rows` holds `encounter_timeline`'s own output, in its own order.
- `deaths` holds each uploader's RAW death array from
  `contributions.raw_parse->'deaths'` — the exact input of the canonical JS
  dedup. Stored raw because that rule already lives in three mirrored places
  (`utils/parseDeaths.js`, the parse page, `web/lib/raidReview.ts`) and must not
  gain a fourth copy in SQL.
- `encounter_timeline` is now a wrapper: live while raw snapshots exist
  (unchanged output), the stored graph once they don't. The live body is
  `encounter_timeline_live`, copied verbatim from production (which carries a
  later baseline fix the original migration file lacks).

**Backfill: 16,980 fights, 508,035 rows, 2.4 MB** (against ~1.4 GB of raw
snapshots). 21 sampled fights matched live exactly, including the largest
(12,294 rows), five with deaths, and three empty ones. The stored-graph read
path returned all 4,645 rows of the biggest fight identically, in the same
positions, before the wrapper went live.

**Bot 3.1.141** builds each day's graphs at midnight before anything can delete,
and adds a second watermark, `threat_graph_built_through()`. **Both** deletion
paths now require both watermarks:
- the 30-day sweep;
- the 7-day `thin_threat_snapshots`, which had **no gate at all** until today.
  It was dormant only because it timed out on the same missing index as the
  sweep — measured 2026-09-23: rows per uploader-minute are the same either side
  of 7 days (3.78–4.77 older, 3.67–4.78 newer). Fixing that index would have
  woken an ungated deletion.

Rule tested by running it (`test/threat-delete-gates.test.js`); both gates
mutation-checked.

**⚠ Why deletion is still off — the guild lead's decision.** Graphs can only be
built for snapshots that name their fight:

| Month | Snapshots | Name the boss | No boss or target |
|---|---|---|---|
| July | 439,870 | **0** | **439,870** |
| August | 416,245 | 358,539 | 55,094 |
| September | 352,014 | 352,010 | 1 |

`encounter_timeline` matches snapshots by boss name, and **every July snapshot
has none**, so July fights show no curve today (live) and store empty graphs. The
raw July data is intact on Tower and in production. Options:
- **(a)** accept it — July's detail lives on Tower only; set the watermark and
  let deletions start;
- **(b)** attribute unnamed snapshots to a fight by time window + uploader.
  That is a new heuristic that changes what the parse page shows for July
  fights, so it needs building and checking first.

The watermark stays unset until this is decided.

**Two facts for that call, previously recorded only in the handoff:**
- **A DELETE does not shrink the database.** Postgres reuses the space; the file,
  and so the size Supabase bills, stays put until `VACUUM FULL` (locks the table
  while it runs) or `pg_repack`. The "~890 MB reclaimed immediately" figure in
  `CLAUDE.md` / `docs/COSTS.md` really means "no growth for about a month".
- **The `snapshot_at` index** (`20260923010000`) has never been applied —
  `CREATE INDEX CONCURRENTLY` cannot run inside a migration runner's transaction.
  Now that thinning is gated it is safe to create by hand with `execute_sql`
  (outside a transaction), but it only matters once deletion is switched on.

**Also still open:** nobody advances the archive watermark nightly (needs a
design — Tower writing `bot_kv` after a successful merge, or a manual step);
Tower's archive never receives tables created after it was built (e.g.
`faction_hits`, and now `encounter_threat_graph`); the Tower healthcheck ignores
the merge; and Tower's own `refresh-local-archive.sh` lacks the repo's
report-window fix (`0bf44d8`).

**`docs/HANDOFF-2026-09-23-session.md` was deleted in this change** at the guild
lead's word ("we no longer need this handoff document"). Everything durable in it
is now here, in the open table above, or in `docs/STATUS.md`.

## §46 — PvP: every death stored, grouped into fights; the alliance night in Vex Thal (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Every PvP death stored and grouped into fights*

**The guild lead**, the morning after an alliance of Dungeons and Dragons, Wolf Pack, Freedom and
one Squirrels of War fought the Zeks in Vex Thal: a full list of assists for everyone in the
alliance; the /who overlay with every Zek at their peak; the videos and clips on the PvP page; and
*"Lets start combining PVP encounters into history. 2+ deaths nearby constitutes encounters I
think."*

**What the data could and could not see that night** (read from the database; the numbers went to
the guild lead in chat):
- `pvp_kills` holds a kill only when Wolf Pack is on one side. An alliance-vs-Zek night was mostly
  missing from it.
- **Assists are only ever a Wolf Pack character's, and only when its own agent was running.**
  `_checkPvpAssist` credits the uploader's own character (or pet) for damage in the 120 s before a
  broadcast death, and the bot drops any assister not on our roster. Nobody else's assists, and
  no PvP damage totals, exist anywhere. Widening that is a design question, not a query: an agent
  can see other players' melee on a target in its own log, but not their spells.
- /who showed the Zek side at its peak at 05:46 UTC (35 of 70 in zone). Their wipe was
  06:03:37–06:05:07 UTC, 12 Zek deaths in 90 seconds.
- Death broadcasts carry no location. "Nearby" can only mean the same zone, close in time.
- Aside, not changed: the agent's `_isZekGuild` reads only "Zek", while the database's Zek checks
  read "Zek" or "Rise of Zek". One Zek player has worn both tags.

**Built (bot 3.1.152 on main, migration `20260926085942_pvp_deaths_and_fights`):**
- **`pvp_deaths`**: every death the PvP broadcast reports, any guilds, player kills and deaths to
  NPCs alike. It is written from `POST /api/agent/pvp` before the Discord post loop, so a post
  dedup or a missing channel cannot drop one. Its key is victim + minute, because two agents'
  relays of one death can differ by a second or two. Boss kills are not deaths.
- **Backfilled 30 days** (1,301 deaths). Wolf Pack kills come from `pvp_kills`. The rest is
  rebuilt from the `who_observations` rows the relay writes for each broadcast: victim row, then
  killer row, in one upsert, so the killer's id is the victim's + 1 (checked 9 of 9 against
  `pvp_assists.raw_text`). `source` says how each row was recovered. A killer the relay never
  stored (a death to an NPC) is left null.
- **`pvp_fights()`** groups deaths in two steps:
  - a **wave** is deaths in one zone each within 3 minutes of the last, with 2+ deaths and at
    least one player kill, so an NPC raid wipe is not a PvP fight;
  - a **fight** joins waves less than 20 minutes apart.
  3 minutes is where the gaps between player kills thin out. At 3 minutes alone the Vex Thal
  night was 19 pieces; with the 20-minute join it is five fights, the largest 04:49–06:05 UTC
  with 56 deaths (36 Zek). "Zek" is Zek or Rise of Zek, as the database reads it.

**On /pvp, beta only, two layouts for the guild lead to pick** (beta `fd1d7299`; with no `?v=` the
page is what production shows):
- **B, `b.wolfpack.quest/pvp?v=b`:** every fight is a card (zone, start, length, waves, deaths with
  the Zek share as a bar, deaths by guild, top killers), and a night's videos and clips open on its
  biggest fight.
- **C, `b.wolfpack.quest/pvp?v=c`:** a compact table of fights, and the film in its own gallery.
- The film lives in `web/lib/pvpMedia.ts`: two YouTube videos and four Medal clips, with our own
  captions (two of the clips' own titles are crude) and credits by role, plus a link to a member's
  channel. The guild lead's two screenshots join it when re-sent; pictures sent mid-task never
  reached the session's disk.

**Also fixed on main (web 1.8.16):** the /pvp trophy wall's caption, alt text and file names said
"boxers". Your rule is no boxing wording anywhere public, so they now say "a group", and the files
are `deeps-pit*.gif`.

**Tests:** `test/pvp-deaths.test.js` runs the row builder (player kill, death to an NPC, boss kill,
pet credit, no-guild spellings, two relays of one death) and checks the write comes before the
post loop. Five deliberate breaks, all caught.

## §54 — PvP assists: credit the guildmates our agents see, spells count, 4-minute window (2026-09-27, bot 3.1.155, agent 3.7.29 beta)
*2026-09-27 · DECISIONS-2026-09-21.md · PvP assists credit guildmates, spells, four minutes*

**The call (the guild lead):** *"credit assists to guildmates our agents see. we should also attribute
when a guild member has cast non-damage on those characters and expand the timeframe to 4 minutes..
make sure all of this can be parsed through vis opt-in-logs"*.

**Why:** two raiders had kills on the 2026-09-25 Vex Thal night but no assists. All 9 assists that night
went to the one character whose agent was running. An assist came only from the assister's OWN log (their
damage to the victim), so anyone not running Mimic could never get one, even when another raider's log
showed them on the victim.

**What counts now** (agent `EncounterBuilder`, identical in the live tail and the opt-in-log backfill):
- **Any player's hits on the victim** that the log shows. A pet's hit counts for its owner
  (`petLeaders`, the charm trackers, or a `<Owner>`s warder` name).
- **Debuffs that land on the victim**: the timed detrimental spells in the `parseDebuffLanding` index
  (slows, snares, roots, mez, Tash/Malo, DoTs). A landing never names its caster, so:
  - our own cast of that spell, begun up to 12 s before, is ours;
  - otherwise it goes to the player whose `<X> begins to cast a spell.` started closest to the spell's
    cast time before the landing. The slack is ±1.5 s, or ±35% for long casts (spell haste). Each start is
    used once, and if nobody's timing fits, nobody is credited.

  ⚠ This is a timing match, not a fact the log states. It also needs the cast-start line, which a raider
  sees only in range and with others' spell messages switched on.
- **The window is 4 minutes** (it was 2).
- **The killer never gets an assist** on their own kill. One death uses the evidence up.
- **Instant spells are not covered.** Stuns and dispels have no entry in that index, and bard songs print
  no cast-start line for anyone else.

**Guildmates only, decided by the bot.** It already drops any assister not on the `characters` roster, so
the agent reports everyone it saw and the roster decides. Alliance guilds' players are dropped there.

**One assist, many witnesses (bot 3.1.155).** Every raider running Mimic now reports the same guildmate's
assist, each stamped off their own clock a second or two apart. `dedup_key` is per second, and the /pvp
leaderboard counts rows. So the bot:
- drops a report when the same assister on the same victim is already stored within ±30 s;
- reads those neighbours one fight at a time, in clusters of up to 10 minutes;
- takes one upload at a time, so two witnesses posting together cannot both miss each other.

A failed read stores everything, and the per-second key still holds.

**Opt-in logs:** the catch-up path runs the same hook before `shouldKeep`, which would otherwise drop the
landing lines. It also uploads assists 200 per request, because one replayed log can now hold thousands and
the bot refuses a body over 256 KB.

**Re-run** on a log in the Opt-in Logs tab replays it from the start. That credits every past PvP night it
covers, including the one that started this.

**Where:**
- Agent: `PVP_ASSIST_WINDOW_MS`, `_checkPvpAssists`, `_pvpStamp`, `_pvpAssistLine`, `_pvpCasterFor`, the
  damage branch of `add()`, both line loops, and `uploadPvpAssists`.
- Bot: `_pvpUnseen`, `_pvpNeighbours` (named `_pvpAssist…` until §55 put kills through them too), and
  `_handleAgentPvpAssists`.
- Tests:
  - `test/pvp-guildmate-assists.test.js`: 18 tests, 17 of 17 mutants killed.
  - `test/pvp-assist-witness-dedupe.test.js`: 7 tests, 7 of 7 mutants killed.

## §55 — An opt-in log parse posts ONE PvP note, never one per old event (2026-09-27, bot 3.1.156, agent 3.7.30 beta)
*2026-09-27 · DECISIONS-2026-09-21.md · Old-log parse posts one PvP note*

**The call (the guild lead):** *"when parsing through old logs make sure we're not posting in the channels
for it each time. we can put in a note in pvp that the @user's opt-in log parse found N new pvp kills and
assists and total them out per guildie"*.

**Audit: what a replayed log could post.** Every upload the opt-in backfill makes was checked against
what the bot sends to Discord.
- **Already silent:**
  - PvP kills: the relay post and the boss auto-timer both skip `backfill`.
  - Fight cards, session damage and boss timers: `isBackfill`.
  - Deathrolls: rolls are captured live only, and the bot never announces a game older than 10 minutes.
  - Fun events, faction, PoP flags, buff/debuff sightings and chat: none of their handlers post.
- **One was not:** the assist handler posted a "🪶 Assist on <victim>" note for every assist group,
  replayed or not — its header said it didn't. With §54 (guildmates count, Re-run replays a whole log),
  one Re-run would have posted every PvP assist in the log. It now posts only rows stored just now that
  came from live play. The post dedupe is "same victim ±30 s" (it was the exact second), so several
  witnesses of one live kill make one note.

**The note:**
- When a run ends, meaning every file finished or paused, the agent flushes its buffered assists.
- It then queues `POST /api/agent/optin_summary { started_at }` as backfill, so it drains behind the
  run's own uploads.
- 90 s later the bot counts what that uploader's replay inserted since the run began:
  - `pvp_kills` with source `log_backfill` and a Wolf Pack killer;
  - `pvp_assists` with source `log_backfill`.
- It posts once to `PVP_THREAD_ID`/`PVP_CHANNEL_ID`: "📜 @you's opt-in log parse found **N new PvP
  kills** and **M new assists** (first – last date)", then one line per guildmate, busiest first, capped
  at 30 lines.
- The mention reaches only the uploader.
- Nothing new means no note, and a failed read also means no note (never a wrong count).
- A /who-only rescan and a dry run send nothing.

**Replayed kills no longer double.** Measured the same night: **23 duplicate pairs in 611 `pvp_kills`
rows, every one from a log catch-up**. Each is 1–4 s off a row another raider's Mimic had stored,
because `dedup_key` is per second on each machine's own clock. Replayed kills now go through the same
±30 s check as assists (§54).
- The helpers were renamed `_pvpUnseen` / `_pvpNeighbours` and take the name column.
- Live kills are unchanged: `_isPvpDupe` already covers them.

The 23 existing pairs are left in place. Deleting them is the guild lead's call.

**Caught before shipping:** the kill check referenced `guildId`, which in the relay handler lives inside
the per-broadcast loop.
- At runtime that would have thrown inside the persist `try`, and every PvP kill would have silently
  failed to store.
- Lint (`no-undef`) caught it.
- A test now runs the real persist block against a stub database, and fails with the fix removed.

**Where:**
- Bot: `_handleAgentOptinSummary`, `_postOptinPvpSummary`, `_optinPvpSummaryText`, the assist post
  filter, `_recentPvpAssistPost`, and the pvp_kills persist block.
- Agent: `runOptinBackfill` (`runJobs`, `runStartedAt`) and the `optin_summary` upload route.
- Tests:
  - `test/optin-pvp-summary.test.js`: 11 tests.
  - `test/pvp-assist-witness-dedupe.test.js`: 12 tests.
  - `test/optin-run-summary.test.js`: 5 tests.
  - 21 of 21 mutants killed, plus the scope bug itself.

## §117 — Zeal 1.4.8; threat meter for the non-tanks; no more identical backups (2026-10-01)
*2026-10-01 · DECISIONS-2026-09-21.md · Threat meter for non-tanks, Zeal 1.4.8*

**Threat meter, your own meter (agent 3.7.57, beta `2fe18e75`).** The guild lead: *"A for now, B later.
It's for the non-tanks primarily that don't want to get hit."* Values are each spell's own hate effect (SPA 92)
in `eqemu_spells`; the behaviour was checked in the server source (EQMacEmu `aggro.cpp`, `spells.cpp`,
`zoning.cpp`).
- Added: Concussion −400, Ancient: Greater Concussion −600 (there is no plain "Ancient: Concussion").
  Corrected: Jolt −400 → −500, Cinder Jolt −570 → −500.
- Removed: Voice of Quellious (−2500), an enchanter mana buff with no hate effect, so every cast dropped
  the enchanter's own meter; Voice of Thule (flat +3000), which is a 12% hate multiplier (SPA 114), not a flat
  amount. Left in, and flagged: Quivering Veil of Xarn (−2000) has no hate effect in our mirror either.
- A resisted spell still applies its own hate on the server, so a resisted Concussion keeps its −400 and no
  longer also gets the generic +120. A fizzle or an interrupt applies nothing: the amount is stamped at cast
  begin and handed back if the failure line comes inside the cast time (the Divine Intervention pattern).
- "LOADING, PLEASE WAIT..." clears your hate and your pet's. Zoning removes you from every hate list,
  despawns your pet and breaks a charm; Evacuate, Exodus, Succor, Lesser Succor, Levant, Abscond, Egress,
  Decession and Banishment of Nightmares reload the zone, so they print the line and do the same. Damage
  dealt stays on the DPS meter.
- **B, later:** other raiders' meters. The Concussion landing line names the mob, not the wizard, and nobody
  else's log sees you zone. The cast relay (spell + target) and each Mimic's zone report can carry both for
  Mimic users; raiders without Mimic stay invisible to others. Costs reads during a fight.
- `test/threat-concussion-zoning.test.js`.

**Zeal 1.4.8 and the fork.** Upstream merged our Bandolier filter (#238) and a third party's target
fields on the pipe (#239, the #213 ask), plus `/shownames raid` (#242) and `/tag rsgs` (#243). The fork's
main was synced by the guild lead; then main was merged into each branch (no force-push): `tag-shapes`
`8b4ff07`, `tag-persistence` `a5f104d`, `tag-corpses` `ccf7c07`, `tag-icon-files` `da36d4b`, `test-all`
`7d49ae6`. The conflicts were all `nameplate.cpp` (include lists, the MainLoop callbacks, the `/tag` help
text) and one README line; each branch's own change set is unchanged, checked line for line, and
`test-all`'s differs from before only by the Bandolier lines, which now come from upstream.

**`test-all` builds on GitHub (fork `0a2e25d`).** The guild lead: *"can we render this in github directly to
make a new test executable via script or does it need to be done on my machine"*. Until now every test
build was local (Visual Studio): the fork had never run a workflow, and its copied "Create manual release"
cannot run there, since it tags the release with the version in `zeal.h` (`v1.4.8`, the same as the real
release) and its changelog step needs an existing tag, of which the fork has none.
`.github/workflows/build-test-all.yml`, on `test-all` only (so it never rides into an upstream PR): every
push builds on `windows-2022` with upstream's msbuild line, labels the build `testall-<hash>` (Zeal's
options window shows it), zips what an upstream release zips, and replaces the zip on ONE rolling
prerelease, tag `test-all-build` (not `test-all`, which would make the branch name ambiguous). The first
run passed in about three minutes, which is also the first compile of the 1.4.8 merges:
`https://github.com/davehess/Zeal/releases/tag/test-all-build`.

**Mimic can install it (Mimic beta `0e5eb23b`).** The guild lead: *"build the option into mimic to pull my
zeal repo's build as an option"*. Settings → Zeal now has two choices, Official Zeal (default) and Test build.
The choice saves at once and re-runs Check; Install, the 12-hour reminder, the dashboard's Zeal button and
the setup walkthrough all follow it. The test release keeps one tag, so a build is named by its commit,
`testall-<hash>` (the label Zeal's options window shows), and every push to `test-all` reads as a new
version. Going back is "Official" then Install. `test/zeal-source.test.js`.

**Tag pictures: option A, plus every guild mark as an editable picture (fork `tag-icon-files` `e8254ec`,
`test-all` `da88716`).** The guild lead picked A: *"A"*, then *"output the current set of guild tag images as
tgas or pngs as well so if someone wanted to override they could edit and drop in"* and *"a readme in the
folder about it"*.
- **Zeal (`tag-icon-files`, upstreamable):** `uifiles/zeal/tagicons/custom/` is read too; nothing installs
  into it and a picture there wins over a shipped one under either name. A picture can now replace a guild's
  **banner** as well (`BEUR.png` for `^BEUR^`, real guild codes only), and an icon's picture may be named for
  the whole key (`IEUR.png`). The whole-key name is required, not cosmetic: Windows allows no file called
  `CON.png`, so `ICON.png` is the only way to picture the CON guild. `/tag icons` creates `custom`, prints its
  path and marks a player's own pictures "(yours)".
- **The build (`test-all` only, so no upstream PR carries guild marks):** `tagicons/README.txt` (the three
  folders, how to change a mark, the rules, the Windows-reserved names) and `tagicons/templates/`, all 30
  guilds' icon (`I<code>.png`) and banner (`B<code>.png`), 160×160 RGBA. They are the gallery's face-on renders
  of the real meshes. Zeal does not read `templates`, so shipping them changes nothing until a player copies
  one into `custom`.
- **What broke on the way:** the first push named the CON icon `CON.png`, and the Windows build failed at
  checkout. The rename to `I<code>.png` fixed it, and the next build passed (`727cee6`).
- **Tested:** the off-client test (`docs/upstream/zeal-tag-icon-files/test/`, g++ against the real
  functions) covers custom-wins under either name, whole-key names, banners and a non-guild `B<name>.png`.
  Three deliberate breaks (shipped searched first, banners off, no whole-key name) each fail it.
  clang-format is clean. In-game steps 10–15 are in `zeal-tag-shapes/TRY-IN-GAME.md`. `bandolier-chat-filter` is merged upstream and
`pipe-spawn-id` (unrelated history; spawn ids shipped in 1.4.6) is obsolete; neither was touched.

**The new pipe fields, reviewed.** `target_name`, `target_type` (0 player, 1 NPC, 2 NPC corpse, 3 player
corpse), `target_level`, `target_class`, `target_race`, and `target_loc` (only within 250 units), all
omitted with `target_id` when there is no target. Mimic does not read them yet: `main.js`'s player-message
handler copies only the zone, autoattack, the ids, target of target and our own position.
- **Where they help, in order:** (1) Target Info picks the exact NPC body. `_buildMobInfo` already lists
  the class variants of a same-name mob and waits for a "gender hint once the pipe can supply one"; level,
  class and race pick the row outright, so stats, loot and spells are right for same-name bodies.
  (2) Player targets get class and level from the client instead of `/who`. (3) `target_type` says corpse
  directly. (4) Name and id now arrive in one message, so they cannot disagree the way a lagging gauge name
  can. (5) `target_loc` gives the distance to the target when close.
- **Build when picked:** Mimic reads the six (null when omitted, like the ids); the agent sends level,
  class and race with the mob-info request; the bot picks the body with them.

**No more identical backups (Mimic beta `567c5911`).** The guild lead, on `uifiles/zeal/targetrings`: every
ring had three `.zealbak` copies, *"even though they're byte-identical"*. The Zeal installer (and the UI-pack
installer, same helper) backed up every file it wrote. Now a file that already holds the bytes is skipped,
and that installer's old copies identical to the file are deleted (only exact matches; a copy of a different,
older file stays). `test/install-no-identical-backups.test.js`.

**Tag pictures as files, the way target rings are (decided: A, built below).** The guild lead: *"I would
prefer to allow for additional tags in this way or overrides of the ones that are defaulted in from our
repo."* Built later the same day: a `custom` folder that wins, banners overridable, templates shipped. Still
not overridable by a picture: the symbols, badges, paws and the wolf (they have no `I`/`B` key).

## §124 — Two raids at once: a raid is the one your Mimic's raid window names (2026-10-02, bot 3.1.184 · web 1.8.70 · agent 3.7.65 beta)
*2026-10-02 · DECISIONS-2026-09-21.md · Two concurrent raids told apart*

The guild lead: *"earlier tonight we had two concurrent raids running for flagging our members. the second
raid started nearly an hour or so after the first one. mimic should be able to report up the raid
structure from the Zeal pipe and if that varies from the rest of the raiders reporting we should be
taking note. that means that things like extended Target, buff queue, the in-mimic raid dashboard and
the wolfpack.quest raid page should reflect that. the site page can show that there are two or more
raids"*

**What the night's data showed** (counts only). 24 uploaders between 18:22 and 22:20 ET; two raid
leaders live at once for about an hour, one raid of ~16 and one of ~26. Mimic already reported the raid
structure (Zeal type 5, every member with group and rank); nothing new was needed from the agent. Two
things were wrong on the reading side:
- **Raids were told apart by shared members** (union-find in the buff queue and on `/raid`). Rows are
  upserted and never deleted, so a raider who moves across stays in the first raid's uploads for the
  15-minute window, and one move joins the two raids into one. 6 uploaders held both leaders' rows that
  night, so the two raids read as one.
- **Rank is text.** Zeal sends `Raid Leader` / `Group Leader` (48 `Raid Leader` rows, no `'2'`); `/raid`
  and the dashboard Raid tab looked for `'2'` / `'1'`, so no crown, no leader banner and no leader on a
  raid tab had ever shown.

**The rule now (`utils/raidGroups.js`, ported to `web/lib/raidGroups.ts`).** Every row of one upload
carries the same `captured_at`, so each Mimic's latest upload is the raid it is in now, and that upload's
`Raid Leader` names the raid. Uploads naming the same leader are one raid; every latest upload that night
named exactly one. Uploads older than 2 minutes have no say (a raid that ended is not a second raid); two
raids sharing 60% of their members are one raid mid leader-change (DESIGN-multi-raid.md §2). With one raid
every caller keeps its old code path, and the bot's responses are byte-for-byte what they were.

**Where it shows.**
- **Buff queue** (bot): your raid's members only; the payload names the raids
  (`raids: [{ key, leader, size, mine }]`) only when there are two or more.
- **Extended Target** (bot): the other raid's raiders and their targets drop out, even in the same zone;
  raiders in no raid stay. Same `raids` field.
- **`/raid`** (web, main): one tab per raid, labelled with its leader, "N raids at once"; the tab you
  picked stays picked when the other raid grows past yours (it was held by position before); crowns.
- **Mimic** (beta, agent 3.7.65): Extended Target's count line, the Buff queue, the Command Center and the
  dashboard Raid tab say "⚔ N raids at once" and whose raid they show; the Command Center's priest mana
  keeps to your raid while two run; the Raid tab's crowns.
- **Taking note:** the bot logs one `[raids]` line each time the set of raids changes. Nothing is stored:
  `raid_roster` is pruned hourly, so tomorrow nothing records that two raids ran. A per-night record (for
  the raid review) is a small follow-up if wanted.

**Design.** One design, inside the existing `/raid` tab strip and the overlays' existing count lines,
rather than variants: the tabs were already there and broken, and the overlays get one line each. If the
guild lead wants a page that shows both raids at once (officers watching two crews), that is the
alternative: build moderate, maintenance moderate (two of every panel), runtime about double the render,
change moderate.

**Not split yet, each its own call:**
- **Attendance ticks** take every fresh roster together, so one tick covers both raids. Whether a flagging
  raid earns the main raid's tick is a DKP question (DESIGN-multi-raid.md §8 kept DKP out).
- **The trigger relay** is guild-wide during the raid window, so a guild trigger fired in one raid plays
  on the other raid's Mimics.
- `/buffs`, the signup comp matcher and the essence queue still take everyone's names together; the
  `dedup_roster` election (off by default) keys by group number alone.
- A machine boxing characters in both raids sends whichever raid window Mimic read first in each flush.

## §153 — Meter history credited the wrong things; fixed, and it keeps 100 fights (2026-10-04, agent 3.7.78 beta)
*2026-10-04 · DECISIONS-2026-09-21.md · Meter history attribution fixed, 100 fights*

The guild lead: *"damage/tanking meter could have more history in it. Make sure the history correctly attributes
pet data to owners and DS hits from tanks."* An audit drove the real code; every bug below was behind green
tests whose fixtures encoded it.

- **Threat, not damage:**
  - History (`_recordFightHistory`), the Target Info corpse list and the HUD's "this fight" / "tonight"
    added swing + proc + spell. That is threat: taunts, proc and cast hate, and 120 per resist.
  - Repro: a tank who dealt 100 showed 1,961 and topped the board.
  - All now read raw `dmg`.
  - Zoning mid-fight also dropped you from History; fixed by the same change.
- **Pets:**
  - History never folded pets into owners (the live meter does). Once the guild numbers settled, a pet
    counted twice: 1,009 shown on a 909 fight.
  - History also lost the "(pet)" label, so an unowned pet was pasted into /rs as a raider.
  - Both fixed: `_histRows` in overlay.html runs the live fold, and drops a guild row for a pet whose
    owner this machine knows, because the bot folded it already.
- **Charm breaks:** a charm pet whose charm broke before the kill vanished from the live meter and from
  History.
  - It now falls back to the proven-pets list the upload already uses.
  - Accepted trade-off: that mob's damage after the break also credits the charmer, as the upload
    already does.
- **Backfill:** a background (silent) log backfill could stamp the live fight ended and record it into
  History. Gated.
- **Damage shields:** correct for one wearer, in live and History. Known limit, unchanged: when two tanks
  are hit in the same second, the shield credit goes to the last one hit, since the log line does not name
  the wearer.
- **More history:**
  - 100 fights, up from 30.
  - Kept in `logsync.fights.json` for 7 days across restarts. It used to survive only a restart within
    10 minutes.
  - Fetched from `GET /api/fight-history` only while History is open. `/api/state` keeps a 10-fight
    digest, which alpha's `fight.history` part reads.
  - Each fight now also stores damage taken and the biggest hit, for a Tank history whose layout is an
    option pick (`docs/DESIGN-history-and-quest-nav.md` §2).
- **Not yet:** saved fights keep only rows with damage dealt, so a tank who dealt none has no row. That
  is for the Tank-history build to decide.

## §161 — Raid replay: keep every raid's positions, replay look not yet picked (2026-10-05)
*2026-10-05 · DECISIONS-2026-09-21.md · Raid replay keeps positions*

- **The ask (the guild lead, 2026-10-05):** *"can we replay raid timeline with the locations? I'd love to keep them
  for a raid and be able to figure out how things look after the fact."*
- **Nothing was kept before this.** `raid_roster` is an upsert, one row per uploader × raider, and the midnight
  chain drops rows over an hour old. No other table holds positions over time (`xp_events` has a loc per XP kill
  only). So the 2026-10-04 evening group (51 placed, 28 uploaders, gone by 21:08 ET) cannot be replayed.
- **Measured for sizing:** each Mimic posts the roster every ~4 s with ~50 members (3,755 posts in 10 minutes on
  2026-10-04 ≈ 6.3 a second); 72% of member rows are (0,0,0), an uploader's way of saying "another zone". Full
  nights run 41–51 raiders; Wednesday and Thursday 7–28. Appending raw uploads would have been ~3.4 M rows a night.
- **Recorder (bot 3.1.203), built without waiting for the pick** because every look needs the same data and
  Wednesday is the next chance to capture a raid:
  - `utils/raidTrack.js`. The raid-roster handler hands its rows to `noteRows()` (memory only, never throws).
    The first uploader to report a raider keeps them for 6 s so two slightly different views do not shimmer;
    HP is taken from any uploader, since each one only has gauges for its own group.
  - Every 3 s (`RAID_TRACK_STEP_S`) the raiders seen in the last 6 s become a frame, if six or more are placed
    (`RAID_TRACK_MIN_PLACED`). Each finished minute is ONE row in `raid_track_minutes` (migration
    `20261005020000`, applied 2026-10-05): `data` is compact JSON text (`who`, `zones`, frames of
    `[dt, i, x, y, z, heading, hp, zone]`; −1 = unknown), text rather than jsonb because number arrays store
    about 3× smaller. x/y are raw `loc_x`/`loc_y`; the web swaps them when plotting.
  - Zone is stamped at write time, per uploader (an uploader only places raiders in its own zone): the majority
    `character_live_state` zone of that uploader's raiders, else the minute's majority.
  - **`exclude_from_stats` characters are never written**, matching the raid review; a minute is not written
    until that list has loaded once (fail closed).
  - Size: ~2–4 MB a full night, ~0.5 GB a year.
  - **Retention — the guild lead's call (2026-10-05):** *"I want this captured to the local tower backup and kept
    there. let's plan on retaining raids for now until it becomes a storage issue."* So:
    - Supabase keeps every raid. `RAID_TRACK_RETENTION_DAYS` is unset by default; the sweep is off.
    - Tower keeps a permanent copy: `raid_track_minutes` is an ARCHIVE table in `scripts/lib/archive-merge.sql`
      (insert and update, never delete), and that script creates the table on Tower, because the merge skips a
      table Tower lacks without a word (how `faction_hits` never arrived). `scripts/test-archive-merge.sh`
      covers both: the table is created and filled, and a minute production drops stays.
    - If storage ever forces a sweep, it deletes only up to `bot_kv archive_watermark_raid_track_minutes`
      (`{ through }`), the threat-snapshot gate: no watermark, nothing deleted. Nobody writes that watermark
      yet, so turning the sweep on today deletes nothing.
    - Manual step: Tower's copy of the merge script is not a git checkout, so the guild lead or a local session
      copies it over (STATUS ⚠ item). A cloud session reaches Tower read-only, and could not start a Postgres
      to run the self-test here either.
  - Service role only (RLS on, no policies, no anon/authenticated grants). `docs/PRIVACY.md` and `/privacy`
    now say positions are kept for replay, with a permanent copy in the Archive (web 1.8.99).
  - **Not on main yet.** Committed 2026-10-05 on `claude/sharp-lamport-dC0TW`; the push to main inside the
    Sunday freeze window was held back by the session's permission check (the guild lead's "no raid, push it"
    covered the spectator push before it). It lands when the guild lead releases it. The migration is already
    applied; the empty table is harmless until the bot code lands, and `/privacy` keeps saying "nothing is
    stored" until then, which stays true.
- **The look, offered (not picked):** **A — Night scrubber: the live map gets a timeline** (play/pause, 1–60×,
  boss kills marked; recommended); **B — Fight replays: each kill on the raid review gets a ▶**; **C — Trails:
  one still picture per fight, no playback.** Previews go on b.wolfpack.quest once Wednesday is recorded.
- **Not in a replay yet:** mobs. Target positions need Zeal 1.4.8 across the fleet and the agent sending
  `target_loc`.

## §170 — My parses over time: a Mimic tab, a website page, and a Trend view on the meter (2026-10-06)
*2026-10-06 · DECISIONS-2026-09-21.md · My parses over time views*

A member asked: *"is there a page in mimic that'll graph out my parses over a variable time window (1 day, 1 week,
etc.)?"* The guild lead: *"we should have some visualization in mimic"*. Three options went out with mock-ups (a
Mimic tab, a glance sparkline, a website page). The guild lead picked: *"A and C now as you described, B as part of
alpha canvas"*, then *"actually, B can be a view on the DPS/Tanking overlay"*.

- **Nothing graphed this before.** `/me` and `/character/<name>` list parses; the meter's History steps through one
  fight at a time; `/mystats` is all-time averages. The data was there; a per-person query and a chart were not.
- **One function for both server surfaces:** `my_parse_series` (`20261006200000_my_parse_series.sql`, applied via
  MCP). The Mimic tab and `/me/parses` cannot disagree. Defaults taken from the mock-ups the guild lead picked:
  - **Which fights count:** Bosses (the curated list) by default, with an Everything switch.
  - **What a dot means:** DPS per fight, boss named, plus "vs your usual" (the character's median on that boss),
    because raw DPS mostly says how hard the boss was.
  - **Windows:** 1 day, 1 week (default), 30 days, 90 days, this expansion, lifetime.
  - **Floor:** every window starts no earlier than 2026-07-14, the median-merge cutover, like `/leaderboards`; older
    multi-uploader rows were max-merged and cannot be repaired.
  - **Who:** the signed-in person's own characters (household + family, minus `exclude_from_stats`), resolved inside
    the function from a discord id the caller takes from its own session. Service role only.
- **A — Mimic tab** (beta, agent 3.7.90, `ba89817c`): a My parses tab in Mimic's main window, fed by
  `GET /api/agent/my-parses` (bot 3.1.210) through the local agent, with a tray item that opens it.
- **C — website** (live): `wolfpack.quest/me/parses`, new page, so it went live with the [beta] tag (§135). Not
  linked from `/me` yet: that is a change to an existing page.
- **B — Trend view on the DPS/Tank Meter** (beta): the guild lead moved it off the alpha Canvas. It reads only the
  fights the PC already keeps for History (tonight / 7 days), so it costs no server calls.
- **Found on the way:** only 14 of the timer board's 43 Planes of Power bosses are on the curated boss list, so the
  guild logged 0–3 "boss" kills a day since PoP opened. Bosses looks nearly empty this week; both surfaces point to
  Everything. Adding the other 29 would also fix `/parses` and the leaderboards. **The guild lead's call.**
- **Cost:** reads only, nothing stored. A heavy "every fight" window is ~90 KB before gzip and 0.6 s; cached 5 min
  per person on the bot.
- **Same evening — mules out of the character list.** The guild lead, looking at ~50 chips in the Mimic tab: *"I
  need to be able to either set these other watched logs to non-combat/inventory only or we should be able to see
  that they don't have recent combat and hide them. My expectation on this list is mains and real alts. Perhaps we
  need the user to set which logs mean what to them."* Both halves already had a home:
  - **The user's setting already exists:** "Hide from lists" per character on `wolfpack.quest/me`
    (`characters.hidden_from_lists`, §140: hidden from everything but account inventory). The parse chart was the
    one list ignoring it, along with rank Trader.
  - **The fix** (migration `20261006210000_my_parse_series_char_tiers.sql`, applied): every character carries
    `hidden`, `fights` (in the window) and `recent` (30 days); "all my characters" leaves hidden ones out. A chip shows
    only for a character that is not hidden and has fought in the window or the last 30 days; the rest fold under
    "+N more". On the account it was reported from: 47 characters → 6 chips, 7 folded, 34 hidden.
  - **Not built, offered:** the same switch inside Mimic (per watched log, or ✕ on a chip), so it can be set without
    the website.
  - **Shipped:** web 1.8.108 (`/me/parses` chips) and agent 3.7.91 on beta (the Mimic tab's chips). An older bot
    without the fields shows every chip, as before.

## §174 — My parses: search, zones, By day, and a Guild / My logs switch (2026-10-07, bot 3.1.213 · web 1.8.110 · agent 3.7.95 beta)
*2026-10-07 · DECISIONS-2026-09-21.md · Parses search, zones, guild/my logs*

The guild lead: *"can you make it so that I can explore more in the fights section? chop it up by days, zones, mobs,
search bar, etc."* Three ways out; the pick: *"A, but also I'd like the user to be able to toggle between their data
from logs and the guild's data."* (A = filters on the list. The others were a separate explorer view and a
per-zone breakdown table.)

- **One new function:** `my_parse_series_v2` (`20261007000000_my_parse_series_v2.sql`, applied). It adds a zone
  filter (zone id = npc id ÷ 1000), a mob-name search, each fight's zone, and two picker lists (`zones`, `mobs`)
  worked out BEFORE the zone and search filters, so choosing a zone never empties the picker. A new name, not a
  replacement: dropping the old function is a destructive statement and was refused unconfirmed. The bot route and
  `/me/parses` moved to v2; `my_parse_series` stays until a session with confirmation drops it.
- **Website** (`/me/parses`, live, web 1.8.110): search box with the mobs as suggestions, Zone picker, By day (the
  list grouped under each raid night: "Sun Oct 4 · 12 fights · avg 142 · best 210"), Clear, and a Zone column.
- **Mimic** (agent 3.7.95, beta): the same filters, plus **Data: Guild | My logs**.
  - **Guild** is the guild's merged record, through the bot, as before.
  - **My logs** is what this PC's own log recorded. It needs no sign-in and makes no call, so it works in local
    mode too. The agent keeps a slim fight log (`logsync.myfights.json`): one row per own character per fight,
    written when the fight ends from the same hook as the meter's History, with pets credited to their owner. It
    keeps 365 days or 20,000 rows, and the first run seeds it from History.
  - My logs can't know everything the guild knows: no rank among the guild, no wolfpack.quest fight link, the zone
    only when Zeal said where you were, and "boss" only for mobs whose catalog row this PC already holds. The tab
    leaves those columns out, or says so, rather than guessing.
- **Answering "is this from the website or my logs?"**: Guild = the website's numbers, merged from every uploader;
  My logs = this PC only. The tab's subtitle names which one you are looking at.

## §287 — The post-kill recap: the whole raid on /screen, inside the RaidBosses kill card, with fun events and stars (2026-10-13)
*2026-10-13 · DECISIONS-2026-09-21.md · Post-kill recap on screen and kill card*

- **The call** (the guild lead): *"displaying C the whole raid. raid thread cards can be coordinated with the
  RaidBosses card. the fun events can be mentioned and highlight stellar performance."*
- So the recap (how this kill compared with the last and the best, first kills, deaths) shows on
  https://wolfpack.quest/screen's Overview for the whole raid, rides INSIDE the kill card the bot (Discord name
  RaidBosses) already posts in the raid thread — no second post — and adds the fight's fun events and up to three
  honest stellar-performance highlights. Post-kill only (§284).
- **Test before the raid:** a read-only replay of every raid-boss kill since 2026-10-04, printing what the card
  would have said at that moment (the guild lead: *"test the bot on a replay of fights from the last week"*).
- Drafting: bot side (`utils/killRecap.js`, card hook, `bot_kv last_kill_recap`, screenLive `recap`) on main;
  the /screen Overview card on beta. Both by Sonnet agents, reviewed here.

## §337 — Raid session review + public share links; kite coach, Tail and parchment on beta; the npm build break (2026-10-15)
*2026-10-15 · DECISIONS-2026-09-21.md · Raid session review with public share links*

- **The ask** (the guild lead): *"lets start merging the spectator replay and the raid's contents bound by the timeframe.
  the morning raid yesterday would be ideal to send to the other guild's leadership for them to review, with rolls,
  attendance, etc with a public sharing link that doesn't require discord permissions."*
- **Built (web 1.8.165, beta only — it stands on the beta replay stack and `lib/guild`):** `/raid/session?from=&to=`
  (members) = the replay bounded to one session + Attendance (from the recording), Kills (encounters ended in the
  window), Loot (`looted_items`, `loot_observations`), Rolls (`roll_sets` + officer overrides), Parses; every time
  seeks the replay. **Share links:** an officer makes one (7/30/90 days, default 30), revocable; table `raid_shares`
  (migration `20261015130000`, applied) stores only the SHA-256 of a 32-byte token; `/share/raid/<token>` needs no
  sign-in, renders a bare shell (no member links), `noindex`, and every read is bound to the share row's window —
  nothing public takes a time from the URL. Opted-out characters (`exclude_from_stats` or `exclude_inventory`) are
  scrubbed from every list and from the replay frames server-side. Unknown, expired and revoked tokens are one 404.
  `docs/PRIVACY.md` says what a link exposes.
- **The first link** — yesterday's daytime session, 2026-10-14 13:08–16:51 UTC (9:08 AM–12:51 PM ET), 79 raiders,
  89 loot rows, 65 roll sets, no curated bosses — was created by this session for the guild lead to send (expires
  2026-11-14). The link itself is not written here.
- **Follow-ups the same day (the guild lead):** the officer panel now copies the link on the current host (a
  wolfpack.quest share address 404s until the stack graduates; web 1.8.166); a collapsed **"How do you have this
  data?"** under every session review explains the Zeal pipe (the raid window any raid member's client already
  holds) and miMIC (reads the pipe and the player's own log locally; chat channels filtered on the machine), web
  1.8.167; share pages get a **public top bar** — home, About, In short, Platform, Roadmap, Get started, Zeal marks,
  Privacy and the miMIC downloads, nothing that needs an account (`web/components/PublicTopBar.tsx`, web 1.8.168).
- **Also on beta today:** agent 3.7.180 — the kite drift coach, guild loop rings and a **Tail** slider for the Map's
  target trail (the guild lead: *"we need a slider for tail history"*; Off / 10 s–5 min, default 60 s); web 1.8.164 —
  parchment background (2D) and shaded opaque floors (3D), per §220.
- **The build break:** bot 3.1.275 failed twice on Railway at `npm install --omit=dev` ("reading 'edgesOut'" in npm's
  peer resolver): with no lockfile, a fresh vitest release's optional peer set crashed npm 10 even though dev deps
  are omitted. Production stayed on 3.1.274. Fix: `npm install --omit=dev --legacy-peer-deps` in the Dockerfile
  (same production tree; no prod dependency needs an auto-installed peer). Deployed 15:22 UTC.
- **Graduated to main** (the guild lead: *"graduate these to main"*), 2026-10-15 13:30 ET, outside the raid freeze:
  the eleven beta commits c23af97e…1ef8c5eb cherry-picked onto main clean (`lib/guild` was already on main), the
  full suite green but for the known my-logs-local failure, then web 1.8.170 rewrote the roadmap entry as a live
  release in a SECOND push — after `sync-beta` had merged the cherry-picks — so main→beta stayed conflict-free.
  The share link now works on both hosts; the officer panel copies the current host's address.

## §338 — The post-raid output links the session review; every fight gets its full parse (2026-10-15)
*2026-10-15 · DECISIONS-2026-09-21.md · Post-raid output links full session review*

- **The ask** (the guild lead): *"after raids we should build in this link into the output, we should see the full
  parses and whatnot as well"*.
- **Bot 3.1.276 (main):** the FINAL raid review (00:45 ET, or `/raidreview`) carries a **"Full session review"** link
  button to `/raid/session?from=&to=`. The live card does not (it would add a read every 5 minutes). It is the
  MEMBERS link: no public share is made automatically — a share stays an officer's deliberate act (§337). The window
  is the `raid_track_minutes` session overlapping 19:30–00:30 ET (20-min gaps split, most minutes wins, the same
  rules as the web's default session) from a `minute_at`-only read bounded 12:00 ET → 06:00 ET; with no recording
  it falls back to the raid window itself. `utils/raidSessionWindow.js`, `test/raid-session-window.test.js`.
- **Web 1.8.171 (beta — an existing page):** each fight on the Kills tab (and under each Parses card) opens into the
  full table — every player with class, damage, DPS, share and time, sortable, with totals — fetched when opened.
  Members: `/api/raid/session/parse`, plus a link to the fight's `/parses/<id>`. Share: `/api/share/raid/<token>/parse`
  serves a fight only if it ENDED inside the share's window — the exact rule the page lists fights by, so nothing
  outside the listed set is reachable by guessing ids. Opted-out characters are dropped before shares and totals are
  computed. The top-five read now covers 400 fights (was 60; the list itself was never capped).
- Where: `https://b.wolfpack.quest/raid/session` (and any share link on b.). Graduates on the guild lead's word.
- **Same day, web 1.8.172 (beta):** bosses on the replay are big red dots. A recorded target whose name is one of the
  night's killed bosses is a filled red dot (white ring in 2D, red sphere in 3D) where the raid fought it; a boss's
  SPAWN POINT (nights recorded before targets) is a red dashed ring labelled "spawn point". Recorded target positions
  exist only from 2026-10-15 13:22 UTC on.

## §347 — Raider figures on the replay map: a paper doll from screenshots of each side, stylized (2026-10-15, call only)
*2026-10-15 · DECISIONS-2026-09-21.md · Stylized raider figures on replay map*

- **The ask** (the guild lead): *"can we start creating everyone's little models to display in the 3d mode or a 2d
  format"*. Offered A (a figure built from the recorded race / armour dyes / weapon in `raid_night_appearance`),
  B (a face coin from the film stills), C (real client models, Mimic only).
- **The call:** *"Something repeatable, a paper doll would be cool, and show facing, we could make it with a screenshot
  of each side of them then stylize"*: per raider, screenshots of the front, left, back and right of their own
  character, stylized into one consistent sprite set, and the map shows the side matching their heading.
- **Plan, cheapest proof first:** (1) stylize one character's four screenshots by hand with the image model the film
  used, and look at it; (2) the replay draws the facing sprite (class dot when a raider has none); (3) a Mimic
  "photo booth" captures the four sides on a hotkey, guided; (4) the bot stylizes and stores them in the private
  `guild-media` bucket, re-runnable when gear changes.
- **Boundary:** a stylized screenshot is derived from the client's art, the same family as §220's 3D-C, so the
  sprites stay members-only (the replay is already member-gated) and are never committed to the repo.

## §356 — Opt-outs are a class on the raid session review and share links; bid winners keep their name (2026-10-18)
*2026-10-18 · DECISIONS-2026-09-21.md · Opt-outs shown as class on session review*

The guild lead, 2026-10-17: *"if someone opts out, just put their class on that spot to anonymize them. do not
anonymize bid winners, but link all of those with a unique handle that shows what they all bid on."* So on the raid
session review (`/raid/session`) and the public share page, a character with `exclude_from_stats` or
`exclude_inventory`:
- is shown as its **class and a number** — "Cleric 2", the same label in the replay board, attendance, ticks,
  parses, loot and rolls. The number is from a salted `opaqueKey` order, **never the name**, so "Cleric 1" is not
  the alphabetically-first opted-out cleric. Names are swapped **on the server** (`scrubMinuteData`,
  `raidShareLookup.loadAnon`) before any row leaves — the browser never sees the real name. This REVERSES the old
  "drop the line, keep nobody" behaviour: an opted-out raider's damage now counts in the share, under their label.
- **unless they won an item in the window** — the one exception. A winner (a closed `opendkp_auctions` row, or a
  `loot_observations` award, inside the session's window) is shown by **name**, because a closed auction's winner is
  already public in OpenDKP. Their name links to a new **Bids** section under an opaque `#bids-<handle>` (the handle
  carries no name): what they won and paid, and the **closed** auctions they bid on and lost (top bid + who won),
  from the `opendkp_auction_bids` mirror. **Open auctions are sealed**: no win, no bid, no name until they end.
- Where: `web/lib/raidSession.ts` (`anonLabels`/`anonName`/`scrubMinuteData`/`exemptWinners`),
  `web/lib/raidSessionBids.ts` (`winsOf`/`buildBidders`/the reads), `web/lib/raidShareLookup.ts` (`loadAnon`),
  new sign-in-gated `/api/raid/session/replay` so the members' board is labelled too; tests
  `test/raid-session-anon.test.js`. `/privacy` and `docs/PRIVACY.md` reworded.
- **Known gap (TODO in raidSessionBids.ts):** a losing bid made under an OpenDKP login that differs from the
  character name and carries no `character_id` is not attributed — a missing line in someone's "lost" list, **never a
  wrong name**. Rare: the sync stores `character_id` for every list-endpoint bid.
- Shipped to **beta only** (web, no `web/package.json` bump — a beta-only web change keeps the main → beta sync
  clean). Review at `https://b.wolfpack.quest/raid/session`. Graduates to `main` on the guild lead's look, and the
  STATUS entry gets the stable web version then (the both-gates rule).

## §399 — PoP named bosses are curated from their first kill (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · PoP named bosses curated from first kill*

The guild lead, 2026-10-21, on the 2026-10-18 night on /parses: *"This raid is missing all the parses except for
Saryrn."* The fights were stored; the cards filter to curated `bosses_local` rows (`auto_registered = false`), and
every PoP named the bot met first registered as trash. The curated list the guild lead set on 2026-10-18
(`data/named-bosses.json`, served as `raid_target` by `utils/namedBosses.js`) was never applied to that flag.
- **Data, done 2026-10-21:** 38 `bosses_local` rows on that list promoted (id match, or name inside the zone its id
  sits in — the same rule as `isNamedBoss`). The night now shows 13 cards: the six Torment nameds, Saryrn, the four
  Halls of Honor nameds, Halon of Marr and Lord Mithaniel Marr.
- **Bot 3.2.16:** `_resolveBossForPersist` registers a listed boss with `auto_registered = false` on its first kill.
  Kill lockouts are unaffected (they key on `data/bosses.json`).
- **Still wrong: the Saryrn card (34k of an 850k boss).** The agent names a fight after its top-damaged target, so
  most of the Saryrn damage sits in the defenders of the "a summoned servant" encounter (553k, 12 contributions; one
  uploader saw 243k on Saryrn there) and of a long Maareq window. Cut and naming: `packages/wolfpack-logsync/index.js`
  `flush()` (~10974–10996, fallback ~11167–11173). Proposed fix (agent, beta): name the fight after a curated boss
  that took at least 25% of the window, never after an add. Waiting on the guild lead.

## §408 — Guest raids are being stored as ours (2026-10-22, open)
*2026-10-22 · DECISIONS-2026-09-21.md · Guest raids wrongly stored as ours*

`raid_roster` rows from a raid run by another group, uploaded by our members' agents, read as a Wolf Pack raid (this is part
of why the pre-raid average read about 82, §405). Not fixed. Pick open: **A** tag those rows as a guest raid (recommended:
the data is still useful for the raider, and it is what guest pass A, §402, needs anyway) or **B** do not send them.

## §413~2 — Shared raids follow the raid, and their window is moved from the page, not by hand (2026-10-23, web 2.1.7–2.1.8 beta)
*2026-10-23 · DECISIONS-2026-09-21.md · Shared raid windows follow raid, edited on page*

A share that "follows the raid" is stored as `to_at = from_at + 24 h − 1 s`; moving only its start breaks that shape and freezes
its end (a hand SQL edit did exactly that, and the slider ended at 7:02 PM). Officers now move a share's start and end on the
session page (Set start, Set start and end, Start this share at the split), which writes both columns together and drops the
caches. An end typed earlier than the start, within a day, means the next morning (*"consider the date"*; `endAfterStart` in
`web/lib/raidSplit.ts`). The replay, kill chips and path marks show only the window's own bosses. Only the timeline strip polls
(10 s); the replay needs a reload — the A/B for live refresh (self-refresh vs an "N new minutes — Update" chip, B recommended)
is open.

## §415 — A fight can be a wipe AND another mark (2026-10-23, web 2.1.3 main, migration 20261023120000)
*2026-10-23 · DECISIONS-2026-09-21.md · Fight can be wipe plus another mark*

*"be able to mark as Wipe AND another thing. This was a non-guild wipe."* `encounters.is_wipe` rides beside the one-of
`classification`; a wipe keeps a non-null classification ('wipe' alone, or the other mark), so every `classification is null`
"guild kill" reader is unchanged and guild-wipe counts (`classification = 'wipe'`) do not count another guild's. A CHECK keeps the
two agreeing. Wipe is a toggle on /parses and /parses/<id>.

## §416 — Two wipes on one boss are two fights (2026-10-23, agent 4.0.15 beta + migration 20261023130000 main)
*2026-10-23 · DECISIONS-2026-09-21.md · Two wipes on one boss split into fights*

*"actually there were two wipes"* — two pulls ~30 min apart uploaded as one encounter because trash between them kept the
per-log fight builder open. Agent: a fight ends when its top target has taken no damage for 5 min (`_splitIfTopIdle`). Bot:
`find_or_create_encounter` declines a match whose start is more than 15 min past that fight's end (15 keeps the 2026-07-13
dispel-reset knit, re-engaged ~10.5 min after its active end). Open: the nightly reconcile stamps `ended_at` on unconfirmed rows
and the raid review reads `ended_at` as a kill, so a wipe can read as a kill there (A: reconcile leaves wipes unstamped,
recommended). The one merged parse stays as it is unless the guild lead asks for a split (estimated per-player numbers).

## §419 — Slicing a night: two previews (2026-10-23, web 2.1.10 beta)
*2026-10-23 · DECISIONS-2026-09-21.md · Slicing a night into raids and events*

*"I need a way to slice out events and actual raids vs other times spent in raid"*, plus named fights (kills and wipes) and
mass-death moments on the night timeline, and the fights' parse timelines on the session page. Stored in bot_kv
`night_slices:<guild>` (no migration). Two previews: `?v=slices` (draw labelled spans) and `?v=segments` (confirm detected
segments; recommended). Pick open.
