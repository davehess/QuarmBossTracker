# Decisions — 2026-08-07

Durable calls made in one long session (Hitya + cloud Claude). Recorded because
they were made in chat and chat does not survive; the rules that outlive this
week were also folded into `CLAUDE.md`.

Format: **the call**, then *why*, then where it landed. Anything still open is
in the last section — that is the part a future session should read first.

---

## Storage / data

**Threat snapshots are gated to raid activity.** Keep a snapshot when it names
a boss, OR it is raid time and 8+ players are in the fight
(`THREAT_SNAPSHOT_MIN_GROUP`). Trash pulls during a raid are deliberately IN —
"we can still include trash when we're all together". Off-hours duo camping is
out: measured at 54% of the payload, answering nothing. Named bosses are kept
regardless of clock, so off-night kills still count.
→ bot 3.1.32+, `_handleAgentThreatSnapshot`.

**Threat data links to raid nights.** `raid_night_id` on both snapshots and the
roll-up, using the platform's 06:00-ET rollover, so a 00:30 Thursday pull
belongs to Wednesday's raid.

**Roll-up keys on `(boss_name, started_at)`, never `encounter_id`.**
`encounter_id` is assigned at fight END by `find_or_create_encounter`, so it is
NULL on 99.3% of snapshots. A first attempt keyed on it silently summarised
0.7% of the table and missed King Tormax, Aten Ha Ra and Diabo Xi Xin Thall.
**If you ever join threat data on `encounter_id`, you are reading a 0.7%
sample.**

**Unchanged scoreboards are not stored.** Consecutive snapshots were routinely
byte-identical (same totals six seconds apart). Bot-side content hash, sorted
keys — the agent rebuilds `per_player` per upload and raw `JSON.stringify`
order varies, so hashing unsorted would never hit.

**Chat history stays in Postgres.** Not moving `chat_messages` to object
storage; ~79 MB/year is a decade from mattering.

**OpenDKP mirror: closed raids barely change.** Re-upsert a raid only when its
upstream `Version` moves. Ticks/DKP/attendance corrections still flow.
*Not yet implemented* — `opendkp_raids` and `opendkp_auctions` are still
rewriting themselves (1.5M and 3.7M updates).

**Threat snapshot raw retention: still undecided.** Default is 120 days and the
comment justifying it estimates ~7 MB/week against an actual ~90 MB/week.

## Attendance

**RA is measured against ticks the member could have attended.** The denominator
is now per-family, floored at that family's first tick, for every window —
`GREATEST(window_start, first_attended)`, the same rule OpenDKP applies.
Previously every member was measured against all 1,492 guild ticks ever, so
everyone who joined after the guild started was under-reported, worst for the
newest people. Gonner went 64% → 100%, which matches ground truth: he has never
missed a tick.
→ migration `20260808030000_attendance_denominator_member_floor.sql`.

**Roster counts: two different questions, both right.** The leader's sheet
filters to ≥50% RA over 30 days (41 people); ours counts every raiding rank
(64). Neither is wrong — ours is not the recruiting number. Dant and Denniker
sit at exactly 50%, which is where 41-vs-42 comes from.

## Releases / process

**Release-visible text is member-facing, not a git log.** Bullet every
user-facing item, one line each, never a prose paragraph. No technical jargon —
EverQuest mechanics (rampage, DA, slow, CH chain, mez) are fine; code
identifiers are not. Applies to graduation commit bodies (the announcer reposts
them verbatim), `roadmapData.ts`, and any Discord-facing changelog.
→ folded into `CLAUDE.md`.

**Hitya authors almost all triggers**, until the system is as granular as
EQLogParser. So the officer "authoring floor" question is moot — build trigger
features against the newest shape rather than the oldest deployed Mimic.

**A graduation push must put the Mimic version bump in the LAST commit.**
`release-mimic.yml` diffs `HEAD` vs `HEAD~1`; a docs commit landing after the
bump makes it no-op with a green check. Cost us the v2.3.3 stable build, which
had to be recovered by `workflow_dispatch`.

## Mimic / agent

**Log archiving: ON by default at 500 MB**, idle 15 min, `WP_LOG_ROTATE_MB=0`
disables. Archive, never cull — old logs feed `--since` backfill and historical
chat. Announced with a one-time in-app banner, not a Discord post.

**Guild management window is read-only**; editing belongs on existing web
pages. Note EQ gives us no guild roster at all — `/outputfile` takes
`inventory | spellbook | quarmy | raidlist`, all character-scoped. Public and
personal notes would have to be OUR fields.

## Zeal `/tag` (#194)

**Spawn ids are per-zone and structurally collide.** Ids are allocated in spawn
order from a low base in EVERY zone, so zone-boot NPCs share ids across zones —
14 named NPCs inside ids 11–45 in one zone alone. An id belongs to a spawn
INSTANCE and dies with the mob, so same-zone respawn reuse does not happen.

**Same-name identity IS available at scale — but operator-driven.** Measured:
4 simultaneous `a decaying skeleton`, 5 `a brown bear`, ~17 `an elder thought
horror`. All separable. But it needs a human to tag each mob against a chat
rate limit (~8/min), so design tags as high-confidence labels layered over
clustering, never as full coverage.

**Two upstream asks are drafted** (`docs/zeal-tag-spawn-id-collision.md`,
`docs/zeal-spawn-id-request.md`) and not yet sent.

## pq-companion

**Study and reimplement; never copy.** The repo has no license — all rights
reserved. Five analyses live in `docs/pq-companion/`, and five agent fixes
shipped from them (3.5.44–3.5.48).

---

## Open — read this first

| Item | State |
|---|---|
| **Beta adoption is ~zero** | 9 beta builds shipped 2026-08-07; only stable-channel agents (3.5.36, 3.5.42) ever reported. Consider graduating rather than piling onto beta |
| Threat roll-up grain | 31 MB / 5 weeks (~330 MB/yr). 87% is trash at per-fight-per-player grain; per-(raid night, player) would make it permanent-cheap |
| Threat raw retention | untouched at 120 days |
| `opendkp_raids` / `_auctions` | still rewriting; needs the Version check above |
| Trigger features | multiple warning thresholds, capture-derived durations, exclude patterns, visible recast timers — unblocked, not built |
| Zone map overlay | blocked on a 1–2h in-game coordinate spike (docs say Zeal transposes x/y; the dashboard path disagrees) |
| Report 04 P3–P5 | taunt-emote attribution, wildcard verb fallback, EQMac threat weights |
| Archived logs | drop out of the smart-backfill picker until moved back |
| Release naming | Hitya's call; themes never proposed |
