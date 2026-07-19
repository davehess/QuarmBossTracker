# DESIGN — Multi-raid awareness (board #114)

*Written 2026-07-19 (Fable design pass, Hitya's direction). Implementation is
deferred to a later session — this doc is the contract. Read
`DESIGN-dedup-and-mob-serialization.md` first; its bounds apply throughout.*

## 0. The operating principle (Hitya, verbatim intent)

Multiple concurrent raids are **one of the most atypical things that will
happen** — usually OFF-schedule, small-group split ops (epic fights, backflag
crews, an alt raid while mains camp something). Two consequences rule the
design:

1. **The single-raid path is sacred.** Nothing multi-raid may destroy, slow,
   complicate, or visually change how the primary raid operates. When one raid
   exists — the 99% case — every surface behaves bit-for-bit as today.
2. **The raid leader (and group leaders) are what genuinely distinguish who is
   in which raid.** Not zones (two raids can share one), not schedules, not
   composition heuristics — leadership. And leadership is *observable*: the
   Zeal pipe's type-5 raid frames carry per-member `rank`, and multiple guild
   raid leaders are identifiable across uploaders' snapshots.

## 1. Ground truth (verified against the shipped pipeline)

- Zeal type-5 (raid) per member: `{ name, class, level, group, rank, loc,
  heading }` (+ verbose `hp_current/hp_max/zone_id`). See
  `zeal-pipe-protocol.md`.
- The agent's `raid_roster` upload already includes **`rank`** per member, and
  the bot already stores it. **Raid identity requires NO new agent field** —
  P0 is bot-side interpretation of data we already hold.
- Each uploader's snapshot describes exactly ONE raid: the raid *they are in*.
  An uploader is never in two raids. So the uploader→raid mapping is total and
  unambiguous whenever their snapshot names a leader.
- The reporter registry independently knows each uploader's zone, group_num,
  and live character (#112/#119) — corroborating signals, never the anchor.

## 2. The identity model

**`raid_key` = the normalized name of the raid-leader-ranked member** of an
uploader's current snapshot.

- Derivation (bot-side, per uploader, per snapshot): find the member whose
  `rank` marks raid leader; `raid_key = lower(leaderName)`. All uploaders
  whose snapshots name the same leader are, by construction, in the same raid
  (they are literally reading the same raid window).
- **Continuity across leader transfer**: a raid whose leader changes mid-life
  must not fork. Rule: if a new `raid_key` appears whose member set overlaps
  ≥60% with a raid seen in the last 10 minutes, it is the SAME raid,
  re-keyed; keep a stable internal `raid_id` (first leader + first-seen ts)
  with `raid_key` as the current label. Member overlap is computed from the
  snapshots we already store — no new data.
- **Group leaders** are the secondary signal: group_num collisions across
  raids are expected (every raid has a group 1), so any consumer keyed by
  group today must become keyed by `(raid_id, group_num)` when multi-raid is
  active — and stays effectively `(–, group_num)` when it isn't.
- **The unraided bucket**: uploaders with no raid (solo/group-only, no type-5
  leader) get `raid_id = null` and behave exactly as today. A null raid is
  never merged with a real one.

## 3. The activation invariant (how we protect the primary path)

Define bot-side: `activeRaids` = distinct live `raid_id`s across fresh
uploader snapshots (fresh = the roster staleness window already in prod,
15 min).

- **`activeRaids ≤ 1` → single-raid mode. Every code path, query, election
  key, and UI is EXACTLY today's.** The implementation must make this
  structural, not incidental: partition logic is gated behind
  `activeRaids > 1`, so a logic bug in multi-raid code cannot fire on a normal
  raid night.
- `activeRaids > 1` → partition mode, per consumer below.
- Every consumer fails OPEN to single-raid behavior on any ambiguity (missing
  rank, unresolvable leader, stale snapshots): the failure mode of multi-raid
  awareness is "behaves like today," never "hides data."
- A control-plane kill switch (`flag_disable_multiraid=1`, tuning map, 60s
  cache — the established pattern) forces single-raid mode fleet-wide.

## 4. Consumer-by-consumer partition plan

| Consumer | Today (assumes one raid) | In partition mode |
|---|---|---|
| `raid_roster` store | rows per member, no raid tag | add nullable `raid_id`/`raid_key` columns (migration); writer tags rows from the uploader's snapshot; readers ignore the column in single-raid mode |
| Roster election (#72 P1c) | 1 reporter per `group_num` | key becomes `(raid_id, group_num)` — two raids' group-1s each get a reporter. In single-raid mode the key degenerates to today's |
| Chat election (#112) | 1 per zone, liveness-gated | **unchanged** — /gu is guild-global; raids don't partition it |
| Buff election (#72 P1b) | top-3 per zone by coverage | **unchanged** — zone is already the right scope; two raids in one zone SHOULD share buff reporters (the landings are zone-redundant regardless of raid) |
| Buff/debuff/cure queue | one raid-wide queue | scoped to the requester's `raid_id` (their healers/targets only), same-zone-first logic unchanged inside the raid; null-raid users see today's behavior |
| `/raid` page + Command Center | one raid | a raid selector appears ONLY when >1 live (default: the viewer's own raid via their characters; officers can switch). Single raid: no selector rendered at all |
| Comp matcher (#93) | one actual roster | "actual" column picks per `raid_id`; selector same rule as above |
| Encounters/parses | dedup by (npc, ±30min) | mostly self-partitioning: different targets → different encounters already. Same-name boss fought by BOTH raids simultaneously (two instances) is the KNOWN serialization bound — attribute by submitter∩raid-membership: if an encounter's contributors all belong to one raid, tag it; mixed/unknown → untagged (today's behavior). Never split a merge on raid_id alone |
| Boards/timers (`bosskill`, lockouts) | guild-global | **unchanged** — spawn timers are guild facts, not raid facts |
| 📡 Reporters panel / fleet | flat list | add a RAID column (leader name) when >1 live; else omitted |
| Raid Night Review / #80 (future) | one night, one raid | reviews render per `raid_id`; the null raid renders as today |

## 5. Synergy with the serialization bounds (#56)

Raid membership *improves* same-name-mob serialization: observer-anchored
target tracks (#56) gain a raid partition — 12 Rathe Council members split
between two task forces resolve into per-raid track sets, because we know
which observers belong to which raid. This is additive; the bounds in
`DESIGN-dedup-and-mob-serialization.md` (one track per locked observer,
parked-mezzed mobs dark) are unchanged.

## 6. Edge cases (decided now so implementation doesn't improvise)

- **Leader transfer**: §2 continuity rule; the internal `raid_id` is stable.
- **Member moves between raids**: their uploader's next snapshot re-keys them;
  per-member raid membership is always "latest fresh snapshot wins."
- **Two raids, same zone, same-name mobs**: tracked per §5; parse merging
  stays conservative (§4 encounters row).
- **Raid forms/disbands mid-fight**: `activeRaids` recomputes on the fresh
  window; a disbanded raid ages out in ≤15 min; its members fall to the null
  bucket (today's behavior).
- **One raid, but a stray solo uploader**: null bucket ≠ a second raid;
  `activeRaids` counts only real (leader-anchored) raids — a lone puller
  outside the raid never flips the UI into partition mode.
- **Snapshot disagreement** (one uploader lags): identity is per-uploader; a
  lagging snapshot only mis-tags that uploader's own rows, and the 15-min
  freshness window bounds the damage. No cross-uploader voting needed in v1.

## 7. Phased rollout (each phase independently safe + dark by default)

- **P0 — observe (bot `main`, S)**: derive `raid_id`/`raid_key` from stored
  rank data; log + expose on `server-panel/reporters` and the fleet panel
  (RAID column when >1). NO behavioral change anywhere. Ships the migration
  (nullable columns). Success = officers can SEE two raids exist.
- **P1 — partition the roster surfaces (bot+agent, M)**: election key
  `(raid_id, group_num)`; buff queue raid scoping; `/raid`+comp-matcher
  selector (rendered only when >1). Kill switch lands here.
- **P2 — attribution (M, later)**: encounter/review tagging per §4; Raid Night
  Review per-raid rendering. Only worth it once P0 shows real split-op
  frequency.

Tests: the election source-slices gain `(raid_id, group_num)` cases; a fixture
proves `activeRaids ≤ 1` renders byte-identical output to today's on every
touched surface (the #120 byte-compare pattern) — that fixture IS the "don't
break the primary path" guarantee, enforced in CI.

## 8. Non-goals (v1)

- No cross-raid DKP/loot semantics (OpenDKP owns that).
- No raid-vs-raid comparison UI.
- No attempt to identify raids without a leader-bearing snapshot (no
  composition-clustering fallback — leadership or null, nothing clever).
- No per-raid Discord threads/boards (timers stay guild-global).
