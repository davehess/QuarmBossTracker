# Dedup, load-shedding, and same-name mob serialization — the bounds

*Written 2026-07-17 pm, from Hitya's Rathe-Council question. This is the mental
model for where deduplication is safe, where it silently drops data, and what we
can and cannot do about identically-named mobs without a spawn id from Zeal.*

## The one principle everything follows from

**You can only safely deduplicate a stream that is IDENTICAL across observers.**

Split every stream we collect into two classes:

- **Redundant** — every raider who's present sees the *same bytes*. Uploading it
  N times is pure waste. Dedup to the fewest reporters that still cover it.
- **Per-observer** — each raider's view is *unique*: a different mob being
  babysat, a different target, a different vantage on the fight. Here N uploads
  are N *different facts*. Dedup = **data loss**. These must take **every**
  observer and merge.

The failure mode Hitya flagged — "if we're not pulling from each of those groups
we're missing this" — is what happens when you dedup a *per-observer* stream. So
the guardrail is: **the reporter election never touches a per-observer stream.**

## The classification (this is `STREAM_CLASS` in the bot)

| Stream | Class | Why |
|---|---|---|
| chat (`/gu`·`/rs`) | **redundant** | byte-identical everywhere → one reporter |
| buff landings | **redundant_zone** | identical within a zone → 1–2 per zone |
| raid roster | **per_group** | composition redundant, but HP comes per-group |
| live-state, threat, casting, target-casts | **per_observer** | each client's own vantage |
| encounter (the parse) | **per_observer** | merged max-per-player across everyone |
| buff-lag-report | **redundant_zone** (rides the buffs role) | diagnostic "buffs feel laggy" click — N raiders in one zone feeling lag report the same fact; gate agent-side on `roles.buffs`. Local snappy-mode is set *before* the upload so a stood-down agent's own UX is unaffected. No new class/flag. |
| debuff-clear | **per_observer / control action — NOT deduped** | a manual "✓ cured" click that suppresses an *inferred* debuff chip RAID-WIDE, from *any* clicker. Gating it would silently drop a non-elected raider's click — breaking both its local cache-clear feedback and the raid-wide suppression the feature promises from anyone. It's a rare, idempotent, deliberate action (no streaming amplification to dedup), so it stays ungated. |

`per_observer` streams have **no dedup flag** — no feature flag can ever thin
them. The control plane can only dedup the redundant classes. Two click-driven
endpoints were audited (2026-07-18) for bypassing election: **buff-lag-report**
is a redundant diagnostic and now rides `roles.buffs` (smallest correct gate,
fail-open); **debuff-clear** is a per-actor control action and is deliberately
left ungated (see the table).

## Why the parse is already robust (and roles don't matter there)

The encounter parse is per-observer + merged: every Mimic uploads its own view,
the bot takes the **best view of each player** (max damage, union of deaths, the
fullest tank perspective). So the role concerns — tanks die early, rangers are
out of range, monks/rogues are off pulling — are *completeness* problems that the
merge already solves. A tank who died at 30% contributed 30%; someone else saw
the rest. **We never pick "the one good observer" for the parse; we stitch the
best view from all of them.** Picking a single reporter there would be the bug.

## The hard part: same-name mobs, no spawn id

Zeal's pipe gives the target/pet gauge as **name + HP‰ only** — no spawn id, no
loc, no level (four `an orc warrior` were byte-identical in a live capture; see
`docs/zeal-spawn-id-request.md`). The combat log also names mobs **by name only**.
So two identically-named mobs alive at once cannot be told apart from the raw
data. That's a real, upstream limit — not a code bug.

### What we *can* do: anchor mob identity to the observer

Without a spawn id, the stable handle on "which mob" is **the raider currently
engaged with it**. "Xarl's target" and "Gron's target" are two distinct
mob-tracks even when both read `a Rathe Council member`, because they're two
different observers with independent HP trajectories. HP-continuity over time
keeps each track coherent; a big HP jump under one observer means their *target
changed*, not that the mob healed.

So the number of simultaneous same-name mobs we can serialize =
**the number of distinct observers actively target-locked on them, one mob per
observer at a time.** For a *babysit* fight that's exactly the right unit: each
babysitter is one mob-track.

### Rathe Council, walked through

12 Rathe Council members, must all die inside ~6–7 min or respawn. Say: 3
enchanters mezzing + holding 6 of them, and a tank+healer kiting 1 at a time.

- **Trackable (has a live observer):** each enchanter's *current target* (3
  mobs) + the tank's kited mob (1) = **4 mob-tracks**, each cleanly serialized by
  observer + HP-continuity. Every one of those groups' uploads must be kept — this
  is the per-observer rule; deduping them to "one raid reporter" would erase the
  splinter groups entirely.
- **Dark (no live observer):** the mobs sitting *mezzed but not targeted* by
  anyone. An enchanter holding 2 can only have 1 as their target; the other is
  invisible until re-targeted. So we'd see the enchanter's rotation as **one
  track whose HP jumps**, not as the 2–3 real mobs behind it.

