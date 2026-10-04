# Design — a live top-down map from Mimic's coordinates (feasibility, 2026-10-04)

Status: **options, awaiting the guild lead's pick.** No code. Extends DECISIONS-2026-09-21 §131 (website zone
map "A", then Mimic overlay "B", "but not yet").

Trigger: the guild lead, 2026-10-04: *"what would it take create a 3d topdown visualizer based on mimics
character coordinates? … relative positions of group members are in the zeal pipe for group and raid members
so they can be displayed by the map. targets should have position and distance away, right? and we know where
non-pathing mobs live, pathers would be on a timer from when they spawn next with their offset from the last
kill for their spawn point. if we can triangulate where mobs are we can create real value and visibility for
[splits] and pulls"*.

## What the pipe gives (Zeal v1.4.8, `Zeal/named_pipe.cpp`)

| Data | On the pipe? | Notes |
|---|---|---|
| Self position + heading + spawn id | yes, type 3 | always |
| Group members' position + heading | yes, type 6 | |
| Raid members' position + heading | yes, type 5 | same-zone members only; already uploaded in `raid_roster` every 3 s |
| **Target**: spawn id, name, type, level, class, race | yes, new in 1.4.8 (Zeal PR #239, merged 2026-09-28) | **Mimic reads none of the new fields yet** |
| **Target position** (`target_loc`) | yes, **only within 250 units** | Zeal's source: "server policy… can't be used to locate spawns across a zone" |
| Pet position | **no** | Zeal's own map draws it; the pipe only sends `pet_id` |
| Any mob nobody has targeted | **no** | no position, range, bearing or id |

- So **triangulation is unnecessary**: for a targeted mob, `target_loc` is its position, and distance = target
  − self. For an untargeted mob, there is nothing to triangulate from.
- Axis order is settled from our own data: pipe `(x,y)` = `eqemu_spawn2 (y,x)`. Joined against kill
  positions: 78 of 305 single-spawn kills land within 100 units with the swap, 0 without. Zeal's
  `zone_map.cpp` agrees.
- Heading is 0–512, rotation direction unverified.

## World data

- **Mirrored:** `eqemu_spawn2`: 43,655 spawn points in 182 zones, with position, `respawntime`, `variance`
  and `pathgrid`.
- 24% of spawn points path (`pathgrid > 0`). Examples:
  - Plane of Water: 155 of 242.
  - Plane of Fire: 156 of 438.
  - Bastion of Thunder: 38 of 405.
- `eqemu_npc_types` carries `aggroradius` (median 60) and `assistradius`.
- **Not mirrored:** `eqemu_grid` / `grid_entries`, the pather routes. They are in the upstream dump; adding
  them is about 0.5–1 day.
- **Map wall lines:** Zeal compiles Brewall's maps into its DLL, so there are no files on disk to read.
  Brewall's page states no licence, so do not redistribute them; ask first. The fallback is the existing
  spawn-derived outline (`zone_outline()`, used by `web/app/pop/guide/ZoneMap.tsx`).

## Pathers, honestly

- **Tying a kill to its spawn point:**
  - Exact for the 928 of 1,758 PoP mob/zone pairs that have a single spawn point.
  - Weak otherwise: kills happen at camp, not at the spawn. The median kill-to-spawn distance is 164 units.
  - Better: spawn id plus `target_loc` at first sight (a new capture).
- **Respawn:** kill time + `respawntime` ± variance.
- **Position along a route:** needs waypoints, pauses, speed and route type, and decays within a minute or
  two of the last sighting. Show it as a fuzzy area, never a dot.

## Storage

- **Live view:** nothing stored. Mimic already holds every position locally.
- **Archive:** 72 raiders at 1 Hz for 4 h is about 100 MB a night raw, or about 9 MB packed per member-minute.
  It also needs a `docs/PRIVACY.md` retention change.
- **Context:** the database is at 3.27 of 8 GB and growing about 68 MB a day.

## Options (build / maintenance / runtime / change)

- **1 — Mimic radar: live, local, nothing stored.**
  - Shows: you, your group, your raid, your target with distance, static spawns with aggro and assist rings,
    and height shading.
  - Costs: 5–7 days / low / a 2D canvas plus one spawn file per zone / easy.
- **2 — Shared picture: one raid view, website plus overlay.**
  - Option 1, plus the mobs any raider has targeted and the pather routes.
  - Costs: 9–13 days / medium / a small poll every 2 s / medium.
- **3 — Replay and estimates: records the night and predicts pathers.**
  - Option 2, plus a replay, respawn timelines and fuzzy pather areas.
  - Costs: Option 2 + 8–12 days / high / about 9–100 MB a night / hard.

**Recommended first slice:** Option 1 on Mimic beta, in two layouts:
- **A:** a self-centred radar with range rings.
- **B:** a fit-to-zone map that follows you.

Build the drawing in one shared module so the website map (§131) reuses it. This flips §131's order;
the guild lead decides.

**Before options 2 and 3:**
- Ask server staff whether sharing mobs-seen positions and pather estimates across a raid is acceptable.
- Do a one-hour in-game check: a landmark, heading direction, and whether a far raider's dot keeps updating.
- Measure fleet adoption of Zeal 1.4.8: 5 players report a Zeal version, all 1.4.7.
