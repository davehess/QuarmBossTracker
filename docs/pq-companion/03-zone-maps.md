# 03 — Live zone maps

Comparative analysis: how `pq-companion` builds zone maps, live position plotting and
spawn routes; what Wolf Pack already has that would feed the same feature; and a
concrete phased build plan for a Mimic **map overlay**.

**Legal:** `pq-companion` ships **no licence — all rights reserved**. Everything below is
description, file:line citation, and *facts* (file formats, coordinate maths, measured
values). Two short excerpts are marked as quotes. **Every code sketch in §3 is original**,
written to Wolf Pack's own house style — nothing is transcribed or adapted from their tree.

---

## 1. Their map pipeline, end to end

### 1.0 Two independent geometry sources

They deliberately run *two* sources, and it matters for our plan because only one of them
is cheap:

| Source | Built by | Ships as | Cost to reproduce |
|---|---|---|---|
| **Own extraction** — geometry lifted from the EQ client's `.s3d`/WLD zone meshes | `backend/cmd/mapgen/main.go` + `backend/internal/mapgen/*` (~3.6k lines Go) | a bundled ~4 MB `maps.db` SQLite artifact | **very high** — PFS/WLD readers, walkable-face classification, three extraction techniques, SVG comparison harness |
| **User-installed `.txt` map pack** (Brewall / mapfiends style) | nothing — read in place off the player's disk | nothing; the mode appears iff a pack is detected | **low** — ~280 lines of parsing |

`backend/internal/mapfiles/mapfiles.go:1-14` states the reasoning: packs are published with
no licence or redistribution terms, so bundling them is the most exposed position, but
*reading* files the user chose to install copies nothing. That is exactly the posture we
should adopt, and it means **the entire `mapgen` half is skippable for us** (see §4 skip list).

### 1.1 The `.txt` map-file format

Two line kinds, comma separated, documented at `mapfiles.go:182-189`:

```
L  x1, y1, z1, x2, y2, z2, R, G, B          ← one drawn line segment
P  x,  y,  z,  R, G, B, size, label         ← one labelled point marker
```

Facts established by their parser and measurement notes:

- **Coordinates are already in "map space"** (`mapfiles.go:26-30`) — no transform needed on
  ingest. See §1.3.
- Underscores in labels are spaces (`mapfiles.go:243-245`); the label is the *last* field and
  is re-joined from field 7 onward so a stray comma inside a label doesn't truncate it
  (`mapfiles.go:237-239`).
- Malformed lines are skipped, never fatal (`mapfiles.go:186-189`) — these are hand-edited
  files with two decades of drift.
- Coordinates outside ±32767 are treated as corrupt, not distant, because the renderer packs
  to `int16` (`mapfiles.go:251-265`).
- Scanner buffer is raised to 1 MB; some packs carry very long label lines (`mapfiles.go:192-194`).
- **Layers**: `<zone>.txt` plus `<zone>_1.txt` … `<zone>_10.txt`. Layer *numbering is a
  per-zone convention, not a standard* — in Brewall's set `oasis_1` is labels and `oasis_2`
  is a legend block — so they merge every layer rather than assigning roles by number
  (`mapfiles.go:148-180`).
- Corpus measurement (`docs/maps-feasibility.md` §14.1): Brewall 2024-01-09 = 1707 files /
  580 zones / **2,378,442 `L` lines + 34,000 `P` points**, zero file failures. **60.3 % of
  segments carry a non-black colour** — that colour is load-bearing (water is blue and
  nothing else marks it), which is the reason to render a pack in its own palette.
