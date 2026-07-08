# Zeal Named-Pipe Protocol — complete field reference

Assembled 2026-07-08 from CoastalRedwood/Zeal `named_pipe.cpp` (the
`LabelNames` / `GaugeNames` maps) cross-checked against live side-by-side
captures (Canopy the druid, Manamana the cleric — dashboard char-info dump vs
the in-game stats window). **The label/gauge ids are NOT Zeal inventions and
are not documented in Zeal's repo** — they are the classic EQ client UI
"EQType" ids from the original UI XML system. Zeal iterates its fixed maps,
asks the client for each id, and forwards whatever is populated.

Transport: `\\.\pipe\zeal_<PID>` per eqgame.exe, a stream of JSON objects
(see `apps/mimic/zealPipe.js`). Cadence is client-side, tunable in game via
`/pipedelay <ms>`. Every message wraps `{ type, character, data }` where
`data` is a double-encoded JSON string.

## Top-level message types

`enum struct pipe_data_type { log, label, gauge, player, custom, raid, group };`
— fully reproduced from `named_pipe.cpp` below; every field is verbatim from
source, not inferred.

| type | name   | payload | Mimic/agent today (as of Mimic 1.7.0) |
|------|--------|---------|----------------------------------------|
| 0    | log    | `{ type: <color index>, text }` per output line | counted + sampled only — chat comes from log files (privacy-filtered); the pipe log stream bypasses that filter, so we deliberately do NOT relay it |
| 1    | label  | array of `{ type: <EQType id>, value, meta.ticks? }` | buffs/songs/casting/char-info/HP/mana absorbed; full explorer |
| 2    | gauge  | array of `{ type: <gauge id>, value (per-mille 0-1000), text }` | self/target/pet/group HP absorbed; full dump kept |
| 3    | player | `{ zone, location: {x,y,z}, heading, autoattack }` | **all four now absorbed** (loc+heading added 1.7.0) |
| 4    | custom | `{ text }` — output of the in-game **`/pipe <string>`** command | recent ring per character; future in-game→Mimic command hook |
| 5    | raid   | per-member `{ name, class, level, group, rank, loc, heading }` + verbose `{ hp_current, hp_max, zone_id }` | agent → `raid_roster` (name/class/level/group/rank + hp%); verbose HP now preferred over gauge cross-ref |
| 6    | group  | per-member `{ name, loc, heading }` + verbose `{ hp_current, hp_max, class, level, zone_id }` | absorbed to snapshot + explorer (1.7.0) |

### Settings & cadence (Zeal ini `[Zeal]`, set in-game)

| command | ini key | default | effect |
|---------|---------|---------|--------|
| `/pipedelay <ms>` | `PipeDelay` | 100 | throttle — the whole pipe only emits once per interval |
| `/pipeverbose on\|off` | `PipeVerbose` | off | **unlocks `hp_current`/`hp_max`/`zone_id` on raid(5) and group(6)** — the only way to get exact raid-wide HP numbers instead of per-mille of self/target/pet |
| `/pipe <string>` | — | — | emits a custom(4) message; the in-game→Mimic command channel |

Verbose is the big unlock: without it we only have HP **percent** (label 19,
gauge 1) for the local player + per-mille of the current target/pet, plus
whatever groupmate gauges the local client happens to render. With it, every
raid member carries their true `hp_current/hp_max` and `zone_id`. The explorer
shows a "verbose on/off" badge per character and nudges toward enabling it.

### Coordinate order

`toJson(Vec3)` writes `{x, y, z}` from the raw Zeal Vec3 fields. The in-game
`/loc` command prints **Y, X, Z** — so when matching /loc, transpose (the
explorer shows Y, X, Z to match what players read in EQ).

## Label ids (type 1) — Zeal `LabelNames`, confirmed live

