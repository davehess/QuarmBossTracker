# Design — Target Info history, Tank history, quest navigation (options, 2026-10-04)

Status: **options, awaiting the guild lead's picks.** The correctness fixes these depend on are being built
separately (see DECISIONS-2026-09-21 §152 when it lands).

Trigger: the guild lead, 2026-10-04:
- *"Target Info would be good to have a history (and filter for if we killed it or not) forward/back button
  based on spawn id on it so we could scroll back through these mobs and see the drops, as well as
  damage/tanking meter could have more history in it."*
- *"Maybe we make the catalog for quests an era/continent/plane separation in an easy big block way up top.
  the left/right can go through a specific quest or zone's quests, and we can drill down from top to bottom
  or up with the up button."*

## 1. Target Info history

### What exists

- **No per-target record of any kind.** The agent knows the current target's spawn id (Zeal 1.4.6+, about
  83% of characters send it), name, HP, zone and catalog drops. When a mob dies, its mana ledger and last
  casts are thrown away.
- **Spawn ids are per zone.** You get new ones on every zone entry, and the same id belongs to different mobs
  across a week. Key on zone plus id plus name.
- **"Killed or not"** comes from, best first:
  1. the target turns into the same id's corpse;
  2. it turns into a same-name corpse;
  3. its HP hits 0;
  4. a "slain" line, matched by name.
- ⚠ **Unverified:** whether an NPC's corpse keeps its spawn id on Quarm. It is measured for player corpses
  only. One live check settles it: target a mob, note the id, kill it, target the corpse.
- **Drops:** the catalog drop table, plus your own "You have looted" lines. There is no per-corpse loot
  record guild-wide.

### Shared groundwork (every option)

- An agent-side list of the last ~50 targets: zone, id, name, first and last seen, lowest HP, killed and how.
  About 12 KB, local only.
- Kept across a restart for about 24 hours. A restored entry is marked "id not joinable", because ids reset
  per zone visit.

### Options

- **A — Pager: ◀ ▶ step back through your targets in the same Target Info view.**
  - A past mob paints exactly like a live one, stamped "killed 4m ago".
  - A chip cycles All / Killed / Left alive.
  - The Loot tab shows its drops.
  - Costs: build medium / maintenance low–medium (every future live-only section must say how it looks for an
    old mob) / runtime tiny / change low–medium.
- **B — Ledger: a ⟲ tab lists recent targets as rows; click one to open it.**
  - Rows show name, zone, killed / left / unknown, last HP, how long ago and items looted.
  - Same family as the meter's fight list.
  - Costs: build medium–large / maintenance medium (two views) / runtime small / change medium (columns and
    sort are what gets iterated).
- **C — Kill log: a "Recent kills" list under the Loot tab's drop table, no pager.**
  - Each row expands to the catalog drops plus what you looted.
  - Costs: build small–medium / maintenance low / runtime small / change **high**: wanting Stats or Spells
    for an old mob later means throwing it away for A or B.

**Recommended:** A, with C's "looted" chip folded in.

## 2. Tank history

### What exists

- The Tank tab is live only. It blanks 2 minutes after a kill.
- The fix in progress starts **storing** damage taken and the biggest hit per player in each saved fight, but
  doesn't show them yet.
- Damage shield per tank is folded into the tank's damage today.

### Options

- **A — Same list, both tabs: picking a fight in History shows it on whichever tab is open.**
  - DPS shows damage; Tank shows damage taken, biggest hit and damage shield.
  - Costs: build medium / maintenance low (one list) / runtime small / change low.
- **B — One fight card: the picked fight shows DPS and Tank columns side by side.**
  - Costs: build medium / maintenance medium (a third layout) / runtime small / change medium. The card gets
    wide, which works against the narrow default overlay.

**Recommended:** A.

## 3. Quest navigation in the PoP overlay

### What exists

- **◀ ▶ step one flat list** of 83 steps and wrap at the ends. A native drop-down lists them in 8 groups.
- **No plane tag on the steps:**
  - Steps carry six levels (Before the planes, Tiers One–Four, Plane of Time), but no plane, era or continent.
  - Planes of Power has no continents.
  - Working the plane out from where the steps happen covers only 66 of 83 steps, and about 30 sit in the hub
    zones (Tranquility, Knowledge).
  - So both options need one hand-set plane tag per step, with a test that fails on an untagged step.
- **Wider catalog:** the "era" level only matters once quests from other expansions are added (STATUS:
  "quest catalog overlay"). Today it would be one block, Planes of Power.

### Options

- **A — Drill-down blocks (the guild lead's description): big tap-blocks for era → plane → step.**
  - ▲ climbs a level.
  - ◀ ▶ stay inside the plane you're in.
  - Costs: build 1.5–2 days / maintenance medium (every new step needs its plane; a test forces it) / runtime
    tiny / change medium (the navigation stack is code; changing the number of levels touches rendering and
    ◀ ▶).
- **B — Two fixed rows: era blocks over plane chips, one tap from anywhere, no drilling and no ▲.**
  - ◀ ▶ stay inside the chosen plane.
  - Costs: build ~1 day / maintenance low–medium (same plane tags) / runtime tiny / change low (a CSS grid, no
    navigation state). It costs some permanent height on a small overlay.

**Open question for both:** at the end of a plane, does ▶ stop, wrap, or hop to the next plane?

**Recommended:** A. It's the guild lead's own description, and it scales to more eras.