- Most *structural* lines are pure black (7984 of the Bazaar's 8818) because packs are drawn
  for a light background; they re-draw anything below a brightness floor in the neutral
  outline colour so it isn't invisible on a dark canvas.

### 1.2 Locating a pack on the user's disk

`mapfiles.go:59-63` — three candidate directories, relative to the EQ install root, tried in order:

1. `maps/Brewall` (the modern client's map-pack dropdown convention, which the published
   Brewall instructions describe)
2. `maps`
3. `map_files` (**Zeal's** external map data directory on Project Quarm)

Guard: a directory needs **≥ 25 distinct zones** to count as a pack (`mapfiles.go:76-81`).
That threshold exists specifically so their *own* marker exports written into `map_files`
aren't mistaken for a pack — a real regression test at `mapfiles_test.go:45-63`.

Zone enumeration folds `<name>_N.txt` back into `<name>` (`mapfiles.go:113-140`).
Detection is re-run on **every request**, not cached at startup (`backend/internal/api/maps.go:204-208`),
because installing a pack is something a user does while the app is open.

Pack naming: the folder name is the only self-description these files carry, so `Brewall`
is credited by folder name and a generic `maps`/`map_files` folder gets the neutral label
"Map pack" — they explicitly refuse to guess an author (`mapfiles.go:99-111`).

### 1.3 Coordinate transform — the exact formulas

This is the part worth copying verbatim as *knowledge* (all facts, independently verifiable).

**(a) DB/game space → map space** (`docs/maps-feasibility.md` §3):

```
map_f1 = -( game_x )      # == -spawn2.x
map_f2 = -( game_y )      # == -spawn2.y
map_f3 =    game_z        # unchanged, used for Z-level filtering
```

Negate X and Y, keep DB field order, leave Z alone. **No axis swap is involved** — the swap
people "remember" is an artifact of PQDI printing coordinates as `(Y, X, Z)`.

Verified against three landmarks in `qeynos2`; e.g. the Priest of Discord at DB
`(235.0, 6.0, 2.75)` appears in the reference file as `P -235.0000, -6.0000, -0.3738`.

**(b) Orientation / sign conventions** (`frontend/src/components/maps/ZoneMap.tsx:393-406`),
established from *game geography*, not from comparing renderings:

- East Commonlands borders West Commonlands at `game_x = -1621` in a zone spanning
  `-1666..3746` ⇒ **east is negative `game_x`**, i.e. `+game_x = west`.
- South Qeynos exits sit at `game_y = -151/-26` ⇒ **`+game_y = north`**.
- Therefore map space `f1 = -game_x` is **east-positive** and `f2 = -game_y` is
  **south-positive**.
- A north-up / east-right canvas needs screen X to grow with `f1` **and** screen Y to grow
  with `f2` — **no inversion on either axis**. Inverting Y mirrors every map vertically.
  (Canvas Y already grows downward, and `f2` already grows southward; the two cancel.)

> Their own methodology warning, quoted (5 lines, `docs/maps-feasibility.md` §5b.2):
> "An earlier pass tested only 4 of 8 orientations and compared bounding boxes, which agreed
> on a *mirrored* transform — both test zones are near-symmetric on that axis, so bounds
> cannot detect a sign flip. … **Always validate cartography visually, not just numerically.**"

**(c) Zeal named-pipe player payload → game space** (`backend/internal/zealpipe/events.go:56-72`)
— **this is the landmine, see §2.3**:

```
game_x = pipe.location.y        // NOT .x
game_y = pipe.location.x        // NOT .y
game_z = pipe.location.z
```

Their comment records the measurement: standing in the Bazaar at `/loc -784, -102`, the
arrow drew at map `(803, 108)`; the transposed reading predicts `(784, 102)` and the direct
reading predicts `(102, 784)` — the latter is 43 % of a map-width outside the zone's right
edge. Netherbian Lair agreed. Measured 2026-07-30.

**(d) Zeal `/map marker` clipboard args** (`frontend/src/lib/zealMap.ts:13-28`) — a
*different* convention again: `/map marker <y> <x> [label]` takes `spawn2.y, spawn2.x`
**un-negated**, because Zeal applies the map negation internally. Verified in game
2026-07-29 (`/map marker 6 235 Test` in North Qeynos landed on the Priest of Discord).
Labels must use underscores — Zeal parses with `%s` and stops at the first whitespace.

**(e) Heading**: EQ's `0-512` counter-clockwise value, `0 = north`, passed through
unchanged (`backend/internal/playerpos/tracker.go:29-30`). The renderer draws the player
triangle pointing up (`-Y`) and applies `ctx.rotate(-(heading / 512) * 2π)`
(`ZoneMap.tsx:712-714`).

**(f) Full screen transform** (`ZoneMap.tsx:407-469`) — fit-to-zone plus pan/zoom:

```
w = max(1, zone.max_x - zone.min_x);  h = max(1, zone.max_y - zone.min_y);  pad = 16
scale = min((canvasW - 2*pad) / w, (canvasH - 2*pad) / h)
offX  = (canvasW - w*scale)/2 - zone.min_x*scale
offY  = (canvasH - h*scale)/2 - zone.min_y*scale

screenX = (mapX*scale + offX) * zoom + panX
screenY = (mapY*scale + offY) * zoom + panY

# exact inverse, used for hit-testing and "place a marker here"
mapX = ((px - panX)/zoom - offX) / scale
mapY = ((py - panY)/zoom - offY) / scale
```

Wheel zoom is anchored at the cursor, not the centre (`ZoneMap.tsx:736-754`):
`next = clamp(zoom * 1.15^±1, 0.5, 40)`, `k = next/zoom`,
`panX' = mx - (mx - panX)*k`, same for Y. The listener is attached natively with
`{passive:false}` because React registers `wheel` as passive and `preventDefault()` is
ignored there.

Follow mode is written as a **pan correction**, not by deriving the transform from the
player each frame, so zoom and the fit maths stay untouched and switching follow off
doesn't snap (`ZoneMap.tsx:419-452`). It skips sub-pixel corrections or a stationary player
re-renders forever on every heartbeat.

### 1.4 Is the pack even the same zone? (`align.go`)

The dangerous failure mode: a modern pack renders *cleanly* and describes a **different
building** (the revamped Bazaar has a Plane of Knowledge zone line and gem-named trader
halls; Quarm is Luclin-era). Nothing looks wrong.

`backend/internal/mapfiles/align.go` matches labelled `P` points between the pack and the
server's own POIs **by normalised name** (`normalizeLabel`, `align.go:128-142`: letters and
digits only, ≥5 chars), takes the nearest candidate per name, and reports the **median**
pairwise distance.

The whole check hinges on **landmark category**, not count (`align.go:40-52`): only
`zone_line / tradeskill / succor / locked / switch / teleport / door` count. NPCs are
excluded — a pack labels a named mob where its author saw it, while their coords come from
`spawn2`, and that gap alone read as 3024 units in Vex Thal and 4474 in Temple of Veeshan
on zones whose line work is plainly the same place.

Calibration (`align.go:54-71`, `docs/maps-feasibility.md` §14.4): across Brewall's set,
73 zones are judgeable (≥3 fixed landmarks), median offset **7 units**, exactly two over
150 (`bazaar` 698, `highpass` 182). Threshold sits at **400**, in the gap. `< minLandmarks`
returns `Landmarks: 0`, which callers must treat as **unknown, never "fine"**.

Result is surfaced in **response headers** (`X-Map-Landmarks`, `X-Map-Offset`,
`X-Map-Mismatch`) because the body is packed binary (`api/maps.go:249-267`).

### 1.5 Serving geometry

`backend/internal/api/router.go:186-205` — the whole map surface:

```
GET /api/maps/status                     available + zone count
GET /api/maps/zones                      metadata for the zone picker (no geometry)
GET /api/maps/zone/{zone}                metadata + POIs
GET /api/maps/zone/{zone}/geometry?layer=N   packed binary segments
GET /api/maps/zone/{zone}/annotations    user markers (user.db, separate store)
POST/PUT/DELETE …/annotations            CRUD
GET /api/maps/external/status            is a .txt pack installed?
GET /api/maps/external/zone/{zone}       packed binary + RGB, from the pack
GET/POST/DELETE /api/maps/game-export    write our POIs into Zeal's map_files
```

Wire format (`api/maps.go:79-113`): **little-endian `int16` × 6 per segment**
(`x1,y1,z1,x2,y2,z2`) = 12 bytes; the external endpoint appends 3 RGB bytes = **15 bytes/segment**
(`api/maps.go:283-284`). Deliberately not JSON — a big zone is tens of thousands of segments
and JSON would be megabytes of braces for six small ints each. The renderer reads it
straight into an `Int16Array` (`frontend/src/types/map.ts:77-93`).

Caching: `maps.db` is immutable for the life of an install ⇒ `max-age=31536000, immutable`.
The **external** endpoint is `no-store` — those files can be replaced under you at any time
(`api/maps.go:230, 277-279`).

Storage: `map_layer / map_zone / map_poi` tables with **zlib-compressed packed blobs**, one
blob per layer rather than a row per segment (`backend/internal/mapgen/mapsdb.go:38, 162-201`).
Layers are `0 = geometry, 1 = detail, 2 = outline` (`frontend/src/hooks/useZoneMap.ts:5-8`).

### 1.6 Rendering (`ZoneMap.tsx`, 1234 lines)

**Canvas, not SVG** — a large zone as DOM nodes stalls badly while panning
(`ZoneMap.tsx:22-27`). Everything redraws from flat typed arrays.

Notable techniques, all of which we'd want:

- **Batched strokes.** One `Path2D`-style batch per *(opacity bucket × colour band)*, built
  in a single pass over segments, then one `stroke()` per bucket (`ZoneMap.tsx:531-562`).
  `globalAlpha` cannot vary inside a path, so a continuous alpha ramp would force one
  `stroke()` per segment — untenable at 20k+.
- **Depth window** (floor/ceiling pair, not centre±width) with a **graduated 4-bucket fade**
  rather than a hard cut, so off-level structure stays legible instead of vanishing
  (`ZoneMap.tsx:498-518`). Fade step scales with window width.
- **Auto-depth** from the player's own Z when the live position is on this map:
  `half = max(50, round(zone.z_span / 12))`, clamped to `[zone.min_z, zone.max_z]`
  (`ZoneMap.tsx:330-344`). Manual always wins and is never silently overridden.
- **Height colour ramp**, 7 stops cool→neutral→warm, deliberately sequential (never a
  rainbow — elevation is ordered data) and desaturated so POI pins stay dominant
  (`ZoneMap.tsx:167-220`). Anchored on the zone's **modal** height, not min/max: a linear
  stretch made Fungus Grove look like a thermal camera (`ZoneMap.tsx:222-268`). Bands beyond
  the modal one fade: `alpha = 1 - 0.13*|band - 3|`.
- **A pack's own palette replaces the ramp entirely** — hand-drawn colour is meaning
  (`ZoneMap.tsx:520-526`).
- **Label decluttering**: pins always drawn, only text suppressed when its box overlaps an
  already-placed label; labels only appear past `zoom > 1.8` (`ZoneMap.tsx:583-624`).
- **Casing-then-stroke** for highlights and the player arrow — a dark 4.5px casing under a
  2px coloured stroke, because a single stroke can't be relied on to contrast and white
  vanished into near-white outline geometry (`ZoneMap.tsx:671-706`).
- `chromeless` / `transparent` props exist specifically for overlay-sized windows: at 384px
  square the badge/legend/depth control cost a third of the width, and an opaque canvas
  background made the transparent overlay window come out solid black
  (`ZoneMap.tsx:97-115`).

### 1.7 Live position plotting

Chain, end to end:

```
Zeal named pipe  \\.\pipe\zeal_<PID>, line-delimited JSON envelopes
   type 3 = MsgPlayer { zone:int, location:{x,y,z}, heading, autoattack }
        ↓  zealpipe.DecodePlayer            (events.go:115-122)
        ↓  Location.GameX()/GameY()  ← THE TRANSPOSE (events.go:71-72)
        ↓  zone id → short name via GetZoneByZoneIDNumber   (cmd/server/main.go:1254-1260)
        ↓  playerpos.Tracker.Update(zone, gameX, gameY, gameZ, heading)
        ↓     applies X = -gameX, Y = -gameY   (tracker.go:85-93)
        ↓     rate limit + heartbeat            (tracker.go:33-63)
        ↓  hub.Broadcast(ws.Event{ type:"player:position" })   (main.go:1218-1221)
        ↓  usePlayerPosition() WebSocket hook   (frontend/src/hooks/usePlayerPosition.ts)
        ↓  <ZoneMap playerPos=… />              (ZoneMap.tsx:708-729)
```

Cadence and staleness rules — these are load-bearing and we should copy the *reasoning*:

| Constant | Value | Why (`playerpos/tracker.go`) |
|---|---|---|
| `minInterval` | **100 ms** | matched to the pipe's own `/pipedelay` default. Started at 200 ms "to be frugal"; halving the source rate is exactly what made the arrow read laggy next to the in-game one. |
| `heartbeat` | **2 s** | forces a frame even when nothing changed — otherwise "standing still" is indistinguishable from "pipe died", and the arrow would vanish precisely when a player stops to fight. |
| `moveEpsilon` | **0.4 units** | below perceptibility, not below a *guess* at it. The old 1.5-unit floor was over a screen pixel at overlay zoom and turned smooth movement into a jump every few frames. |
| `headingEpsilon` | **1.5 / 512** (~1°) | same reasoning; 2.8° of turn is plainly visible on an arrow. |
| `STALE_MS` (client) | **6 s** | > heartbeat so jitter never blanks the arrow. `usePlayerPosition.ts:17-27` calls this "the app's only defence against a stalled pipe" — a **frozen arrow is worse than no arrow because it still looks authoritative**. |
| zone unresolved | **do not broadcast** | an unplaceable position would draw the arrow at right coordinates on the *wrong map* (`tracker.go:83-84`). |
| pipe drop | **explicit `Reset()`** | null payload = "gone", honoured immediately, not by timeout (`tracker.go:141-146`). |

`ZoneMap.tsx:56-59, 430` re-checks `playerPos.zone === zone.zone` at every draw site — a
position from another zone must never be drawn.

### 1.8 Spawn routes / patrol paths

**Server data, not client geometry.** `backend/internal/db/npc_patrol.go:5-9` — waypoints
live in the emulator's `grid` / `grid_entries` tables and are in no `.s3d`, which is why no
downloaded map pack has them. That is the one thing their maps can do that a pack cannot.

Query shape (`npc_patrol.go:65-100`): `spawnentry → spawn2 (pathgrid > 0) → zone → grid`,
then `SELECT x, y, z, pause FROM grid_entries WHERE gridid=? AND zoneid=? ORDER BY number`.
**One route per spawn point, not per NPC** — the same mob can be placed at several points
with different grids.

Grid semantics (`npc_patrol.go:43-63`), which drive how it's drawn:

- `0` circular — walk in order, loop to start ⇒ `Ordered: true, Closed: true`
- `3` patrol — walk to end, reverse back ⇒ `Ordered: true, Closed: false` (18,504 of 22,824 grids)
- `4` / `6` one-way ⇒ ordered, not closed
- `1, 2, 5, 8, 9` random — the NPC *picks* a waypoint ⇒ `Ordered: false` (~1,349 grids)

A grid with one point is a facing marker, not a patrol, and is dropped
(`npc_patrol.go:124-127`). Waypoints get the same `-x, -y` negation as everything else
(`npc_patrol.go:118-121`).

Rendering (`ZoneMap.tsx:626-669`): **dashed** green polyline (a route is not a wall, and a
solid line reads as one), direction tick-marks every `len/12` waypoints, closed only for
circular grids. **Random grids get loose dots and no connecting line at all** — joining them
would draw a route the NPC never walks, "stated as confidently as a real one". The UI even
renames the toggle to "Roam area" vs "Patrol route" in that case (`NPCSpawnMap.tsx:225-228`).

### 1.9 Overlay window plumbing

- `electron/main/index.ts:280` — `liveMap` is one of 14 named overlays in a union type;
  `:316` default bounds `380×380`; `:1579-1630` `createLiveMapOverlay()` → frameless,
  `setAlwaysOnTop(true,'screen-saver')`, `setVisibleOnAllWorkspaces(…, {visibleOnFullScreen:true})`,
  loads route hash `#/live-map-window`; `:2642` restore-on-start; `:2735/:2756` name→window
  and name→create switches.
- Renderer: `frontend/src/pages/LiveMapWindowPage.tsx` (162 lines) — the *whole* overlay is
  a header + `<ZoneMap … chromeless transparent height="fill" />`. Zero map logic is
  duplicated.
- The same panel exists **docked** in the dashboard (`components/overlays/LiveMapPanel.tsx`),
  reading the same `maps.layers` cached preference, so layer choices follow between surfaces.
- Overlay-only policy decisions worth stealing: **outline mode only** (detailed layers are
  illegible at 380px), **no labels**, **follow-on by default but releasable** (dragging turns
  follow off, a reticle button restores it — "panning is never a one-way door"), and
  **follow is not persisted** ("an overlay should come back following you").

---

## 2. What we already have that feeds a map — and what's missing

### 2.1 Position data we are already collecting

| Data | Where | Cadence / scope |
|---|---|---|
| **Self position + heading**, live, in-process | Mimic absorbs Zeal type-3 into `s.loc = {x,y,z}` + `s.heading` at `apps/mimic/main.js:1509-1511`; forwarded to the agent via `POST /api/zeal-state`; surfaced on `/api/state` as `zealState[].loc` / `.heading` / `.zone` at `packages/wolfpack-logsync/index.js:29243-29244` | pipe cadence, throttled to ≈3-4/s into the agent |
| **Whole-raid positions + headings**, live, in-process | Zeal **type-5** decode at `packages/wolfpack-logsync/index.js:8214-8237` — `loc_x/loc_y/loc_z/heading` per member. Stashed locally as `_lastRaidPipe` (`:8158, :8245`) **before** any upload debounce, and already exposed on `/api/state` as `raidPipe` (`:10396`) | every type-5 fire, **local, no network** |
| Self position, cloud | `live-state` upload `loc_x/loc_y/loc_z` (`index.js:29045-29051`) → `character_live_state` | heartbeat-floor resend (position is deliberately *not* in the change signature) |
| Raid positions, cloud | `raid_roster` upload (`index.js:8235-8237, 8275`) → `raid_roster.loc_x/y/z/heading/loc_at` | composition-hash + `RAID_ROSTER_HP_HEARTBEAT_MS` |
| **Derived mob positions (cluster centroids)** | bot `origin/main:index.js` — `_extPosCluster` (`:9938-9979`) single-linkage 3-D clustering of engaged tanks, `_extBindInstances` (`:9992-10037`) welding HP clusters to position instances, fed by `locByName` built from `character_live_state` + `raid_roster` (`:10305-10323`) and `engagedByMob` (`:10326-10360`) | recomputed per `/api/agent/extended-target` poll (~2-3 s, 1.5 s memo) |
| **True mob spawn ids** | Zeal `/tag` broadcasts, `zeal_tags` (`index.js:29063+`, bot `:10375-10390`) | 600 s freshness |

**Two of these are much better than pq-companion's equivalents.** They plot *one* arrow
(their own player). We already carry **every raid member's position and heading from a
single Mimic install** via type-5, entirely in-process. And they have **no mob positions at
all** — our `#194` clustering derives per-instance mob locations from tank positions, which
is genuinely novel.

### 2.2 Gaps

1. **No map geometry, none, anywhere.** We ship no map files, read none, and have no zone
   outlines. Everything visual has to come from a user-installed `.txt` pack.
2. **No zone *short* name.** The agent resolves zone id → *long* display name only
   (`ZONE_NAMES` at `packages/wolfpack-logsync/index.js:27678`, `_zoneName()` at `:27681`).
   Map files are named `<short>.txt` (`netherbian.txt`, `qeynos2.txt`), so **we need a
   zone_id → short_name table**. ~230 entries; one-off `eqemu_zone` query, dropped in beside
   `ZONE_NAMES` (module-side, outside `WEB_HTML`, same as that constant).
3. **No EQ-root helper in the agent.** The pattern exists — `_crashDirs()`
   (`index.js:28807-28819`) derives the EQ root from `stats.watchedLogs[].logPath` by
   stripping a trailing `Logs` segment, honouring `WOLFPACK_EQ_DIR`. Needs generalising to
   `_eqRoots()` and reusing.
4. **Most Quarm users have no `.txt` map pack installed.** Zeal *embeds* map geometry inside
   `zeal.asi` (`docs/maps-feasibility.md` §4), so nobody on Quarm needs external map files
   for the in-game map to work. Expect the detected-pack rate to be **low**. This is the
   single biggest product risk — see §4.
5. **No canvas overlay precedent in Mimic.** All 19 overlays are DOM/`innerHTML`. Not a
   blocker, but it's new ground for the parity checklist (a canvas has no `<details>`, and
   `__wpHtml` guards only apply to the text chrome).

