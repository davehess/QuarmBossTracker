# DESIGN — Mimic 2.9: the spawn map

*The guild lead, 2026-10-10: a "hearty feature … worth being part of the next minor release numbering 2.9". Decision
record: `DECISIONS-2026-09-21.md` §216. Earlier groundwork this builds on: `DESIGN-zone-radar.md` (radar options),
§130 (respawns can run shorter than the database says), §131 (Map A / Map B, "A then B"), §160 (spectator board C, built:
"only what Zeal already gives a player").*

## The ask, in parts

1. **Zone-server directory** from `dbg.txt`, read without locking it, so zone identity, spawn ids and event timers can be
   keyed to the copy of the zone they happened in.
2. **Spawn map**: every spawn point as a dot. Green = up, yellow = spawning within 2 minutes, hollow red = on cooldown,
   flashing yellow with an outline = the last 2 ticks. Hover/click for the timer; an ordered list beside the map. Named
   spawn sets in bold with an extra mark. Outline a dot whose mob tick is known (from an observed death time).
3. **Live mobs**: names as seen; pathers placed on their path by heading while not aggroed; pets as a paw with the
   owner's name and level, remembered at their spawn point; tab-targeting fills in what is up.
4. **Your target** on the map with a dotted line and the range to it; optional aggro-radius rings.
5. **Learning**: respawn timers from observed deaths (PvP ±20%), and spawn order after a server downtime.
6. **Where it shows**: the spectator map, a Mimic overlay, or a second monitor/device as an assistant.
7. **Privacy modes**: non-raid opt-in/opt-out position sharing within your own group (Discord-linked Mimic users), and a
   hidden officer view listing zones and groups under the map, for moderating guild instances.

## What the research found (2026-10-10)

### `dbg.txt` (five real copies from members' EQ folders)
- ASCII, CRLF, `[<timestamp>]<seq>:<text>`. Each zone-in writes
  `Zone addr [pq.projectquarm.pq<N>.projectquarm.com:<port>] received...`, `Zone info received.`, then
  `StartWorldDisplay: <zone_short>` (skip the `_obj`, `_chr`, `_lit`, `objects`, `lights` variants). `Starting char select.`
  and `*** EXITING: I have completed camping.` mark the edges.
- **A port is not a zone id.** Plane of Tranquility appeared on port 11243 and then 7312 twelve minutes later. EQEmu hands
  zone processes ports from a pool; a port names one running copy of a zone until it shuts down. So the "directory" is a
  dated log: `(zone_short, host, port, first_seen, last_seen)`, and `instance_token = host:port` is valid only while seen.
- It also carries install paths and hardware lines: only the allow-listed zone lines may leave the machine.
- Reading it the way the agent tails eqlog (open, read new bytes, close; `tailFile`) cannot block EverQuest.

### The Zeal pipe (upstream v1.4.8 = our `test-all` for the pipe)
- **There is no nearby-mob list.** "250" is (a) the `target_loc` gate ("server policy … can't be used to locate spawns
  across a zone"), and (b) Zeal's tab-target range. The pipe carries self, group, raid (with spawn id, loc, heading), and
  the **current target**: id, name, type, level, class, race, and its loc within 250 units. No heading or speed for the
  target, no target-of-target, no pet position.
- **Aggro is not knowable for an arbitrary mob.** The client never stores other entities' targets. Zeal's `/assistbar`
  infers it for the current target only (recent damage packets, or a silent `/assist`). Our unsent draft
  `docs/zeal-tot-pipe.patch` would put that on the pipe for the current target; Mimic already reads the keys.
- **Movement is in memory** (`Entity.MovementSpeed`, `Heading`), so a pather can be told from a stander — once exposed.
- **A nearby list is a small fork change**: a new message type 7 behind `/pipenearby` (off by default), once a second,
  mobs within 250 from Zeal's own `get_world_visible_actor_list`, about 10 KB for 70 mobs. Upstream will probably not
  take a radar-shaped message as is; the defensible version is the tab-target set (visible, line of sight, 250).
- **The client never knows a spawn POINT.** Spawn id = a slot in that zone copy's table. Tying a mob to a spawn point is our
  own join: its first-seen position against `eqemu_spawn2` (pipe `(x,y)` = spawn2 `(y,x)`).

### Our data and the map
- **Static spawn data is already mirrored**: `eqemu_spawn2` 43,655 points in 182 zones, every one with x/y/z and a
  respawn time (median 990 s; 102 rows are the 1,700,000 s instance sentinel), `pathgrid` on 24%, aggro/assist radius on
  every NPC, `raid_target` on 201 NPCs. **Not mirrored**: pathing grids (`grid`, `grid_entries`) and the spawn-group
  behaviour columns (`spawn_limit`, `delay`, `despawn`).
- **Named spawn rule** (`rare_spawn` is set on one NPC — useless): `raid_target` OR in `data/bosses.json` OR a multi-NPC
  group with a low-chance non-article name (`^(a|an|the)_` excluded). Name alone flags guards and citizens.
- **The map exists**: `/spectator` (web, 2D canvas, Brewall + EQEmu walls, raid dots, side roster, pan/zoom, floors),
  also embedded in `/screen`. Spawn dots drop onto the same frame. No Mimic map overlay exists.
- **Deaths we already store** (`encounters`) have no spawn id or location; spawn ids live on `buff_casts.target_id`
  (about half the fleet sends them). A learned-respawn table is new: about 150 KB a busy night; keep the learned
  aggregate, prune raw rows at 7–30 days.
- **Privacy today**: positions are raid-only (`raid_roster`), shown to signed-in members; group positions are on the pipe
  but never uploaded; no "share my position" flag exists.

## Phases

| # | Phase | Needs | Lands on |
|---|---|---|---|
| 1 | **Static spawn layer**: dots for every spawn point, named emphasis, hover card (name/level/respawn), ordered side list, aggro-radius rings toggle | data we have; one route + a canvas layer | web (`/spectator`, `/screen`) |
| 2 | **Pather routes**: mirror `grid` / `grid_entries`, dashed route lines | sync edit + migration | bot sync + web |
| 3 | **Zone-server log** from `dbg.txt`: `instance_token` on every upload that keys by zone | agent reader (allow-list) + a small table | agent (beta) + bot |
| 4 | **Live from today's pipe**: your target as a dot with a dotted line and range; each target you tab through is placed at its spawn point and marked up; deaths you see start the cooldown (green/yellow/red/flash), tick outline from the death time | agent reads Zeal 1.4.8 target fields; spawn observations table | agent (beta) + bot + web |
| 5 | **Nearby list from our Zeal fork** (if picked): every mob within range as a live dot, pathers on their line, pets as a paw | fork message type 7 + agent | Zeal fork + agent |
| 6 | **Learning**: respawn from observed deaths (PvP ±20%), spawn order after downtime | phase 4/5 observations accumulated | bot + web |
| 7 | **Privacy modes**: group opt-in sharing; hidden officer zone/group view | a per-character flag, `/me` switch, `PRIVACY.md`, officer route | bot + web + agent |

The Mimic overlay (or second-screen view) can come after phase 1 or 4 — see the options below.

## Open picks (the guild lead)
See the reply that introduced this doc; record each pick in DECISIONS and here.