| id  | field | notes |
|-----|-------|-------|
| 1   | Name | |
| 2   | Level | |
| 3   | Class | display string ("Druid") |
| 4   | Deity | |
| 5-11 | STR / STA / DEX / AGI / WIS / INT / CHA | note DEX=7, AGI=8 (client order, not UI window order) |
| 12  | Poison resist | confirmed distinct values (Manamana 76) |
| 13  | Disease resist | (Manamana 66) |
| 14  | Fire resist | (171) |
| 15  | Cold resist | (169) |
| 16  | Magic resist | (97) |
| 17  | **HP current** | raw number — drives the tank overlay self-HP |
| 18  | **HP max** | |
| 19  | HP % | integer percent (gauge 1 gives per-mille) |
| 20  | Mana % | integer percent — **no raw mana here** |
| 21  | Endurance % | drains when overweight (Canopy 0 at 135/108 wt) |
| 22  | AC ("CurrentMitigation") | |
| 23  | ATK ("CurrentOffense") | |
| 24  | Weight current | |
| 25  | Weight max | |
| 26  | XP % into level | |
| 27  | AA XP % | |
| 28  | Target name | ("TargetName" — NOT pet; verified in source) |
| 29  | Target HP % | |
| 30-34 | Group member 1-5 name | absent when slot empty |
| 35-39 | Group member 1-5 HP % | 0 when empty |
| 40-44 | Group pet 1-5 HP % | 0 when empty |
| 45-59 | Buff slots 0-14 | value = buff name, `meta.ticks` = remaining 6s ticks |
| 60-67 | **Spell gem 1-8 names** | the memorized spell bar |
| 68  | Pet name ("PlayerPetName") | |
| 69  | Pet HP % | |
| 70  | "cur/max" HP combined text | |
| 71  | AA points banked | |
| 72  | AA % (duplicate of 27) | |
| 73  | Last name | |
| 74  | Title | |
| 80  | "cur/max" Mana combined text | raw-mana fallback |
| 81  | XP per hour | |
| 82  | Target's pet owner | PvP/charm attribution gold |
| 124 | Mana current (raw) | populated per client UI state; Mimic reads 124/125 then falls back to 80 |
| 125 | Mana max (raw) | |
| 134 | Casting spell name | |
| 135-140 | Song window slots 15-20 | short-duration bard songs |

Ids 30-34 absent + 35-44 zero on a solo character (both captures) — group
slots, per the source. No label ids exist between 83-123 or above 140 in
Zeal's map.

## Gauge ids (type 2) — Zeal `GaugeNames`, value is per-mille (0-1000)

| id | gauge | notes |
|----|-------|-------|
| 1  | Self HP | primary self-HP% source |
| 2  | Mana | per-mille — finer than label 20 |
| 3  | Endurance | |
| 4  | XP | |
| 5  | AA XP | |
| 6  | Target HP | `text` = target name (NO spawn id — see docs/zeal-spawn-id-request.md) |
| 7  | Cast progress | |
| 8  | Breath | underwater meter |
| 9  | Memorize progress | |
| 10 | Scribe progress | |
| 11-15 | Group member 1-5 HP | `text` = member name |
| 16 | Pet HP | `text` = pet name (charm pipeline anchor) |
| 17-21 | Group pet 1-5 HP | |
| 23 | XP per hour | |
| 24 | Server tick | 6s heartbeat |
| 25 | Spell cooldown (global) | |
| 26-33 | **Spell gem 1-8 recast** | per-gem cooldown progress |

## Known ceilings (don't re-derive)

- **No spawn/entity ids anywhere** — target (6) and pet (16) gauges carry
  name + per-mille only. ≥2 identically-named simultaneous mobs cannot be
  disambiguated (CLAUDE.md scope boundary; upstream ask drafted).
- **Raw mana** exists only if the client populates labels 124/125 (or the
  combined text at 80). If a capture shows neither, only Mana % (label 20)
  and the per-mille gauge (2) are available.
- **Raw endurance** has no label at all — percent only (21 / gauge 3).
- Groupmate class/level/zone + exact HP require **`/pipeverbose on`**; without
  it groupmates are name + HP% only (label 30-44 / gauge 11-21). Groupmate
  mana is never exposed.
- Log stream (type 0) is intentionally unused for chat — it bypasses the
  agent's byte-level privacy filter (officer chat / tells / group), so chat
  stays sourced from the log files where the filter runs.

## Surfaced in Mimic/agent

Everything above is visible per character in the dashboard **Info tab →
"🔌 Zeal Pipe" explorer** (each group expandable; raw label dump at the
bottom is the discovery surface if a future Zeal build adds ids). Groups:
Position (loc+heading), Vitals & stats, Progress, Target, Group (labels),
Group (pipe — verbose HP/class/level), Spell gems + recast, Pet, Buffs &
songs, Casting, /pipe messages, All gauges, All labels (raw). A per-character
"verbose on/off" badge shows whether `/pipeverbose` HP is flowing.

**Absorbed into snapshot** (`_zealState` → `/api/state` zealClients): zone,
autoattack, loc, heading, self HP cur/max/%, self mana cur/max, target,
pet, group_members, buffs, casting, custom_recent, full gauge + label dumps.
**Consumed by features:** self/MT HP (tank overlay), target buffs (Mob Info),
group/self HP % (buff queue), pet HP (charm overlay), raid roster + HP
(/raid, /buffs), gauge-condition triggers.
**Available, not yet wired into features:** gem recast timers (26-33),
breath (8), memorize/scribe (9/10), server tick (24), XP/hr (81/23), live
position (loc/heading — proximity/positioning tools), target pet owner (82),
per-raider zone_id (verbose — cross-zone raid view).