### 2.3 ⚠ The coordinate landmine — our tree and theirs disagree

This is the most important finding in the document.

**pq-companion, measured in game** (`backend/internal/zealpipe/events.go:56-72`, dated
2026-07-30, two zones):

```
game_x = pipe.location.y
game_y = pipe.location.x        ← the JSON keys are transposed
```

**Wolf Pack, inferred and inconsistent:**

- `docs/zeal-pipe-protocol.md:47-50` says `toJson(Vec3)` writes `{x,y,z}` from raw Zeal Vec3
  fields and "`/loc` prints **Y, X, Z** — so when matching /loc, **transpose**".
- `apps/mimic/main.js:1506-1508` repeats it: "these are the raw Zeal Vec3 fields (x,y,z),
  **transpose when matching /loc**".
- But the dashboard renders `'Y ' + loc.y + ', X ' + loc.x`
  (`packages/wolfpack-logsync/index.js:14171`, and again for group members at `:14196`) —
  that **re-orders the display without swapping the values**. Under our own doc's instruction
  that is the wrong operation; under pq-companion's measurement it is definitely wrong.

**Which of our consumers care?**

- **Immune:** the `#194` clustering. `_extPosCluster` uses Euclidean distance
  (`origin/main:index.js:9942`), which is invariant under an axis swap. Every K decision it
  has ever made is unaffected. Good news — no existing behaviour is at risk.