### The bounds, stated plainly

- **Dedup bound:** only redundant streams. Buffs → 1–2 observers per zone by
  coverage (who's seeing the most landings — a ranger in the corner self-selects
  out). Everything per-observer → keep all, merge. This is enforced in code, so a
  mis-set flag can't cross the line.
- **Mob-serialization bound:** we can individually track **as many simultaneous
  same-name mobs as there are raiders actively target-locked on them** — one per
  observer. Beyond that (parked-mezzed mobs, or ≥N same-names with <N observers)
  they collapse. We do NOT get true per-mob identity for 12 identical names at
  once.
- **What survives regardless:** the **aggregate** (total damage dealt to
  `a Rathe Council member` across all 12, from every raider's combat log) and
  **sequential** same-name kills (death-boundary segmentation, #47/#51). What we
  lose is *per-individual-mob* damage split among ≥N simultaneous identical names.

### Consequence for design

Don't build a feature that needs true identity for N≥3 *simultaneous* same-name
mobs off the current data — it can't be trusted. Do build:
1. **Observer-anchored target tracks** (#56) — one coherent HP track per raider's
   target, so the babysat mobs each show up as their own thing on cross-client
   Mob Info instead of over-merging by name. This is the honest, buildable win.
2. **The aggregate + sequential segmentation** (#47/#51) for parse totals.
3. The clean fix stays upstream: `spawn_id` on the two gauges
   (`docs/zeal-spawn-id-request.md`). Everything above is the best we do until
   Zeal (or a surfaced tag) gives it to us.

## The control plane (built 2026-07-17)

`reporter-poll` now serves, per agent: `roles` (which redundant streams to
upload), `flags` (which redundant streams are *actively* deduped — `dedup_chat`
ON by default, `dedup_buffs`/`dedup_roster` OFF), and `streams` (the
classification above, so the fleet and dashboards can see the guardrail). Flags
read live from the tuning map; `flag_disable_reporter_election` is the global
kill switch. Per-observer streams appear in `streams` as `per_observer` and have
no flag — the guarantee that mob/target/encounter data is never deduped is
structural, not a setting someone can fat-finger.

**P1b (built 2026-07-18):** buff-landing election is live. The bot counts each
uploader's DISTINCT (spell, target) landings over a rolling 10-min window
(in-memory, GC'd — no Supabase writes), groups live agents by their heartbeat
zone, and elects the top **3 per zone** by coverage (tiebreak = the stable
name/id rank; latency is not a criterion). `reporter-poll` returns
`roles.buffs = dedup_buffs ? electedForMyZone : true`. The agent honors it in the
buff_casts path — EXCEPT `is_charm_spell` rows (agent-synthesized per-observer
charm timers, no log line for other clients), which always upload. Fail-open
throughout: bot down / flag off / zone unknown / cold coverage → everyone
uploads. Gated behind `dedup_buffs` (default OFF) on `/admin/overlays`.

**P1c (built 2026-07-18):** roster election is live — **one reporter per raid
group**. Roster composition is identical from every raider's view, but per-member
HP arrives only for the uploader's OWN group's Zeal gauges, so the dedup unit is
the group, not the whole raid. The bot partitions live agents by the `group_num`
each sends in its reporter-poll heartbeat (derived agent-side from the Zeal raid
pipe for its primary character — the mechanism already wired end-to-end, so no
new plumbing) and elects the top 1 per group by the stable name/id rank. An agent
with an unknown/missing group is its own singleton (fail-open — always elected).
`reporter-poll` returns `roles.roster = dedup_roster ? electedForMyGroup : true`;
the agent honors it in the raid-roster upload path with the same fail-open
staleness rule as chat/buffs. Gated behind `dedup_roster` (default OFF) on
`/admin/overlays`. **Write-path (item 2.1):** the ingest is now a plain
per-uploader upsert (merge-duplicates) instead of DELETE-then-upsert — one round
trip, no mid-refresh vanish window; departed members age out via the readers'
existing `captured_at >= now-15min` window (unchanged), and a daily midnight
prune bounds table size.

**Camp-out early handoff (built 2026-07-18, guild-lead request):** a raider who
types `/camp` is ~30s from vanishing. The agent detects the camp-start log line
(`/prepare your camp/i`), sets a `camping` flag, and fires an IMMEDIATE
reporter-poll with `camping: true` (the abandon line `/abandon your preparations
to camp/i` clears it, also immediate). The bot stores `camping` per registry
entry and **every** election (chat, buffs, roster) drops camping agents from
candidacy — UNLESS a camper is the only live candidate in its scope, in which
case it keeps reporting (fail-open, `_dropCampers`). This starts the handoff to
a live agent ~30s before the 60s TTL would notice the logout; actual logout is
still the TTL's job. Per-observer streams have no roles, so camping can never
touch them — the structural guarantee holds.

**Next:** the observer-anchored target tracks (#56) so Rathe-Council babysit
groups render as distinct mobs — designed below (2026-07-19), implementation
pending.

---

## Serial tracks on Extended Target / Target Info (#56 design, 2026-07-19)

*From Hitya's risk framing: in-game mob HP is the same for every observer — the
variance is OURS (sampling moments + sink latency). A mob we recorded at 86–88%
may truly be at 84%, and a DIFFERENT same-name mob passing through that window
must never capture the first one's debuff timers. False positives are the
failure mode that matters; both-mobs-on-one-tank is the case where the obvious
discriminator (victim) goes blind.*

### The asymmetry that decides the architecture

Every trustworthy signal is a **separator** (proves two tracks are DIFFERENT
mobs). No signal we have is a trustworthy **joiner**:

| Signal | As separator | As joiner |
|---|---|---|
| Simultaneous distinct melee victims | ~certain (one melee target per mob) | same victim proves nothing (two mobs, one tank) |
| HP divergence at overlapping ts (> sampling tolerance, or opposite trends) | strong | HP proximity proves nothing (the 84%-vs-86–88% trap) |
| Victim positions far apart (victim XYZ ≈ mob XYZ while meleeing; we have raider loc, never mob loc) | strong (beyond melee reach + noise, same-zone) | proximity proves nothing (camps overlap) |
| Death line | closes exactly one track | — |

Therefore: **tracks never auto-merge. Ever.** The engine only ever SPLITS
(on separator evidence) and EXPIRES (death/staleness). Where two tracks might
be the same physical mob, the UI says "possibly same as #2" — honest ambiguity
— instead of destructively merging and risking timer capture. Double-counting
is handled by the marker, not by a join.

### The K-invariant (same pattern as multi-raid's activation rule)

Per mob name, `K` = the number of simultaneous distinct tracks PROVEN by
separators. **While K=1, everything renders exactly as today** — the single
merged row, name-keyed debuffs, no badges. Partition display activates only at
K≥2, only for that name, and a control-plane flag collapses it back instantly.
The common case is structurally untouchable, and a quiet fight can never flip
into serial mode by accident.

### Track semantics (the false-capture rules, stated as law)

1. A track is anchored to observer-continuity: one observer's target gauge
   between target changes = one track. The existing HP-jump rule marks a
   RETARGET (new track), never a heal — and a rise from 0/death always starts
   a new track (respawn), never continues the old one.
2. **Debuff/timer attribution is per-landing, per-track**: a landing observed
   by caster C binds to the track of C's current target at cast time. A track
   NEVER inherits timers from another track — not on HP proximity, not on
   victim overlap, not on anything. Timers die with their track.
3. Cross-observer: two observers' tracks for the same name stay separate rows
   unless K=1 (then the name-merge is provably safe and we keep today's
   behavior). At K≥2 with weak same-mob evidence (same victim + HP within
   tolerance ±2pts over ≥3 overlapping samples + no separator), rows show a
   link marker ("≈ #2"), each keeping its own timers.
4. Parse aggregation is UNCHANGED — damage totals stay name-keyed with
   death-boundary segmentation (#47/#51). Serial tracks are a LIVE-DISPLAY
   layer; they never split encounters.

### Components to build (each dark behind the flag)

- **C1 — Track engine (agent-side)**: per-name track store (anchor observers,
  HP series, victim series, landings, first/last seen) + the separator rules
  producing K. Victim extraction: ground in what the threat tracker already
  parses ("<mob> hits <victim>" lines) before adding anything new — the threat
  machinery likely carries this already (implementation must verify, not
  assume).
- **C2 — Extended Target serial rows**: at K≥2, one row per track — ordinal
  badge (`Rathe Council #2`), victim tag (`→ Xarl`, from #3's pending
  mob's-target feature — these compose), freshest HP with staleness dimming,
  and ONLY that track's debuff chips. At K=1: byte-identical to today (CI
  fixture, the #120 byte-compare pattern — the "don't break the primary path"
  guarantee, enforced).
- **C3 — Target Info disambiguation strip**: when MY target's name has K≥2:
  "2 distinct <name> tracked · this one: #2 · → you · slowed 0:42", debuff
  panel showing my track's chips, with other tracks' chips dimmed as
  informational ("on #1: tash") — visible but never conflated.
- **C4 — Cross-client assembly (bot)**: the ext-target proxy already carries
  every uploader's target+HP; add per-row track ids + K verdicts server-side
  so all clients agree on ordinals (ordinals are per-zone, per-name,
  first-seen ordered, stable until death).
- **C5 — Flags**: master tuning flag (default OFF for the beta soak; officer
  flips via /admin/overlays or the Mimic kill-switch card; instant name-merge
  restore) + a per-user overlay toggle. Both honored at render AND at the
  engine (flag off = engine idles, zero cost).

### Rollout

P0: C1+C5 dark (engine runs, logs K verdicts, renders nothing) — soak on real
raid nights and compare K against reality. P1: C2+C3 display at K≥2. P2: C4
cross-client ordinal agreement. If it gets messy at any phase, the flag
restores today's behavior with no deploy — and the K=1 fixture guarantees the
primary path never noticed any of it.
