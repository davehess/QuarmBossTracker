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

`per_observer` streams have **no dedup flag** — no feature flag can ever thin
them. The control plane can only dedup the redundant classes.

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
ON, `dedup_buffs`/`dedup_roster` OFF until P1b/P1c), and `streams` (the
classification above, so the fleet and dashboards can see the guardrail). Flags
read live from the tuning map; `flag_disable_reporter_election` is the global
kill switch. Per-observer streams appear in `streams` as `per_observer` and have
no flag — the guarantee that mob/target/encounter data is never deduped is
structural, not a setting someone can fat-finger.

**Next:** P1b buff election (coverage-per-zone), P1c roster (per-group), and the
observer-anchored target tracks (#56) so Rathe-Council babysit groups render as
distinct mobs.
