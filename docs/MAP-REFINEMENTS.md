# Mimic Map — refinements ledger

The guild lead, 2026-10-13: *"made sure all of this from tonight is actually recorded into a specific map refinements
doc"*. This file is that record: every refinement asked of the Mimic Map overlay (`apps/mimic/map.html`, the agent's
spawn-map core in `packages/wolfpack-logsync/index.js`, the bot's `utils/zoneSpawns.js`), what shipped and where, and
what is still open. The design that started it is `docs/DESIGN-mimic-2.9-spawn-map.md`; the decisions are
`docs/DECISIONS-2026-09-21.md` §241–§264. **Add to this file in the same change as any Map refinement.**

Everything below is on the **beta** channel unless it says otherwise (Mimic beta builds per push; the agent hot-swaps
along the beta line). Bot changes are on `main`. Nothing here has been verified in game by anyone but the guild lead's
own screenshots; treat each row as "shipped, needs an in-game look" until it is ticked.

## 1. Shipped, 2026-10-12 → 2026-10-13

### Walls, labels, layers
| Ask | What shipped | Where |
|---|---|---|
| Room and boss names on the map | Boss names from our points, room names from the player's own map files, placed without overprinting | §242 |
| The player's own map files as walls | Walls: Auto uses your `maps/` files; Ours as a fallback | §242 |
| Brewall's maps | Fetched on demand from Zeal's repo, kept locally | §245, agent 3.7.136 |
| *"Default colors should probably be the same as the Brewall ones"* | Walls default to Brewall's layer colours above (Layer 2–7) and below (Layer 8–11) your floor; your own floor keeps our colour (Brewall's black would vanish) | §263, agent 3.7.147 |
| Labels on/off → *"labels all/targets/off and show the mob circles but not the labels if turned off"* | Labels cycles all / targets / off; off still draws the mob circles; an old on/off setting migrates | agent 3.7.150 `b6e91cd9` |
| Mob names in con colour, as an override | ⚙ → Mob names in con colour (off by default; the agent sends your level) | §263 |