- **Affected:** `_extHeadingPoint` (`origin/main:index.js:9926-9931`) projects
  `(x + reach·sinθ, y + reach·cosθ)`. An axis swap **mirrors the plane**, which reverses
  handedness and therefore the *direction* heading rotates. Our own code already flags the
  convention as "⚠ UNVERIFIED" and ships `ext_pos_heading` defaulted to **0 = ignore
  headings** for exactly this reason. Consistent, and correct to have parked.
- **Catastrophically affected: a map.** A transposed plot mirrors the whole zone about the
  diagonal. It will look plausible — values stay in range, the dot tracks your movement —
  and be silently, completely wrong. This is §1.3's methodology warning, aimed straight at us.

**Action: a 15-minute in-game spike must precede any map work** (Phase 0, §3.0).

---

## 3. Build plan — a Mimic **map overlay** (`map.html` + agent endpoints)

Design stance, stated up front:

- **We read map packs, we never ship them.** Same posture as `mapfiles.go:1-14`. The mode
  appears when a pack is detected and disappears with it. No files in our installer, no
  files on our CDN.
- **We do not build a `mapgen`.** `.s3d`/WLD extraction is ~3.6k lines of Go, needs a copy
  of the client, and Zeal already draws zone geometry in-game. Out of scope forever.
- **The overlay is local-first.** Phases 1 and 2 need **zero** bot changes and zero Supabase
  reads — everything is already in the agent's process. Only Phase 3 touches the network.
- **Poll-render like `extarget.html`.** Canvas repaint every tick, `__wpHtml` guard on the
  text chrome only.

### 3.0 Phase 0 — verification spike (do this first, ~1-2 h, no code shipped)

Non-negotiable gate. In game, with Mimic running:

1. Stand still somewhere unambiguous. Run `/loc`. Note the printed `Y, X, Z`.
2. Open the dashboard's Zeal Pipe explorer → Position row (`index.js:14168-14175`) and read
   the raw `loc.x / loc.y`.
3. Compare. If `loc.x ≈ printed Y` then **pq-companion is right and our display is wrong**;
   the agent must expose `game_x = loc.y`, `game_y = loc.x`.
4. Repeat in a second, geographically asymmetric zone (their warning: symmetric zones cannot
   detect a sign flip). Suggested pairs: **East Commonlands** (east = negative `game_x`,
   spanning `-1666..3746`) and **South Qeynos** (exits at `game_y = -151/-26`, so
   `+game_y = north`).
5. Turn to face a known compass direction and record `heading`. That settles rotation
   direction and whether `0 = north`.

Record the outcome in `docs/zeal-pipe-protocol.md` **as a measurement with a date**, fix
`index.js:14171` / `:14196` if needed, and only then write map code. Whatever the answer,
put the conversion in **exactly one function** — pq-companion's `Location.GameX()/GameY()`
is the right shape and their `playerpos` package comment (`tracker.go:22-25`) makes the
point: one place in the codebase knows the transform.

### 3.1 Phase 1 — static zone map + self position

**Deliverables:** `apps/mimic/map.html`, agent endpoints `/api/map-state` and
`/api/map-geometry`, zone-short-name table, `_eqRoots()` helper, full parity wiring.

#### 3.1.1 Agent: the map-line parser (original)

