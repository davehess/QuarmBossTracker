# Death awareness across the overlays, and a rez queue

From Hitya, 2026-08-10 (Emperor Ssraeshza, the wipe sequence after Hawkner died):

> *"Hawkner is already dead but we still list him as the tank on the extended
> target window… Hawkner's still showing up as an off-heal candidate, at 32% HP.
> He should have a tombstone next to his name. Command center could use rezzes
> needed that loses its targets when they take the rez, and if a rezzer is using
> mimic and starts casting a rez while targetting that corpse we should be able
> to show that under the name."*

## The root gap: nothing asks "is this person dead?"

The agent detects deaths well — it discriminates feign from real death, waits for
the corpse-run confirmation tail, and back-patches it
(`packages/wolfpack-logsync/index.js` ~406, ~1045, ~2904, ~7115). But there is
**no `who is currently dead` set** that the overlays can consult, so every
live-state surface keeps rendering the dead as though they were alive.

Confirmed for the off-heal list, which has no death check of any kind
(`offHealCandidatesSnapshot`, ~4195). A player who died 20 seconds ago:

1. still has hits inside `offheal_window_sec`, so they survive the `byTank` build;
2. passes the letters-only real-raider name gate;
3. resolves an HP% from their **last** snapshot — 32% for Hawkner;
4. `32 < offheal_hurt_pct`, so they are published as someone to heal.

**This is compounded by the stale-HP defect** in
`DESIGN-threat-mt-margin.md` / the playbook: the cross-client branch of
`_resolveHpValuesForName` has no freshness gate at all, so a dead player's last
HP reading persists indefinitely. Either fix alone reduces the problem; both are
needed. Death is the correct primary signal — HP staleness is why the number
looked plausible enough to publish.

### Corpses are a free death signal we already parse

The Extended Target targeter list showed **`Atlasius's corpse`** among the
raiders targeting the boss. Corpses cannot target anything — that entry is a
corpse entity carrying the target it held at death.

Two things follow. First, targeter lists must filter `'s corpse` entries.
Second, and better: **an entity named `<Name>'s corpse` is direct proof that
`<Name>` is dead**, available from data we are already reading. The agent
already knows this shape — it strips the `'s corpse` suffix for Mob Info cache
keys (~28344). Use it as a corroborating death signal, especially for raiders
whose own death line we never saw (out of range, not running Mimic).

### Fix

Maintain a death registry — `nameLower → { diedAtMs, source }` — cleared on rez,
zone change or fight end, and consult it in every surface that names live
raiders:

| Surface | Today | Should |
|---|---|---|
| Off-heal candidates | publishes the dead at their last HP | exclude outright |
| MT / tank resolution | keeps the dead tank listed | fail over, and mark the old MT dead |
| Extended Target targeters | lists `X's corpse` | filter corpses, show the living count honestly |
| Anywhere a raider is named | no indicator | **tombstone marker** next to the name |

Hitya asked specifically for the tombstone rather than removal in some places —
a dead tank should be *visibly* dead, not silently absent, because "who died"
is itself the information during a wipe.

## Rez queue on the Command Center

A section listing corpses that need a rez, which **drops an entry when that
person takes the rez**, and shows an in-flight rez under the name.

Buildable on rails that already exist:

- **The corpse list** — the death registry above, plus corpse-entity sightings.
- **"A rezzer is casting on this corpse"** — the `casting` cross-client relay
  already carries casts between clients, and the threat snapshot already carries
  each uploader's own Zeal target (`target_name`, added 2026-08-04). A rezzer
  running Mimic who targets a corpse and starts casting gives us both halves:
  who is casting, and on whom. Render as a line under the corpse: *"Uilnayar
  casting Reviviscence"*.
- **Clearing on accept** — the rez landing is observable; failing that, the
  player reappearing alive in raid roster / live-state clears them.

### Bounds worth stating before building

- **A non-Mimic rezzer is invisible.** Their cast never reaches the relay, so the
  corpse will sit in the queue looking unclaimed while someone is mid-cast. Show
  the claim as extra information, never as an authoritative "this one is taken" —
  two clerics double-rezzing because the overlay said nothing is a smaller cost
  than one corpse everyone skips because the overlay lied.
- **Rez accepted ≠ rez cast.** The player chooses when to take it. The queue
  should distinguish *rez offered* from *back up*, or it will clear corpses that
  are still on the floor.
- **Feign death must never enter this queue.** The existing feign-vs-death
  discrimination is the gate; a monk in the queue as a corpse is exactly the
  false positive that would get the feature turned off.

## Also from this sequence — not death-related

**The "Hide trigger alerts + timers" tooltip lingers and covers the mob name** on
the Extended Target header. A tooltip that outlives the hover and sits over live
raid data is a straightforward defect: shorten the delay and dismiss on pointer
leave rather than on timeout.
