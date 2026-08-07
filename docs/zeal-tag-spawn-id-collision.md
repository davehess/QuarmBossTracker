# Bug report for Zeal: `/tag` applies by spawn id alone, ignoring the mob name it broadcasts

**Status:** draft to send upstream to [CoastalRedwood/Zeal](https://github.com/CoastalRedwood/Zeal).
Not a Wolf Pack change. Distinct from `zeal-spawn-id-request.md` — that one asks
for a NEW field on the named-pipe gauges; this one reports a defect in an
existing feature and asks Zeal to use a field it **already transmits**.

Evidence gathered live on Project Quarm, 2026-08-07, by Canopy + Adiwen +
Dafeet, captured independently by two Wolf Pack agents reading the tag channel.

---

## Summary

`/tag` broadcasts carry the tagged mob's **name** and its **spawn id**. On
receipt, Zeal appears to apply the tag to whatever local spawn holds that id —
**without comparing the name it was just sent**. Spawn ids are per-zone and
recycled, and in practice they are small and heavily overlapping between zones,
so a tag routinely lands on an unrelated mob in a different zone.

The name needed to reject the mismatch is already in the payload. This looks
like a one-comparison fix.

## The payload

Observed wire format on the tag channel (all three transports — `/tag chat`,
`/tag rsay`, `/tag gsay` — carry the same payload):

```
ZEALTAG | <text> | <mob name> | <spawn id>
```

Example, from a live capture:

```
ZEALTAG | 70% slowed | an ancient sentry | 39
```

The mob name is present and correct on **every** tag we have ever captured
(thousands of rows). The receiving client therefore has everything it needs to
verify that local spawn 39 is actually *an ancient sentry* before painting the
label on it.

## Evidence

### 1. A tag crossing zones onto an unrelated mob, ten hours later

Two independent captures of spawn id **39**:

| when (UTC) | mob | spawn_id | tagger | tag text |
|---|---|---|---|---|
| 02:28:26 | `an ancient sentry` | **39** | Jankzer | **`70% slowed`** |
| 12:33:41 | `Merdan Fleetfoot` | **39** | Canopy | `TAGGEDWITHSLOWBEFORE` |

At 12:33 the reporter was standing in front of **Merdan Fleetfoot**, a Surefall Glade NPC, and the nameplate read **`70% slowed`** — Jankzer's label from *an
ancient sentry*, a different mob in a different zone, tagged ten hours earlier.
The second row is the reporter deliberately re-tagging it to confirm.

Screenshots of the mislabelled nameplate are available on request.

### 2. The same class, four more times in one session

All observed within minutes, each a mob displaying a label belonging to a
different mob entirely:

| mob shown | spawn_id | label it wrongly displayed |
|---|---|---|
| `Arrivae Valleren` (Surefall Glade) | 45 | `DAFEET THIS` |
| `a bear cub` | 53 | `Jankpet` |
| `a brown bear` | 51 | `anotherdafeettag` |
| `Merdan Fleetfoot` | 39 | `70% slowed` |

Note the ids: **39, 45, 51, 53**. Low-numbered and dense — and that is not a
coincidence. See below.

### 2b. Why the collisions concentrate in low ids (measured)

Spawn ids are allocated in spawn order from a low base, and **every zone starts
from that same base**. Measured in one session:

| id range | what those spawns are |
|---|---|
| 17, 39, 45, 51, 53 | mobs standing in the zone since it booted |
| 2266 – 4029 | later respawns, allocated incrementally |

Two confirmations from the same session:

- **Ids are stable per zone, not churning.** `Merdan Fleetfoot` was spawn **39**
  at 12:33 and still spawn **39** at 13:12. So the `an ancient sentry` that held
  id 39 earlier that day was in a *different zone* — a true collision, not a
  recycled id within one zone.
- **Same-zone respawns do NOT reuse the id.** A killed `a bloodsaber defiler`
  (id 3250) came back as id **4029**. So the dangerous "same name, same id,
  different creature" case does not arise from ordinary respawning.

The consequence: the static, named NPCs that sit in a zone from boot — exactly
the mobs people tag — occupy the same low ids in *every zone at once*. Cross-zone
collision is therefore structural rather than unlucky, which matches every
observation above landing in the 17–53 range.

Note the mechanism is simply that an id belongs to a *spawn instance*: it dies
with the mob and the next spawn takes the next number. A mob that is never
killed keeps its boot-time id indefinitely. That is a useful safety property —
a stale tag can never re-attach to a respawned mob, because the respawn has a
new id — and it means the ENTIRE realistic risk is cross-zone, against mobs
that do not die. Which is precisely the static named NPCs people tag.

### 2c. How dense the collision band actually is (measured)

Every mob in one zone (Surefall Glade) tagged in a single sweep, 24 in total.
The named NPCs:

| spawn_id | mob | | spawn_id | mob |
|---|---|---|---|---|
| 11 | Livam T\`Lant | | 38 | Niera Farbreeze |
| 13 | Vesteri Nomanoi | | 40 | Lerian Wyndrunner |
| 14 | Salmekia Treherth | | 41 | Jhaya Wyndrunner |
| 16 | Te\`Anara | | 43 | Qomber Roblen |
| 17 | Gerael Woodone | | 44 | Sallah |
| 18 | Sequea Erthinon | | 45 | Arrivae Valleren |
| 34 | Corun Finisc | | | |
| 35 | Frenway Marthank | | | |

**Fourteen named NPCs inside a 35-integer window (11–45) — 40% occupancy of
that band, in one zone.** Every zone allocates from the same base, so a tag
broadcast with a low id has roughly even odds of finding *a* named NPC in
whatever zone the receiver is standing in. This is the quantitative reason the
bug is so visible in practice.

Cross-checks against tags taken two hours earlier in the same session:
`Gerael Woodone` was spawn 17 then and spawn 17 now; `Arrivae Valleren` was 45
then and 45 now. Both stable — so the `DAFEET THIS` label seen on Arrivae
Valleren, and the labels on the bears, came from *other zones*, not from local
id churn.

### 2d. Same-name separation at N=5

The same sweep caught five simultaneous `a brown bear` (ids 54, 55, 56, 57,
4363) and three simultaneous `a bear cub` (58, 140, 3802) — eight mobs across
two display names, every one distinguishable. All 24 tags in the sweep were
captured independently by two separate client installs with tagger, name and id
intact, so the cross-client relay is lossless at this volume.

### 3. Same-name mobs in different zones, live

Two players in different zones tagged mobs sharing the display name `a gnoll`:

| tagger | zone | mob | spawn_id |
|---|---|---|---|
| Adiwen | Qeynos Hills | `a gnoll` | 1578 |
| Canopy | Blackburrow | `a gnoll` | 2911 |

These ids happened not to collide, so nothing visibly broke. That is luck, not a
safeguard: had Blackburrow held a spawn 1578, Adiwen's label would have painted
onto it, and because the names match, *no* name check could have caught it
either. This is the case where clearing on zone change is the only defence.

## What we are asking for

**1. Compare the mob name before applying a received tag.** The name is already
in the payload. If it does not match the local spawn's name, drop the tag. This
alone fixes cases 1 and 2 above — the entire observed population of the bug.

**2. Clear the tag table on zone-in.** Tags survived a zone change and kept
rendering against recycled ids; case 1 shows one persisting for ten hours across
multiple zones. Clearing on zone change also covers case 3, which the name check
cannot.

Either change on its own removes most of the problem. Both together close it.

## What already works well

Recording this so the report is not read as a complaint about the feature —
`/tag` is the single most useful thing Zeal exposes to a companion tool, and
everything below was verified in the same session:

- **Same-name separation.** Four simultaneous `a decaying skeleton` (ids 2343,
  2857, 2266, 2450) and three simultaneous `a gnoll watcher` (1659, 2836, 2697)
  were each cleanly distinguished. This is information available nowhere else in
  the client's external surface — the named-pipe gauges expose name + HP only.
- **Cross-client relay.** A tag set by one player reliably reached other
  players' clients with tagger, name and id intact.
- **Append semantics.** `+`/`@` appends merge per-tagger on the nameplate while
  the broadcast carries only the appending player's own fragment, so consumers
  can reconstruct the merged string without ambiguity. The pipe-separated
  rendering (`TWO | THREE`) is local display only and never crosses the wire.

## Reproduction

1. Player A, in zone X, targets any mob and `/tag chat <label>`. Note the spawn
   id from the broadcast.
2. Player B, in zone Y, stands near a mob holding that same spawn id.
3. B sees A's label on an unrelated mob whose name does not match the name in
   the broadcast.

A faster variant, single player: tag a mob, zone, and look for the stale label
reappearing on a different mob in the new zone.

---

## Wolf Pack side (not upstream's problem)

Our own mirror has the same defect and is being fixed independently: the agent's
`_zealTags` map is keyed on bare spawn id with no zone component and is not
cleared on zone change, so it can hold two different mobs under one name. See
`packages/wolfpack-logsync/index.js` (`_applyZealTagMessage`).