Module-side in `packages/wolfpack-logsync/index.js`, **outside** `WEB_HTML` (it never goes
near the dashboard template, so the escape hazard doesn't apply):

```js
// ── Zone map packs (Brewall / mapfiends .txt) ─────────────────────────────
// We READ packs the user installed; we never ship or serve map files of our
// own. Format, two line kinds, comma separated:
//   L  x1,y1,z1,x2,y2,z2,R,G,B          one drawn segment
//   P  x,y,z,R,G,B,size,label           one labelled marker (label last)
// Coordinates are already MAP space (f1 = -game_x, f2 = -game_y, z as-is), so
// nothing is transformed on ingest — the transform lives at the Zeal boundary
// only (see _zealGameXY).
const MAP_PACK_SUBDIRS = ['map_files', path.join('maps', 'Brewall'), 'maps'];
const MAP_PACK_MIN_ZONES = 25;   // our own exports must never read as a pack
const MAP_LAYER_MAX      = 10;   // <zone>.txt + _1.._10
const MAP_COORD_LIMIT    = 32767;

function _mapParseLayer(text, out) {
  const lines = String(text).split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i].trim();
    if (raw.length < 2) continue;
    const kind = raw[0];
    if (kind !== 'L' && kind !== 'P') continue;
    const f = raw.slice(1).split(',');
    const num = (j) => {
      const v = Number(String(f[j]).trim());
      return (Number.isFinite(v) && Math.abs(v) <= MAP_COORD_LIMIT) ? Math.round(v) : null;
    };
    const rgb = (j) => {
      const v = Number(String(f[j]).trim());
      return (Number.isInteger(v) && v >= 0 && v <= 255) ? v : null;
    };
    if (kind === 'L') {
      if (f.length < 9) continue;
      const p = [num(0), num(1), num(2), num(3), num(4), num(5)];
      const c = [rgb(6), rgb(7), rgb(8)];
      if (p.some(v => v === null) || c.some(v => v === null)) continue;
      // Flat arrays, not objects: a big zone is 20k+ segments and this is
      // walked on every repaint.
      out.seg.push(p[0], p[1], p[2], p[3], p[4], p[5]);
      out.rgb.push(c[0], c[1], c[2]);
    } else {
      if (f.length < 8) continue;
      const p = [num(0), num(1), num(2)];
      const c = [rgb(3), rgb(4), rgb(5)];
      if (p.some(v => v === null) || c.some(v => v === null)) continue;
      // The label is the LAST field and hand-edited files do contain commas
      // inside it — rejoin from field 7 rather than taking f[7] alone.
      const label = f.slice(7).join(',').trim().replace(/_/g, ' ');
      out.pt.push({ x: p[0], y: p[1], z: p[2], r: c[0], g: c[1], b: c[2], label });
    }
  }
  return out;
}

// Merge every layer. Layer NUMBERING is a per-zone convention, not a standard
// (one pack puts labels in _1 and a legend in _2, another does neither), so
// roles are never inferred from the number.
function _mapLoadZone(dir, zoneShort) {
  const out = { seg: [], rgb: [], pt: [], files: 0 };
  const names = [zoneShort + '.txt'];
  for (let i = 1; i <= MAP_LAYER_MAX; i++) names.push(zoneShort + '_' + i + '.txt');
  for (const n of names) {
    let text;
    try { text = fs.readFileSync(path.join(dir, n), 'utf8'); }
    catch { continue; }                       // absent layer is ordinary
    out.files++;
    try { _mapParseLayer(text, out); }
    catch (e) { console.warn('[map] parse failed', n, e && e.message); }
  }
  return out;
}

// Pack detection. Re-run on request, not cached at startup: installing a pack
// is something a user does with Mimic already open.
function _mapDetectPack() {
  for (const root of _eqRoots()) {
    for (const sub of MAP_PACK_SUBDIRS) {
      const dir = path.join(root, sub);
      let names;
      try { names = fs.readdirSync(dir); } catch { continue; }
      const zones = new Set();
      for (const n of names) {
        if (!/\.txt$/i.test(n)) continue;
        let base = n.slice(0, -4);
        const u = base.lastIndexOf('_');
        if (u > 0 && /^\d+$/.test(base.slice(u + 1))) base = base.slice(0, u);
        zones.add(base.toLowerCase());
      }
      if (zones.size < MAP_PACK_MIN_ZONES) continue;
      const label = path.basename(dir);
      return {
        dir,
        // The folder name is the only self-description these packs carry. A
        // bare "maps"/"map_files" says nothing, and crediting the wrong author
        // is worse than crediting none.
        name: /^(maps|map_files)$/i.test(label) ? 'Map pack' : label,
        zones,
      };
    }
  }
  return null;
}
```

`_eqRoots()` generalises `_crashDirs()` (`index.js:28807-28819`):

```js
// Every EQ install root we can see: WOLFPACK_EQ_DIR, plus the parent of each
// watched log (stripping a trailing Logs\ segment). Same derivation the crash
// scanner already uses — factored out so the map pack scan and it agree.
function _eqRoots() {
  const roots = new Set();
  if (process.env.WOLFPACK_EQ_DIR) roots.add(process.env.WOLFPACK_EQ_DIR);
  for (const w of (stats.watchedLogs || [])) {
    if (!w || !w.logPath) continue;
    let d = path.dirname(w.logPath);
    if (/^logs$/i.test(path.basename(d))) d = path.dirname(d);
    roots.add(d);
  }
  return [...roots];
}
```

#### 3.1.2 Agent: the coordinate boundary (original, single source of truth)

```js
// ── The ONE place that knows Zeal's coordinate convention ────────────────
// Zeal serialises the player Vec3 as {x,y,z} straight off the client struct,
// whose field order is not the order the JSON keys suggest. Until the Phase-0
// in-game measurement is recorded here with a date, this function is the only
// thing that needs changing.
//   VERIFIED <date> in <zone A> and <zone B>: /loc printed (Y=…, X=…) while
//   the pipe reported loc={x:…, y:…}. Mapping below follows that measurement.
function _zealGameXY(loc) {
  if (!loc) return null;
  const a = Number(loc.x), b = Number(loc.y), z = Number(loc.z);
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(z)) return null;
  // ⚠ FLIP THESE TWO LINES, AND ONLY THESE, if Phase 0 says transposed.
  return { gx: a, gy: b, gz: z };
}

// Game space → map space. Facts, not preference:
//   east  = NEGATIVE game_x  (EC/WC border at game_x = -1621)
//   north = POSITIVE game_y  (South Qeynos exits at game_y = -151/-26)
// so map f1 = -game_x is east-positive and f2 = -game_y is south-positive.
// Canvas Y grows downward and f2 grows southward, so the two cancel: NEITHER
// axis is inverted when drawing. Inverting Y mirrors every map vertically.
function _gameToMap(g) {
  return g ? { x: -g.gx, y: -g.gy, z: g.gz } : null;
}
```

#### 3.1.3 Agent: endpoint shapes

Two endpoints, both localhost-only like every other dashboard route (no auth — matches
`/api/tank-state` at `index.js:19590`):

```
GET /api/map-geometry?zone=<short>
     → 200 application/json, ETag: "<mtimeMs>-<byteLen>"; 304 on match
       (a pack's files CAN be replaced under us, so key the tag on mtime rather
       than serving immutable)
     → 404 { error: 'no map pack' } | { error: 'no file for zone' }
{
  "zone": "netherbian",
  "pack": { "name": "Brewall", "dir": "C:\\EQ\\map_files", "zones": 580 },
  "bounds": { "min_x": -1620, "min_y": -980, "max_x": 640, "max_y": 1210,
              "min_z": -220, "max_z": 90 },
  "count": 8412,
  "seg":   [x1,y1,z1,x2,y2,z2, …],   // 6 ints per segment, MAP space
  "rgb":   [r,g,b, …],               // 3 bytes per segment, the pack's palette
  "pt":    [ { "x":…, "y":…, "z":…, "r":…, "g":…, "b":…, "label":"Marnan (Merchant)" } ]
}
```

JSON rather than pq-companion's packed binary because this is a **localhost** fetch made
**once per zone change**, and JSON keeps the overlay dependency-free. If a zone ever exceeds
~40k segments, switch `seg` to a base64 `Int16Array` in the same field — the overlay's
decode is one branch.

```
GET /api/map-state          ← polled ~4 Hz by the overlay
{
  "at": 1754500000000,
  "zone": { "id": 161, "short": "netherbian", "name": "Netherbian Lair" },
  "self": { "character": "Uilnayar",
            "x": 1042, "y": -234, "z": 12,        // MAP space, already converted
            "heading": 341, "live": true, "at": … },
  "raid": [ { "name": "Dafeet", "class": "Warrior", "group": "1",
              "x": …, "y": …, "z": …, "heading": …, "hp_pct": 88, "self": false } ],
  "raid_at": 1754499998000,
  "marks": [],                                    // phase 3
  "pack": { "found": true, "name": "Brewall", "has_zone": true }
}
```

Rules baked into the serializer, straight from `playerpos/tracker.go`'s hard-won list:

- **`zone.short === null` ⇒ `self` is `null`.** An unplaceable position must never be drawn
  on whatever map happens to be open.
- **`live: false` when `now - updatedAt > 6000`**, and the overlay must then draw the dot
  hollow or not at all. A frozen dot still looks authoritative.
- **Ship position on every poll**, no change-detection. It is a 4 Hz localhost JSON of a few
  hundred bytes; suppressing "unchanged" frames is how you make standing still
  indistinguishable from a dead pipe.
- Raid rows come from `_lastRaidPipe` (`index.js:8245`), **dropped entirely if older than
  30 s** — the same freshness rule the bot's `EXT_POS_FRESH_MS` uses.

#### 3.1.4 Overlay: `apps/mimic/map.html` render loop (original)

Two stacked canvases. The **geometry** canvas is repainted only when `(zone, view, size)`
changes — for a stationary, following player that is *never*, so the expensive 20k-segment
pass runs once per zone rather than 4×/second. The **actors** canvas is cleared and redrawn
every tick and only ever draws a handful of dots.

```html
<canvas id="geo"></canvas><canvas id="act"></canvas>
```

```js
// ── transform ──────────────────────────────────────────────────────────────
// Fit-to-zone, then pan/zoom. Screen X grows with map x, screen Y grows with
// map y — NO inversion on either axis (see _gameToMap in the agent for why).
var VIEW = { zoom: 1, panX: 0, panY: 0, follow: true };
var BASE = { scale: 1, offX: 0, offY: 0 };

function wpFitBounds(b, w, h) {
  var pad = 10;
  var zw = Math.max(1, b.max_x - b.min_x), zh = Math.max(1, b.max_y - b.min_y);
  var s  = Math.min((w - pad * 2) / zw, (h - pad * 2) / zh);
  BASE = { scale: s,
           offX: (w - zw * s) / 2 - b.min_x * s,
           offY: (h - zh * s) / 2 - b.min_y * s };
}
function wpSx(x) { return (x * BASE.scale + BASE.offX) * VIEW.zoom + VIEW.panX; }
function wpSy(y) { return (y * BASE.scale + BASE.offY) * VIEW.zoom + VIEW.panY; }

// ── geometry pass (rare) ───────────────────────────────────────────────────
// One batch per (colour, depth bucket) then ONE stroke per batch: globalAlpha
// cannot vary inside a path, so per-segment alpha would mean 20k stroke()
// calls. Colours are quantised to 5 bits/channel so a pack's palette collapses
// to a handful of batches instead of thousands of near-identical ones.
function wpDrawGeometry(G, depth) {
  var c = document.getElementById('geo'), ctx = c.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, c.width / DPR, c.height / DPR);
  if (!G) return;
  var batch = {}, n = G.count;
  for (var i = 0; i < n; i++) {
    var o = i * 6, k = i * 3;
    var r = G.rgb[k], g = G.rgb[k + 1], b = G.rgb[k + 2];
    // Packs are drawn for a LIGHT background, so most structural lines are
    // pure black and would be invisible here. Anything below the brightness
    // floor becomes the neutral outline colour; every colour that carries
    // meaning (blue = water, and nothing else marks it) is left untouched.
    var key = (r + g + b < 40) ? 'n' : ((r >> 3) + ',' + (g >> 3) + ',' + (b >> 3));
    var zm = (G.seg[o + 2] + G.seg[o + 5]) / 2;
    var d  = depth ? (zm < depth.lo ? depth.lo - zm : zm > depth.hi ? zm - depth.hi : 0) : 0;
    var bk = d === 0 ? 0 : Math.min(3, 1 + Math.floor(d / Math.max(1, (depth.hi - depth.lo) / 2)));
    (batch[key + '|' + bk] || (batch[key + '|' + bk] = [])).push(i);
  }
  var ALPHA = [1, 0.5, 0.24, 0.1];
  var keys = Object.keys(batch).sort(function (a, b2) {           // faintest first
    return Number(b2.split('|')[1]) - Number(a.split('|')[1]);
  });
  ctx.lineWidth = 1.1; ctx.lineCap = 'round';
  for (var q = 0; q < keys.length; q++) {
    var parts = keys[q].split('|'), idx = batch[keys[q]];
    ctx.strokeStyle = parts[0] === 'n' ? '#9aa4ad'
      : 'rgb(' + parts[0].split(',').map(function (v) { return Number(v) << 3; }).join(',') + ')';
    ctx.globalAlpha = ALPHA[Number(parts[1])];
    ctx.beginPath();
    for (var j = 0; j < idx.length; j++) {
      var p = idx[j] * 6;
      ctx.moveTo(wpSx(G.seg[p]),     wpSy(G.seg[p + 1]));
      ctx.lineTo(wpSx(G.seg[p + 3]), wpSy(G.seg[p + 4]));
    }
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ── actors pass (every tick) ───────────────────────────────────────────────
function wpDrawActors(S) {
  var c = document.getElementById('act'), ctx = c.getContext('2d');
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  ctx.clearRect(0, 0, c.width / DPR, c.height / DPR);
  if (S.raid) for (var i = 0; i < S.raid.length; i++) wpDot(ctx, S.raid[i]);   // phase 2
  if (S.self) wpSelf(ctx, S.self);
}

function wpSelf(ctx, p) {
  var x = wpSx(p.x), y = wpSy(p.y);
  ctx.save(); ctx.translate(x, y);
  // Facing wedge is behind a flag until the Phase-0 heading measurement is in.
  // A confidently-wrong arrow is worse than a plain dot.
  if (WP_HEADING_OK && p.heading != null) ctx.rotate(-(p.heading / 512) * Math.PI * 2);
  ctx.beginPath();
  if (WP_HEADING_OK) { ctx.moveTo(0, -7); ctx.lineTo(4.5, 6); ctx.lineTo(0, 3); ctx.lineTo(-4.5, 6); ctx.closePath(); }
  else ctx.arc(0, 0, 4.5, 0, Math.PI * 2);
  // Cased: a single stroke cannot be relied on to contrast, and near-white on
  // near-white map lines is invisible exactly where "where am I" matters most.
  ctx.lineWidth = 3; ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.stroke();
  ctx.fillStyle = p.live ? '#f8fafc' : 'rgba(248,250,252,0.35)'; ctx.fill();
  ctx.restore();
}

// ── poll ───────────────────────────────────────────────────────────────────
var _geoZone = null, _geo = null, _chromeHtml = null;
async function tick() {
  var S;
  try { S = await (await fetch('http://127.0.0.1:' + PORT + '/api/map-state', { cache: 'no-store' })).json(); }
  catch (e) { return; }
  var short = S.zone && S.zone.short;
  if (short !== _geoZone) {                       // zone change → refetch once
    _geoZone = short; _geo = null;
    if (short) {
      try { _geo = await (await fetch('http://127.0.0.1:' + PORT + '/api/map-geometry?zone=' + encodeURIComponent(short))).json(); }
      catch (e) { _geo = null; }
    }
    if (_geo) wpFitBounds(_geo.bounds, W, H);
    _dirtyGeo = true;
  }
  // Auto-depth from the player's own height: the single most useful thing the
  // Z data does, and it needs no control at all.
  var depth = null;
  if (_geo && S.self) {
    var half = Math.max(50, Math.round((_geo.bounds.max_z - _geo.bounds.min_z) / 12));
    depth = { lo: Math.max(_geo.bounds.min_z, S.self.z - half),
              hi: Math.min(_geo.bounds.max_z, S.self.z + half) };
    if (!_depth || Math.abs(depth.lo - _depth.lo) > half / 4) { _depth = depth; _dirtyGeo = true; }
    depth = _depth;
  }
  if (VIEW.follow && S.self) wpCentreOn(S.self);   // sets _dirtyGeo when pan moves >0.5px
  if (_dirtyGeo) { wpDrawGeometry(_geo, depth); _dirtyGeo = false; }
  wpDrawActors(S);
  // Text chrome only — byte-stability guard, same pattern as the other
  // overlays. The canvases are not innerHTML and never flicker.
  var h = wpChromeHtml(S);
  if (_chromeHtml !== h) { document.getElementById('chrome').innerHTML = h; _chromeHtml = h; }
}
tick(); setInterval(tick, 250);
```

`wpCentreOn` must skip sub-pixel corrections (`|Δpan| < 0.5 ⇒ no-op`) or a stationary player
marks the geometry canvas dirty on every 2 s heartbeat.

#### 3.1.5 Parity checklist (all five, per `CLAUDE.md`)

1. **✕ hide** — `#hide-btn` with the hover handshake, calling `window.mimic.hideThisOverlay()`
   (`apps/mimic/preload.js:413`); **plus a `win === mapWindow` branch in the `hide-overlay`
   IPC** at `apps/mimic/main.js:6591-6640` flipping `cfg.showMap = false`.
2. **✥ move** — `#move-btn` top-left with `overlayDragStart/End`
   (`preload.js:392`) **and** `window.mimic.attachOverlayMenu(moveBtn)` (`preload.js:404`)
   for the right-click resize/setup menu. Never CSS app-region.
3. **hover-interact handshake** on every clickable control —
   `overlayHoverInteractive(true/false)` (`preload.js:410`) on mouseenter/leave. For this
   overlay that is: ✕, ✥, the follow-reticle, and **the canvas itself while panning/zooming**.
   ⚠ New wrinkle: a locked overlay is click-through, so **pan and wheel-zoom simply will not
   work when locked**. Decide deliberately — recommendation: follow-only when locked, and
   pan/zoom available only when unlocked or while the cursor is over an explicit "interact"
   affordance.
4. **Dashboard row** — add `['map', 'Zone map', '…']` to `WP_OVERLAY_ROWS`
   (`packages/wolfpack-logsync/index.js:13688`), the `map: !!st.showMap` key in **both** the
   `on` and `flagOf` objects in `wpRefreshOverlayToggles` (`:13971`, `:13974`), and a
   `case 'map':` in the `toggle-overlay` IPC (`apps/mimic/main.js:6400`).
5. **`applyMapVisibility()`** modelled on `applyZealVisibility()` (`main.js:4736-4745`):
   `unlocked || (cfg.showMap && !cfg.quietMode && _eqGateOk(cfg))`. Opt-in, default off.

Plus the layout rule: reserve a ~30 px right gutter — the fixed ✕ sits there and the Buff
queue's class picker taught us what happens when something else does.

**Effort: 2-3 days.** ~250 lines agent-side (parser + endpoints + zone table + `_eqRoots`),
~450 lines `map.html`, ~60 lines wiring across `main.js` and the dashboard.

### 3.1-alt — "radar mode", the no-map fallback (strongly recommended, ~4 h)

Because most Quarm users will have **no `.txt` pack** (§2.2 #4), build the actor layer so it
renders standalone: no geometry, a fixed metres-per-pixel scale, self at centre, raid dots
around you, a north tick and a range ring. This needs **zero** map files, works for 100 % of
users on day one, and is the same `wpDrawActors` code with `BASE` set from a fixed scale
instead of `wpFitBounds`. Ship it as the fallback the overlay shows when `pack.has_zone` is
false — and consider shipping it *before* the geometry layer.

### 3.2 Phase 2 — raid dots from `raid_roster`

Almost free: `_lastRaidPipe.members` (`packages/wolfpack-logsync/index.js:8245`) already
carries `loc_x/loc_y/loc_z/heading/hp_pct/class/group` **for every raider**, refreshed on
every type-5 fire, entirely in-process. No bot call, no Supabase, no new upload.

Serializer addition (original):

```js
// Raid dots. Local pipe data only — one Mimic in the raid sees EVERY member's
// position, which is the coverage multiplier the #194 design names. Dropped
// whole when stale rather than drawn dimmed: a 40-second-old raid formation
// is not a formation, and half a wipe still looks like a raid.
function _mapRaidActors(zoneShort) {
  const rp = _lastRaidPipe;
  if (!rp || !Array.isArray(rp.members)) return { raid: [], raid_at: null };
  if (Date.now() - (rp.at || 0) > 30_000) return { raid: [], raid_at: null };
  const me = (_primaryCharacter() || '').toLowerCase();
  const out = [];
  for (const m of rp.members) {
    const g = _zealGameXY({ x: m.loc_x, y: m.loc_y, z: m.loc_z });
    if (!g) continue;                      // pre-1.7 agents send no loc
    const p = _gameToMap(g);
    out.push({ name: m.name, class: m.class || null, group: m.group || null,
               x: p.x, y: p.y, z: p.z,
               heading: m.heading != null ? Number(m.heading) : null,
               hp_pct: m.hp_pct != null ? Number(m.hp_pct) : null,
               self: String(m.name).toLowerCase() === me });
  }
  return { raid: out, raid_at: rp.at };
}
```

Rendering rules to decide up front (each of these is a bug if got wrong):

- **Depth-dim, don't hide.** A raider outside the depth window gets `globalAlpha 0.25`, never
  removed — "he's on the floor below" is information; "he vanished" is a bug report.
- **Colour by class, not by HP**, with HP as a thin arc. Class is what you scan for
  ("where are my clerics"); HP already has three other surfaces.
- **Label only your own group + anyone under ~40 % HP**, and only past a zoom threshold —
  otherwise a 54-person raid stacks 54 labels on one camp. Reuse pq-companion's
  overlap-rejection idea: draw the pin always, suppress only the text.
- **Never put `class="name"` on a canvas-adjacent DOM cell** whose text isn't a character
  name — the dashboard click delegation slices to the first word and opens
  `/character/<token>`.

**Effort: 0.5-1 day.** Zero bot changes, zero migrations.

### 3.3 Phase 3 — `#194` cluster and tagged-mob markers

The genuinely novel layer, and the one nobody else has. Two mark sources:

**(a) Tagged mobs** — `zeal_tags` carry the mob's **true spawn id**
(`index.js:29063+`; bot index `:10375-10390`). A tagger is standing next to the mob when they
tag it, so `tagger`'s position at tag time is a good mob position. Requires stamping the
tagger's loc onto the tag record at capture time — a small agent change, since the tag and
the tagger's `_zealState.loc` are both in hand.

**(b) Cluster centroids** — the bot's `_extPosCluster` (`origin/main:index.js:9938-9979`)
already produces, per same-name mob instance, the set of tanks engaged with it. Their
positions are in `locByName` (`:10305-10323`). The **centroid of an instance's tanks is a
usable mob position**, and it is the only mob position anywhere in our stack.

Two routes, and the cheap one is clearly right:

| | Bot-side | Agent-side |
|---|---|---|
| **A. Extend `/api/agent/extended-target`** to emit `pos: {x,y,z}` per row (centroid of that instance's tank locs, which are already loaded) | ~30 lines in `origin/main:index.js` near `:10474`; overlay reads it from `/api/extended-target`, which `extarget.html:690` already polls | — |
| **B. Recompute locally** from `_lastRaidPipe` + `observed_tanks` | — | duplicates the clustering; two implementations that will drift |

**Take A.** One field, additive, no migration, and the overlay gets marks for free by
piggybacking the poll `extarget.html` already makes. Mark payload shape:

```jsonc
"marks": [
  { "kind": "mob", "label": "Thall Va Xakra", "x": …, "y": …, "z": …,
    "hp_pct": 41, "tanks": ["Dafeet"], "spawn_id": 360,
    "confidence": "tagged" }        // "tagged" | "clustered" | "single-tank"
]
```

**Draw confidence honestly.** A tagged mob (true spawn id) gets a solid marker; a centroid of
2+ tanks gets a hollow ring; a single-tank guess gets a ring **plus a radius equal to the
projection reach**, because that is genuinely all we know. Reuse the K=1 guarantee: at one
instance the mark is unlabelled, exactly as the extended-target board already does.

⚠ **Do not draw a facing wedge on a mark and do not use heading to offset the centroid**
until `ext_pos_heading` graduates past 0. Our own code documents why
(`origin/main:index.js:9911-9924`): the convention is unverified and a wrong one is "a
phantom-split machine".

**Effort: 1-1.5 days** (0.5 bot, 1 overlay), gated on Phase 1 + 2 shipping.

### 3.4 Explicitly out of scope for these three phases

Spawn routes / patrol grids. pq-companion gets them from `grid` / `grid_entries` in their
local `quarm.db` (`backend/internal/db/npc_patrol.go`). We mirror `eqemu_*` in Supabase but
`spawn*` tables are **empty upstream** (`CLAUDE.md`, Supabase section), and `grid`/`grid_entries`
aren't mirrored at all. Routes would need a new Tier-1 mirror + sync job first. Park it —
and if it's ever picked up, copy their `Ordered` / `Closed` semantics exactly (§1.8): drawing
a line through a *random* grid invents a route the NPC never walks.

---

## 4. Effort, risks, skip list

### 4.1 Effort summary

| Phase | Scope | Effort | Depends on |
|---|---|---|---|
| **0** | In-game coordinate + heading verification, doc update, fix `index.js:14171`/`:14196` | **1-2 h** | someone in game |
| **1-alt** | Radar mode — actors only, no map files | **~4 h** | Phase 0 |
| **1** | `.txt` pack parse + detect, 2 endpoints, `map.html`, zone-short table, full parity wiring | **2-3 d** | Phase 0 |
| **2** | Raid dots from `_lastRaidPipe` | **0.5-1 d** | Phase 1 (or 1-alt) |
| **3** | `#194` cluster + tag marks (`pos` on extended-target + overlay layer) | **1-1.5 d** | Phase 1, 2 |
| — | Depth slider UI, height ramp, POI layers, annotations, in-game export | deferred | — |

Total to a shippable beta: **~4-6 days**, of which the first hour is the one that matters most.

### 4.2 Risks, ranked

1. **🔴 Coordinate transposition.** Our tree says one thing in two docs and does a third thing
   in the dashboard (§2.3). A transposed map mirrors the zone about the diagonal, stays in
   range, and tracks your movement correctly — it is *invisible* unless you already know the
   zone. **Mitigations:** Phase 0 gate; the conversion lives in exactly one function
   (`_zealGameXY`); validate by *rendering* against a known zone and eyeballing it, never by
   comparing bounding boxes (bounds cannot detect a sign flip on a near-symmetric zone —
   their §5b.2 warning, learned the expensive way).
2. **🔴 Sign convention on the render.** Facts to hold onto, all independently checkable:
   `east = -game_x`, `north = +game_y`, `map_f1 = -game_x` (east-positive),
   `map_f2 = -game_y` (south-positive), and therefore **neither screen axis is inverted**
   (canvas-Y-down cancels f2-southward). Inverting Y is the single most likely mistake and it
   mirrors every map vertically.
3. **🟠 Heading convention.** Zeal reports a bare number the protocol doc never scales; EQ
   native is 0-512 but degrees would be 0-360, and rotation direction is an assumption. Our
   bot ships `ext_pos_heading = 0` for exactly this reason. **Mitigation:** `WP_HEADING_OK`
   flag, default false — a dot until measured, a wedge after.
4. **🟠 Nobody has map files.** Zeal embeds geometry in `zeal.asi`, so Quarm players have no
   reason to install a `.txt` pack. Expect low detection. **Mitigations:** ship **radar mode**
   (§3.1-alt) so the overlay is useful with zero files; a clear "no pack detected — here's
   where to put one (`<EQ>\map_files\`)" state; never a blank canvas.
5. **🟠 Pack is the wrong EverQuest.** A modern pack's Bazaar renders beautifully and is a
   different building. We won't have their POI corpus to run `CheckAlignment` against, so we
   can't detect it. **Mitigation:** label the mode "your installed map pack" and never imply
   we vouch for it. Revisit only if we ever get a fixed-landmark set.
6. **🟡 Zone short name.** No zone_id → short mapping exists in the agent. One-off
   `eqemu_zone` query → a static table beside `ZONE_NAMES` (`index.js:27678`). Unmapped id ⇒
   `zone.short = null` ⇒ **no self dot at all**, per the "never draw on the wrong map" rule.
7. **🟡 Repaint cost.** A dense zone is 20k+ segments. **Mitigations:** two-canvas split
   (geometry repaints only on zone/view change), colour quantised to 5 bits/channel to
   collapse batches, one `stroke()` per batch. If a zone still stalls, thin by segment length
   at low zoom.
8. **🟡 `int16` overflow.** Reject `|v| > 32767` at parse — a corrupt value wraps to the
   opposite side of the map rather than failing visibly.
9. **🟡 Click-through vs. pan.** Locked overlays are click-through by design, which silently
   kills drag-to-pan and wheel-zoom. Decide the interaction model before writing the handlers,
   not after the first "the map won't move" report.
10. **🟢 Privacy.** Raid positions already leave the machine (`raid_roster`, documented in
    `docs/PRIVACY.md`). Phases 1-2 are strictly *less* exposure than today — everything stays
    on localhost. No new disclosure; no `docs/PRIVACY.md` change needed for 1-2.

### 4.3 Skip list

| Skip | Why |
|---|---|
| **`mapgen` — `.s3d`/WLD extraction, walkable-face classification, three techniques, SVG comparison** | ~3.6k lines of Go, needs a client copy, produces a 4 MB artifact we'd have to ship and re-cut. Zeal already draws in-game geometry. Never in scope. |
| **Bundling / hosting any map pack** | No licence, no redistribution terms. Read in place only. |
| **`align.go` alignment checker** | Needs a fixed-landmark POI corpus we don't have. Reconsider only if a POI set ever exists. |
| **POI database, categories, layer toggles, annotations CRUD** | A whole product on its own (`map_poi`, 14 categories, provenance rules, `user.db`). Nothing in Phases 1-3 needs it. |
| **In-game map export (`mapexport`)** | Writes our markers into `map_files` for Zeal to draw. Genuinely nice, and independent of the overlay — file it separately. Note the good bits if we ever do: labels need underscores (Zeal parses with `%s`), 63-byte label cap, `P` lines only (`data_mode both` would double-draw geometry), and an **out-of-band manifest with SHA-256 per file** because the format permits no comments so ownership can't be recorded in-band. |
| **Spawn routes / patrol grids** | `grid`/`grid_entries` not mirrored; `spawn*` empty upstream (§3.4). |
| **Depth slider, height ramp, mode switcher, zone picker, POI search** | Dashboard-tab features. At 380 px the chrome costs a third of the width — pq-companion built `chromeless` precisely to strip all of it for overlays. Auto-depth only. |
| **Rendering `P` label points in v1** | Parse and store them (cheap, and Phase 3 may want them), draw them later. Dense zones need decluttering before labels help. |