### Spawn points, routes and pins
| Ask | What shipped | Where |
|---|---|---|
| Known mob shows its own name, spawn id, symbols | Pinned/up mobs carry name + `#spawn id` + their ability glyphs | §244 |
| Routes at any zoom | A walker's route draws even when its point is off screen | §245 |
| *"this mob is going across the map and not on a path line"* | Random wanderers (grid types 1, 2, 5, 7, 8) draw as waypoint diamonds, not a line nobody walks; a walking target lights its route | §256 |
| *"roamers are not capturing their spawn ids on the map"* | Roamers pin to their point by route twins and random-wander distance | §259, agent 3.7.145 |
| *"attributing both of these pathers to the same spawn point"* | A point already held by another pinned mob loses the tie: two roamers on one route get two points | §263, agent 3.7.147 |
| *"Going above a spawn point should still show you the spawn point of the creature that's targetted"* | Your target's point draws at any height | §263 |
| *"Why is this non-pathing mob being targetted to a different spawn?"* | Most likely one of five "golem roamers" sharing one random-wander route (they pause at waypoints, so they look static); which of the five it came from is a guess. The pin is now drawn as faint dashed lines to every point on that route instead of one confident line | Mimic beta `791cb572` |
| Match patterns to spawn points and spawn groups (PQDI's spawngroup pages as the model) | Each point carries its spawn group; the target shows "povalor golem roamers · 5 points" | bot 3.1.255 `86fd8bc2`, agent 3.7.148 `ba58a0d8` |
| *"Hiding spawns should also hide the pathing markers"* | • off hides the route markers too, except your target's own route | agent 3.7.150 |
| Spawn points quick button next to ◯ | • toolbar button = ⚙ → Spawn points | §260 |

### Aggro and faction
| Ask | What shipped | Where |
|---|---|---|
| Aggro rings with a toolbar button | ◯ draws each spawn's aggro radius | §255 |
| *"Green if it's not aggro to anyone, yellow if it could be KOS to some but is not to the player. Then a dashed line for social aggro distance"* | Ring colour by faction + your race/class/deity + your con; dashed assist ring; your target carries its own rings | §257 |
| Plane of Tranquility green; Plane of Valor red in a non-player illusion | Faction maths per primary faction, illusion handling | §261 |
| *"This pather does not have his aggro radius drawn"* | Your target carries its rings wherever it walks | §257 |

### The walked path (your target)
| Ask | What shipped | Where |
|---|---|---|
| *"Can we show the path that we observed a mob walking towards?"* | The target's positions since you targeted it, with an arrowhead | §262 |
| Keep the segment while targeted; show it again on re-target | Kept per mob (up to 40 mobs) for the zone | §263 |
| *"extrapolate the previous point and the next point from the 'random path'"* | On a random-wander route, each leg is drawn from the waypoint it left to the one it is heading for | §263 |
| *"If we find the line segment between two of these points we should keep it, and build the full path … keep these patterns and see if they persist as a common one"* | The agent remembers every leg seen walked end to end, per route, with a count (`map_timers.json`, `POST /api/map-leg`); legs seen twice or more draw solid and thicker, a one-off faint and dashed. Kept across restarts | agent 3.7.148 |
| *"It should highlight the whole path of that mob, and the other ones should fade"* | The target's route is drawn bright; every other route steps back | agent 3.7.148 |
| *"the whole extrapolated dashed line and the pace of the mob going towards that point"* | The current leg drawn whole (faint behind, dashed ahead) to a ring on the next waypoint with the seconds it needs at its pace | agent 3.7.148 |
| *"We shouldn't have the path trail off to nothing, i want to see it"* | Dark casing under the whole trail, full strength end to end | Mimic `64f8fa7a` |
| *"an arrow 60% between the previous point and the next on that line segment"* | Each walked leg carries an arrow at 60% toward where it went; remembered legs count each direction and show an arrow for each way seen | agent 3.7.149 `f506f3de` |
| *"The point that the mob leaves its spawn or its path it should be glowing RED, then when it appears to be walking back towards its home base it should be redish-orange. Pathing can be yellow"* | Trail stretches yellow (on its route / at its spawn), red (off it, getting further), reddish-orange (walking back); a glowing red spot where it stepped off | agent 3.7.150 |
| *"mob's pathing should be faded when it's killed, and it should disappear after a few kills. It can come back as a faded path for that same spawn point the next time"* | A killed mob's path fades, drops out after 3 more kills, and shows faded under the next mob you target from that point (this session only) | agent 3.7.150 |
| *"Why don't we see the purple line i drew … as a dashed line of where the mob should be moving towards if it continues the current path?"* | The ahead-leg only drew when a waypoint lined up within 20°. Now a dashed heading line runs on ahead of a walking target (about 15 s of its pace) whenever no waypoint leg is ahead | Mimic `791cb572` |
| Tabbing away and back | A gap of 2.5 s+ breaks the trail: no straight line across it, no heading read across it | agent 3.7.148 |

### View, controls, window
| Ask | What shipped | Where |
|---|---|---|
| ⚙ settings panel; opens beside the map | | §247, §253 |
| *"Own strength should say opacity … right at the top"*; wheel zooms over Pan / zoom, drag pans | | §262 |
| *"Map needs a resize drag corner at the bottom right, as do all of the windows"* | ◢ on every overlay window | §258 |
| Run speed, your /loc and the cursor's /loc top-left | Readout | §260 |
| *"Location and speed should have scaling as well"* | The readout follows ⚙ → Label size | Mimic `791cb572` |
| *"Follow me doesn't need to center the map on the player … right clicking the follow me can lock it"* | Follow keeps you where you sit on screen; right-click locks it (🔒), so dragging moves your spot instead of switching Follow off | agent 3.7.150 |
| *"In plane of valor fit raid or fit group just zooms out to the whole zone"* | Fit leaves out anyone far from the pack (over 400 units and 3× the middle distance); inside a raid, Fit group uses your raid group (the agent sends raid group numbers) | agent 3.7.150 |
| *"The buttons for the map should be draggable separate from the whole window and lock onto a part of the window, also have a vertical mode"* | ⠿ grip drags the bar; let go near an edge and it locks there; left / right edges stand it upright; remembered | Mimic `791cb572` |

### Not the Map, but asked in the same nights
| Ask | What shipped | Where |
|---|---|---|
| *"Sometimes tooltips get stuck on the screen, we need that to fade after a few seconds (3 seconds to start)"* | Every overlay: a tooltip closes 3 s after the mouse settles; shows again next time | Mimic `de6040bb` |
| *"could we add mouse-over for showing opacity on an overlay?"* (then EverQuest's Options → Display as the model) | Settings: Mouse-over opacity (100%), Fade delay (5 s), Fade duration (2 s); an overlay brightens under the mouse, waits, fades back to its own opacity; never dims; Canvas and setup mode left alone | Mimic `de6040bb` |
| Zone copies (live vs PvP instance) | dbg.txt port + /who check | §251 |

## 2. Open — in the order they were asked

| # | Ask (the guild lead) | State | Next |
|---|---|---|---|
| 1 | **Timers list detachable**: *"Same with timers, detachable and moveable across the screen and locked into place"* | Not started | A Map-timers overlay window of its own (full overlay parity checklist: ✕, ✥, hover handshake, Overlays-tab row, visibility, hide-all), fed by the same `/api/map-state`; the Map's side list pops out into it |
| 2 | **Atlas**: go up a level to continents / planes (PoP era only: Antonica, Odus, Faydwer, Kunark, Velious, Luclin, Planes of Power) and click down into any zone's map with its spawn points | Options given (A schematic atlas, B grouped list, C drawn from zone lines); recommended A with B's search inside | the guild lead picks. Plumbing either way: `?zone=` on `/api/map-state` for a browsed zone (no live dots), `data/zones.json` continents filled in for the missing planes. The picture supplied is Brewall's and is not to be committed |
| 3 | **Target Info "Map target" tab** + history with ✕, and a 🔍 search on the zone's mob names that lights them on the Map | Options given (A on Target Info as asked, B a drawer on the Map + a 🗺 button) | the guild lead picks |
| 4 | **Map buttons on other overlays**: every `/map Y X` chip gets a 🗺 that lights that spot on the Map | Designed (one agent route both overlays post to; the Map reads it on its poll) | build with #3 |
| 5 | **Other raiders' zones at the top of the Map**, like the spectator page | Designed (a small bot route so the agent can read the spectator feed with its token) | needs #2's browse plumbing; bot change on `main` after the raid window |
| 6 | **Learned paths shared across raiders** (*"see if they persist as a common one"*) | Local only today (each install learns its own) | a later call: upload legs to the bot so every raider and the website map start with the guild's learned paths. A storage decision → `docs/DESIGN-selfhost-wizard.md` §3 when made |
| 7 | **Killed paths across restarts** | Session only (the per-point last path is in memory) | persist alongside the learned legs if wanted |
| 8 | The tooltip refresh (one real mouse move at the same spot) and the mouse-over fade | Not seen in game (Electron could not be run in the cloud session) | the guild lead: hover a ✥ for 3 s on a locked overlay; mouse over an overlay and away |
| 9 | **Follow target**: *"if we're using something like Solidarity of Vision could we have a 'Follow Target' mode"* | Building next | Follow cycles you → your target |
| 10 | **Distance from its spawn point**, and when a mob that far out will gate: *"give me the distance from a mob's spawn point if it's known, as mobs at a certain range with the ability to gate will"* | Distance: building next. Gate/leash rule: being researched from the server source | show the distance under the target; add the gate/leash range once the rule is confirmed (not guessed) |

## 3. How it fits together (for the next session)

- **Agent** (`_mapStatePayload`): points, grids, factions, `spawngroups` (when the version changes), plus every poll:
  timers, seen, `legs` (`{ grid: [[a, b, times, a→b, b→a], …] }`), `me` (your level and Quarmy ids), `my_grp` and each
  raid member's `grp`. `POST /api/map-leg` stores a walked leg (`_mapNoteLeg`, capped at 3,000 per zone).
- **Map** (`map.html`): the trail per target (`trailStep` / `classifyTrail` / `noteWanderLeg` / `noteKills`) lives in
  the page, per zone, in memory; only confirmed legs go to the agent. Pure helpers sit between `// ── pure helpers`
  and `// ── end pure helpers ──` and are run as written by `test/spawn-map.test.js`.
- **Bot** (`utils/zoneSpawns.js`): `sg` per point and `spawngroups` names, decoration like grids and factions (a failed
  read leaves them null).
