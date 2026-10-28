# Raid planning, maps & strategy

Route planner, raid plans, timelines, maps, kiting, sign-ups. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-10/2 — Emperor Ssraeshza: the melee proc, the Blood shell, and where playbooks live
*2026-08-10 · DECISIONS-2026-08-10.md · Emperor fight findings and where playbooks live*

**Three findings, all now live in production data rather than a doc.**

### 1. The Emperor casts TWO things, and the second explains the threat problem

The guild lead spotted a second spell. It is not a spell — it is a **melee attack proc**:
`eqemu_npc_spells.attack_proc = 2981`, `proc_chance = 4`.

**Diminutive Stature** (2981), unresistable: **SPA 64 spin stun + SPA 114 −95%
aggro**, 5-tick duration, emote `<target> looks far less imposing.` It lands on
whoever he is meleeing, i.e. the main tank.

So the tank absorbs **two aggro wipes**: a guaranteed −95% every 60s from Rage of
Ssraeshza, plus a random −95% on 4% of swings. That is the mechanical reason dps
passes the tank, and it confirms a member's "the tank is getting spin stun proc'd on
a lot" — SPA 64 *is* that stun.

Settled at the same time: **the buster has no healing component.** SPA 114 is
aggro, proven by the family — `Calming Visage` −5 / `Beguiling Visage` −50
("non-threatening") against `Haunting` +5 / `Horrifying Visage` +10
("threatening"), plus the `Voice of` hate line at +2/+4/+6/+10/+12. The Emperor's
spell list contains exactly one spell, so nothing else lands alongside. What
makes healing *feel* useless is the **−1000 AC**. The real 75% heal reduction is
the Devourers' proc, on the **offtanks**.

**Trigger created** (`d2f9b74d-80aa-4df2-94c7-fb8ff4ab7842`), broadcast, 15s
cooldown, on `^\[.+?\]\s+{s} looks far less imposing\.$` — anchored per the
CLAUDE.md rule so `{s}` cannot eat the timestamp.

⚠ **We cannot scope it to "currently attacking the Emperor."** `ZEAL_FIELDS` is
numeric-only (`target_hp_pct`, `self_hp_pct`, `group_min_hp_pct`), so there is no
target-name condition. The closest available is `applies_to_classes`, which the
bot DOES honour server-side when serving guild triggers. Scoped to
**Monk, Rogue, Ranger, Beastlord, Wizard, Magician, Necromancer** — tanks must
NOT back off, and healers/enchanters/bards have add duty. The callout says
"ON EMP? BACK OFF" and leaves the judgement to the player. Making it exact would
need a target-name zeal condition, which does not exist today.

### 2. We fight Blood of Ssraeshza, NOT the Ssraeshzian Blood Golem

Settled from our own `encounters`, not from a writeup: **162189
`#Blood_of_Ssraeshza` — 9 kills. 162493 `#Ssraeshzian_Blood_Golem` — 0
engagements, ever.** Same shell/real split as the Emperor. Strategy writeups link
162493; the mob is 162189, and its resists differ (MR **90**, not 60 — DR and PR
both 1000 either way, so disease is useless on Blood and is the *only* way into
the Emperor).

Also recorded: Blood is the **clock, not the fight**. One tank holds it while add
control happens; killing it starts the 2m10s Emperor countdown and is a one-way
door.

### 3. Playbooks belong on wolfpack.quest, not in a chat artifact

Guild lead: *"where are these artifacts getting placed? our point is to have these
things in our Wolfpack quest."* Correct — Claude artifacts live on claude.ai and
are fine for drafting, wrong as a destination.

The home already existed: **`/guide/<internal_id>`**, whose Approach block renders
`bosses_local.strat_notes` as pre-wrapped plain text (no markdown). Both rows were
empty and are now written — `emperor_ssraeshza` (6.3k chars) and
`blood_ssraeshza` (2.4k). No deploy needed; the page reads the DB.

The guide index doubles as an authoring worklist, sorted so the bosses we kill
most with nothing written float to the top. **Write strategy there, not into a
doc or a chat page.**

## 2026-08-21/4 — Officer pre-raid checklist + midday raid-info post (the guild lead)
*2026-08-21 · DECISIONS-2026-08-21.md · Officer pre-raid checklist and midday raid post*

**The calls.** *"let's build an admin-facing officer-chat pre-raid checklist,
active mimics, class shortages below our average, lockouts, other pertinent
details (suggest some)"* and, with the real signup embed attached, *"this is
the information that we go off of from signups. post the raid info midday to
our channel."*

**The design rule I picked, and why.** Every section must be **actionable in the
next hour**. A number an officer can't do anything about before the pull belongs
on a web page, not in a Discord post — which is why there is no DKP, no
attendance history and no parse stats here. All true, all useless at 7pm.

**Officer checklist (`/preraid`, auto at T-90m, bot 3.1.66):**
1. Signups — going/tentative/out, flagged thin only against OUR OWN recent
   average, never a magic number.
2. Class shortages — a class is short when it fails BOTH a ratio and an
   absolute-head test (2 of 3 clerics is a crisis, 9 of 12 wizards is a
   Tuesday), sorted by heads missing rather than ratio: 0-of-4 warriors
   outranks 3-of-6 clerics because you can raid a cleric light and you cannot
   raid with no warriors.
3. Mimic coverage — counted in PLAYERS, never characters (CLAUDE.md adoption
   rule), naming who we won't see. A signup with no Discord id is assumed
   covered rather than accused.
4. Lockouts on tonight's targets — the engage-lock briefing, folded in.
5. Targets actually UP — the most expensive thing to discover at pull time.

**Midday member post (`/raidinfo`, auto in the noon hour, to the raid
channel):** re-surfaces the header block the officers ALREADY typed into the
signup post — Raid Set / Muster Point / Raid Lead / Raid Window / Loot / Ticks —
rather than inventing a format, plus who has signed by class and which classes
are still wanted. Deliberately NOT the officer checklist: no Mimic coverage, no
lockout names. What a raider needs at noon is where to be, who's leading, and
whether their class is wanted.

Both dedupe per night in `bot_kv` (not state.json — deploys wipe it). The
header parser is tested against the REAL Vex Thal signup post; its first cut
silently dropped "Raid Set 1 - Vex Thal" because the label pattern didn't allow
digits, which the fixture caught.

## §293 — The Map's speed reads as % of normal run, like Zeal (Mimic beta `dbf2a0d8`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Map speed shown as percent of run speed*

- **The report (the guild lead):** *"Our speed calculation looks wrong"*, with a screenshot showing our readout at 84 u/s
  beside Zeal's map at 277% at the same moment.
- **It wasn't wrong, just in other units.** Our readout (units a second, §260) and Zeal's (% of normal run) agree when
  100% ≈ 30.3 u/s. That is the base §260 said it lacked, measured from this pair. Four nights of `raid_track_minutes`
  steps agree on the scale: most movement sits under 60 u/s and the tail ends near 110 u/s.
- **Change:** the top-left readout now shows `NNN%` (`RUN_BASE_UPS = 30.3`, `runPct`), with the units-a-second value in
  its tooltip. It is one reading: a timed unbuffed run would tighten the base. `test/spawn-map.test.js` pins 84 → 277%.

## §298 — Map: Thelin's walk, a Raiders label switch, and the raid's focus ring (agent 3.7.164, Mimic beta `39d6bef3`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Map shows escort walk and raider label switch*

- **The asks (the guild lead, 2026-10-14):** *"for Thelin, if anyone is targetting him we should track that path and put
  his path on the map"*; *"map should have a quick hide raiders labels too, and also highlight the MA's target or which
  target has the most people targetting them."*
- **Thelin's walk:** his waypoints come from the maze script, not a spawn grid, so the learned wander legs cannot hold
  them. The agent keeps a plain trail instead (`MAP_TRACKED_PATHS`). Any character on this machine targeting him adds to
  it. Gaps over 20 s and jumps over 400 units break the line, so the outside Thelin's body is never joined to the inside
  one. **Local only for now:** sharing one trail across the raid needs a bot route (MAP-REFINEMENTS #14).
- **Raiders button:** on the Map toolbar. It hides the raid and group names together; the dots and mob names stay.
- **Focus ring:** the mob Extended Target puts on top. That is the MA's declared target, else the mob 2+ raiders target.
  It gets one magenta double ring and an "MA" or "N targeting" tag. It is drawn only where its position is known: your
  own target, or a pinned spawn point. Placing it from other raiders' targets needs each Mimic to share its target loc
  (MAP-REFINEMENTS #15).
- **Load:** the focus read uses the same 3 s Extended Target cache the dashboard state already refreshes, so it adds
  no new bot traffic.

## §299 — Map: the raid's targets and shared escort trails (bot 3.1.263 on main `a1d7f11b`, agent 3.7.166 on beta `46babe84`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Shared raid targets and escort trails on map*

- **The picks (the guild lead, 2026-10-14):** both. **A**, "for these types of babysitting escort quests": one escort-NPC
  trail every Mimic in the raid sees. **B**, "also important for MA": shared target positions, so the focus ring can be
  placed when it is not your own target. B's samples are A's source.
- **One upload, extended, not a new stream:** each Mimic's current target rides the existing `live-state` POST
  (`target_map` in the Map's server frame, `target_type`, `target_zone`; `target_id`/`target_name` were already there).
  The upload is change-driven plus a 45 s heartbeat; the agent adds a position-driven send only when the target is an NPC
  that moved (30 units and 10 s for any mob; 12 units and 5 s, or 15 s standing, for an escort). The bot keeps the latest
  sample per character in memory for 90 s (`utils/raidTargets.js`), never in a column, and sheds with
  `flag_shed_live_state` because it is that stream. Target id 0 is no target.
- **Served on the Map's existing pull:** `GET /api/agent/map-sync` gains `targets` (per zone: each targeted NPC's latest
  position and how many raiders are on it) and `trails` (past `tsince`). Scope is Extended Target's: your raid (the other
  raid dropped when two are live), else your group, else only your own characters. The trails are not scoped; they name no one.
- **Escort trails (A):** `ESCORT_NPCS` in `utils/raidTargets.js`, mirrored by the agent's `MAP_TRACKED_PATHS` (a test fails
  if they drift). Matched on zone + name, never id. Rules of the local trail: a point every 12+ units, a break after a 20 s
  gap or a 400-unit jump, 800 kept, dropped after 12 h. A stretch is served only once it has moved 100 units, so a town copy
  that stands still never draws. Stored in `bot_kv` (`escort_trail:<zone>:<name>`, one row per guild + zone + NPC), written
  at most once per 10 s per trail, nothing written before a read has succeeded.
- **Limits:** two raids in two copies of one zone share one trail per escort (only the 400-unit break separates them).
  The Map's pull is every 10 s, so a shared focus position can be ~15 s old.
- **Privacy:** a target's name and position is game state, not chat. PRIVACY.md lists it with the live status.

## §330 — Map keep-clear areas are visible, named and switchable (Mimic beta `792da494`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Map keep-clear areas visible and switchable*

- **The report (the guild lead, 2026-10-14, two screenshots):** *"What UI element is this looking to avoid? It cuts out a lot of it. We
  should be able to see what's hidden and what is not."*
- **Calls:** outlines + names only while configuring (⚙ open) or on an opt-in tick — mid-raid labels over the game are noise. Any area
  whose size or position is a guess (no Width/Height, Zeal bars that run to the screen edge, a UI file saved for another resolution)
  starts unticked; a pick is per character and per screen setup. No collapsed/minimised key was invented — none is known yet.

## §131 — Our own zone map: the website first, then a Mimic overlay — queued, not started (2026-10-02)
*2026-10-02 · DECISIONS-2026-09-21.md · Own zone map queued, website then Mimic*

The guild lead, on whether we can render our own map instead of Zeal's, with NPCs, pathers and aggro / call-for-help
rings: *"A then B, but not yet. Queue them."*
- **A — website map** (`/map/<zone>`, reusing the PoP guide's `ZoneMap`): every spawn point by family,
  aggro and assist rings from `eqemu_npc_types` (giants 60 / 80, some Vind 100, storm guardians 400),
  pather routes as dashed lines, a floor filter, name / level / respawn on hover.
- **B — Mimic overlay**, reusing A's drawing: the same layers plus live dots for you, your group and raid
  from Zeal (already sent). It owes the full overlay parity checklist.
- **Prerequisite for both:** mirror the server's `grid` and `grid_entries` (pather routes; Bastion of
  Thunder alone has 469 waypoints on 30 routes) into the weekly eqemu sync. Walls need EQ map files or a map
  pack whose licence is checked first; the current outline is inferred from spawn points.
- **Not in scope:** live NPC positions. That is ShowEQ territory, which the server's rules likely forbid;
  ask staff before anything shows them. Respawn labels carry the §130 caveat (reduced respawns).
- The reasoning behind the giants' call-for-help, which the map is meant to make visible: EQMacEmu
  `NPC::CallForHelp` / `EntityList::AIYellForHelp` (zone/aggro.cpp): an engaged or fleeing NPC calls on
  engage and every 3 s (`AIassistcheck_delay`); any NPC within ITS OWN assist radius of the caller, with
  line of sight, answers when it shares the primary faction or lists the caller's faction as an ally
  (`npc_value` 1). All four greater-giant families list each other, so any giant answers any giant. An
  answerer does not call in turn (`IsAssisting`), so adds come from wherever the first giant goes.

## §160 — A 3D "spectator mode" map on wolfpack.quest: options, not yet picked (2026-10-04)
*2026-10-04 · DECISIONS-2026-09-21.md · 3D spectator mode map options*

The guild lead: *"3d map like this design on https://foreverchanges.pro/map with our location data and target
location data overlayed like spectator mode on Wolfpack.quest"*. Same day as `DESIGN-zone-radar.md` (options
1-3, unpicked); this ask is that doc's Option 2 (one shared raid picture on the website) with a 3D look.

- **The reference is a World of Warcraft map** (WoW Classic "Forever" fan site). Its 3D terrain is built from
  Blizzard's client files (height tiles, ~20 KB each; 8 MB for one zone view) in a hand-written three.js
  engine: tiled terrain with LOD, draped map imagery, fog, DOM labels, "Top down" and "N" buttons, shareable
  view in the URL. Its terms forbid republishing its compiled data. So: copy the controls and feel, never its
  data or code.
- **We have no EverQuest terrain.** No meshes, and Brewall's map lines carry no licence (`DESIGN-zone-radar.md`).
  What we can draw from freely: `eqemu_spawn2` (43,655 points with x/y/z in 182 zones), doors (8,207), ground
  spawns (514) and objects (322).
- **Positions we have:** `raid_roster.loc_x/y/z` + heading, every 3 s per raid group, latest only, kept 1 h;
  `character_live_state.loc_*` every 45 s, no heading. Nothing on the website reads them yet, and nothing
  serves them to it. `/raid` refreshes every 15 s.
- **Targets:** Zeal 1.4.8 sends `target_loc`, only within 250 units ("server policy"). Mimic does not read it
  yet, and the fleet reports Zeal 1.4.7 (5 of 5 that report a version).
- **Options** (build / maintenance / runtime / change):
  - **A, point-cloud 3D:** the zone drawn from our own points, orbit/tilt/zoom like the reference; looks like
    a constellation, not terrain. ~6-9 days for the page plus the live layer / low / three.js ~150 KB lazy +
    one small points file per zone / easy.
  - **B, real zone geometry:** meshes extracted from the EverQuest client files by a local session, then the
    same engine. The look of the reference. Needs a rights call (Daybreak's art on our site) and a per-zone
    extraction step; several MB per zone. ~15-25 days / high / heavy / hard.
  - **C, flat live board:** top-down 2D with height as colour, no 3D engine. Fastest to read mid-raid, best on
    phones. ~4-6 days / low / tiny / easy.
  - Common to all: a member-gated positions endpoint (2 s poll), agent adoption of `target_loc`, and the
    one-hour in-game axis and heading check.
- **Gates already on record:** §131 and `DESIGN-zone-radar.md` say to ask server staff before anything shows
  mobs' positions raid-wide. Raiders' own positions on the website are a new surface: `PRIVACY.md` says
  signed-in members see zone and HP only, so it needs a line there first.
- **Preview:** a private artifact (not in the repo) shows A and C over real Vex Thal spawn points with a
  made-up sample raid, so the look can be picked before any build.
- **Picked (the guild lead, same evening):** *"I need to have the map displayed underneath or it's useless
  though. we can start with C. I'm not asking the server for permissions beyond what has already been cleared
  for zeal"*.
  - **C first**, the flat live board.
  - **A real zone map under the dots is a requirement.** The spawn-point cloud and `zone_outline()` alone are
    not enough. So the map-line source (whose lines, under what licence) is the first thing to settle; Brewall's,
    the ones Zeal draws, state no licence.
  - **No ask to server staff.** The page shows only what Zeal already exposes to a player: raid members'
    positions (pipe types 5 and 6) and a target's position within Zeal's 250 units. Nothing beyond that is
    built: no positions for mobs nobody targets, no pather predictions. This supersedes the "ask staff" gate in
    §131 and `DESIGN-zone-radar.md` for that scope.
  - Still needed before raider dots show on the site: a `PRIVACY.md` line (positions shown to signed-in members).
- **Brewall's maps underneath (the guild lead, 2026-10-05):** *"include brewall maps underneath. I'm not
  concerned with the licensing right now because this is still gated behind Discord."* So the board's default
  layer is Brewall's lines, as Zeal ships them. Rules that keep that call contained:
  - **Never in this public repo.** The route fetches each zone's files at run time from Zeal's public repo
    (`coastalredwood/Zeal`, `Zeal/zone_map_src/map_files/`, 180 zones), caches them in `zone_map_lines`, and
    serves them only through the signed-in route. Tests use invented strings.
  - **`zone_map_lines` has no read policy at all** (service role only). A Discord account can get an
    `authenticated` session from Supabase without passing the guild check in the sign-in callback, so an
    `authenticated` policy would have handed the art to anyone with Discord.
- **Built (web 1.8.98, 2026-10-05), live after the raid freeze:**
  - `/spectator` [beta], under Raid in the nav. `web/app/spectator/` + `web/lib/spectator.ts`.
  - **Positions:** `GET /api/spectator/positions` (signed-in) calls `spectator_positions()` (migration
    `20261005003000`): one row per raider, freshest wins, (0,0,0) rows dropped (an uploader reports a raider
    in another zone that way). raid_roster holds one row per uploader × raider: 1,125 rows inside 30 s for 45
    raiders on 2026-10-04, so the raw read the first draft used would have dropped raiders. The board polls
    every 3 s, the upload cadence.
  - **Axes, settled on live data:** server x = `raid_roster.loc_y`, server y = `loc_x`. With the swap, 15 of
    19 raiders in the Plane of Innovation stood within 8 units of a floor in the collision mesh; without it,
    none had a floor anywhere below. The page draws north-up like Zeal's map (screen = −server).
  - **Zone:** raid_roster has none. A raider's own `character_live_state` zone, else the zone most of that
    uploader's raiders are in, else the raid's.
  - **Map:** `GET /api/spectator/map?zone=` (signed-in) returns two layers in the server frame: `eqemu` (wall
    lines sliced from the GPL EQEmu collision mesh, `web/lib/zoneMap/slice.ts`, the Python reference ported
    exactly) and `brewall`. Each is fetched on the first request for a zone and cached in `zone_map_lines`
    (migration `20261005010000`; ~170 KB a zone, ~30 MB for all 180 at worst). Zone names are checked
    against `eqemu_zone` before any URL is built.
  - **Board:** Brewall, generated walls or both; floors (the raid's floor bright); fit raid uses the raid's
    core so a corpse run does not shrink the view; group roster with tap-to-find; scale bar, north arrow.
  - **Not yet:** target markers (needs the agent to read Zeal 1.4.8 `target_loc`); heading direction is
    assumed counter-clockwise from north (`HEADING_CCW`) until checked in game.
  - **Privacy:** one line in `docs/PRIVACY.md` and `/privacy`: while you are in a raid, your latest position
    is shown to signed-in members on this page; nothing new is stored. (Superseded the same night by §161:
    positions are now kept for replay.)

## §216 — Mimic 2.9 is the spawn-map line; Zeal review fixes go ahead; guild marks are option B (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Mimic 2.9 spawn-map line*

**The call** (the guild lead): a "hearty feature … worth being part of the next minor release numbering 2.9": read `dbg.txt`
without locking it to build a directory of Quarm zone servers and zones; pull nearby-mob locations from the Zeal pipe
(reportedly up to 250 units) into our own map with spawn points, pathers, pets, named spawns, the target with a range
line, aggro radius, learned respawn timers (PvP ±20%) and spawn order after downtime; show it on the spectator map and as a
Mimic overlay or second-screen view; non-raid opt-in/opt-out position sharing within a group; and a hidden officer view
listing zones and groups for guild-instance moderation.
- **`dbg.txt`, from real files** (five copies from members' EQ folders, 2026-10-08): ASCII, CRLF, every line
  `[<timestamp>]<seq>:<text>`. Each zone-in writes `Zone addr [pq.projectquarm.pq<N>.projectquarm.com:<port>] received...`,
  then `Zone info received.`, then `StartWorldDisplay: <zone_short>` (plus `_obj`/`_chr`/`_lit` variants to skip);
  `Starting char select.` and `*** EXITING: I have completed camping.` mark the session edges. The same zone appeared on
  port 11243 and on port 7312 within twelve minutes, so a port names a running copy of a zone, never the zone itself: the
  directory is a time-stamped log of (zone_short, host, port, first/last seen). The file also holds install paths
  (`<drive>:\<folder>\…s3d`) and hardware lines, so only the allow-listed zone lines may ever leave the machine
  (`docs/PRIVACY.md` gets a line when it ships). Reading it the same way the agent tails eqlog (open-read-close per poll)
  does not lock it.
- **Zeal review fixes: go.** The ranked findings (picture-folder crash on a non-English filename, persistence save loop
  able to throw into the game loop or read a dangling entity, picture memory, per-frame lookups, silent failed saves,
  the merged build dropping picture tags on restore) are being fixed as new commits on each branch. A raider's remote
  `clear` keeps wiping the zone's saved tags (unchanged, deliberately).
- **Guild marks: B.** Players show their guild's mark automatically from the guild the client already knows
  (`Entity.GuildId`), drawn only on the viewer's screen, never for /anon or /roleplay players, only for guilds in the
  `kGuilds` table, within 150 units, icons not banners. `/tag guildmarks off|tagged|auto`, default `tagged` (no change
  for anyone who does not opt in); `off` also hides marks other raiders tagged.
- **Landed (2026-10-10):** `tag-shapes` `f777d81` (guild marks B, render-state restore on a failed shape allocation,
  startup check that tag identity colors are unique) and `tag-icon-files` `b20331f` (per-file `std::exception` catches
  plus a non-throwing path printer, picture file resolved once per tag instead of per frame, 128 px picture cap, load
  problems printed after the frame, auto marks use a guild's picture file when present). Both were fast-forward pushes.
  Nothing outside `tag_shapes.cpp` has been compiled here (no MSVC); the GitHub build of `test-all` is the first real
  compile. **In-game checks:** (1) `/tag guildmarks` alone prints the mode, "tagged" on a fresh profile; (2) `auto`
  near listed guilds shows their icons, nothing for unguilded or unlisted guilds; (3) /anon and /roleplay players get
  none; (4) marks vanish past ~150 units; (5) `off` hides `^B…^`/`^I…^` tags from others but keeps `^E^`, `^$^`, `^WP^`;
  (6) `tagged` after `auto` drops only the automatic marks; (7) a player tagged with a non-guild shape keeps it in `auto`;
  (8) frame rate with ~70 players, `auto` vs `tagged`; (9) a non-English picture file name is skipped without a crash;
  (10) a picture over 128 px prints one skip line after the frame; (11) replacing a picture then `/tag icons` updates a
  tagged mob without re-tagging; (12) a guild picture file (`<code>.png`) is used by `auto`, and removing it falls back.
  ⚠ Guild names match `kGuilds` by letters and digits only, so "&" vs "and" will not match; compare `/tag guilds` to
  the nameplate text. A guild seen before the client loaded its guild list stays unmarked until the next UI reload.
  Pictures between 129 and 512 px that used to load are now refused.

## §218 — The spawn map's controls, its HUD mode, local-first data and mob range rings (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Spawn map controls, HUD mode, range rings*

**The calls** (the guild lead): *"we should see a mob's longest range attack or spell ring as well emanating from its
location"*; *"we need to be local on the map with the player and group and raid's zeal pipe location data"*; zoom in
and out, drag to pan, right-click centres on you, follow-the-player by default as a UI toggle, north-up / heading-up as
a toggle, and *"a secondary mode that is a more transparent overlay mode like where HUD would be in the middle of the
screen"*.
- **Controls (every version, Mimic and web):** wheel zooms around the cursor; drag pans and turns Follow off; right-click
  centres on you once (Follow stays as the toggle says); Follow defaults ON; the orientation button names the current
  mode (N-up / Heading-up) and flips it.
- **Two display modes:** Window (framed, opaque) and HUD (no frame or background; walls only, see-through, sized for the
  middle of the screen; the title bar and controls show on hover). HUD is a Mimic overlay mode, so it must stay
  click-through when locked like every overlay (the hover handshake in the parity checklist).
- **Local first:** in Mimic the map draws you, your group, your raid and your target straight from the local agent's
  Zeal pipe data, with no server hop and no upload; it works in local mode. The server is needed only for people outside
  your raid (opt-in sharing) and for the website.
- **Range rings:** per NPC, the farthest spell in its spell list (`npc_spells` + entries, mirrored) or its ranged attack
  (special ability 11, decoded in `utils/mobSpecials.js`) as a purple dashed ring, and its widest area-of-effect radius
  as an orange ring. A worst case, never a prediction. Shown for the target by default, optionally named or all.
  ⚠ `eqemu_spells` does not mirror `range` / `aoerange` yet: adding them is a migration plus the column list in
  `scripts/sync-from-eqmac.js` (spells transform) and a forced re-import of `sync-quarm.yml`.
- **Zeal's map or ours:** asked as a pick (A our own map, recommended; B rings inside Zeal's map via the fork, which needs
  a weekly data file and lives only in our fork; C our overlay laid over Zeal's map, fragile). Zeal draws its map inside
  the game, so Mimic cannot add to it from outside.
- **Where it landed:** the workshop page (version 2) has all of it working on simulated data.

## §219 — Two outside map sites reviewed: a 3D zone viewer and a Vex Thal pathing map — references, not sources (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Outside map sites reviewed as references*

**The ask** (the guild lead): a 3D zone viewer site *"would be an incredible viewpoint for spectator's 3d mode"*, and a
MacroQuest-community automap page *"for pathing of vex thal"*.
- **The 3D viewer** (a hobbyist's React + three.js app, "EQ Advanced Map"): orbit / fly / follow cameras over 180 zones
  incl. the PoP planes. Its zone models are converted client art (Draco-compressed GLB with WebP textures, ~1 MB median,
  up to ~7 MB, 276 MB for all zones) served from ANOTHER emulator server project's cloud storage; its spawn data is that
  server's, not Quarm's. **No licence** in either repo and no permission statement for the art. It can be iframed (no
  X-Frame-Options/CSP) but has no API to feed it our positions; its live mode needs the author's own local exe (whose
  repo commits TLS key files — do not use). Spawns are placed at `(-y, z, x)`, so /loc mapping looks plausible but is
  unverified. **Use it as a UX reference only.** It proves ~1–5 MB per zone is practical for real meshes.
- **The automap page:** Leaflet, server-rendered, Vex Thal = 3,683 wall lines, 353 spawn points, 42 patrol routes with
  pause times. Data is the modern ProjectEQ database (not Quarm's EQMacEmu fork) plus map-file lines; **no licence or
  terms published**; other zones sit behind an anti-bot challenge (not bypassed). Do not scrape it.
- **Patrol routes come from our own import instead:** mirror `grid` (`id, zoneid, type, type2`) and `grid_entries`
  (`gridid, zoneid, number, x, y, z, heading, pause`) in `scripts/sync-from-eqmac.js` + one migration; draw via
  `eqemu_spawn2.pathgrid`. **Confirmed 2026-10-10 by streaming `quarm_2026-09-27-22_44.tar.gz`:** `grid` (`id, zoneid,
  type, type2`, 22,824 rows) and `grid_entries` (`gridid, zoneid, number, x, y, z, heading, pause, centerpoint`, 711,517
  rows) are both in the Quarm dump; Vex Thal (zone id 426) has 44 grids / 398 waypoints. `spells_new` carries `range`
  (default 100) and `aoerange` (default 0) — Pacify 200/0, Harmony 200/40 — so the range-ring columns come from the same
  dump. ⚠ The Al'Kabor fallback must still never fill route tables: fail loudly if a future dump drops them.
- **Options put to the guild lead** (workshop page, version 3): 3D-A raised walls from our line maps (no game art, safe
  on the public site; recommended for the web), 3D-B real models converted locally inside Mimic from the player's own
  install (nothing published), 3D-C real models on the website (needs a rights call, or the viewer author's written
  permission), 3D-D embed the viewer (not recommended). Routes: A our Quarm import (recommended), B link out.

## §220 — 2.9 spawn map picks; group positions are visible to the group (and its recent helpers) (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · 2.9 spawn map picks, group positions*

**The picks** (the guild lead, in the workshop and in chat): **3D-A on the web, 3D-B in Mimic, routes A.** Workshop
votes: version **C** (tracker: radar + nearby list), map art **B** (painted, Mimic-only) with the note *"combo of painted
and parchment as options (or no background)"*, map drawn on **our own canvas (A)**, nearby dots **A** (tab-target, works
on today's Zeal), build for **both** web and Mimic, group sharing **yes**.
- **How they fit together:**
  - **Web:** the zone board stays the spectator layout; background choices are none / lines / parchment; 3D-A is
    the 3D mode. **3D-A is built from the EQEmu collision mesh** (`EQEmu/maps` `base/<zone>.map`, GPL-2.0-or-later),
    which `/spectator` already fetches and caches (`web/lib/zoneMap/source.ts`). It is the server's real 3D zone
    shape, shaded with no textures, so it carries no Daybreak art and no new licence question. Brewall lines (no
    stated licence) stay a flat overlay only.
  - **Mimic:** version C (radar + nearby list) in Window and HUD modes; backgrounds none / lines / parchment /
    painted. **Painted (2D) and 3D-B share ONE converter** that reads the player's own client zone files on their
    machine and never uploads them. It is the largest single build in 2.9, so it ships after the 2D overlay.
  - **Routes:** our Quarm import (`grid` / `grid_entries`), never another server's (§219).
- **Group privacy rule — the call** (the guild lead): *"a group's data is already exposed to that user via zeal pipe.
  display it for any logged in authenticated user that is in that group currently (or was until recently, in case
  they're dropped from a disconnect or helping with damage/healing outside of the group. like what happens prior to
  forming a raid or power leveling to help a group get leveled faster"*.
  - **Who sees a group's positions:** a signed-in member whose character is in that group now, per any member's
    Zeal group data. Also anyone who was in it within the **grace window**, and anyone **helping** it inside the
    grace window: healing or buffing a group member, or damaging the group's current target, as seen in a group
    member's log.
  - **Grace window default: 30 minutes**, long enough to cover a disconnect and relog or a short power-levelling
    session. The guild lead may change it.
  - **What is shown:** only what the pipe already gives each of those people: name, class, level, HP and position.
    Raid positions keep the existing members-only raid rule.
  - **Owed before it ships:** group positions (Zeal type 6) are not uploaded yet, only the raid roster (type 5),
    so the agent needs a group upload. That upload needs a `docs/PRIVACY.md` line and the per-character opt-out
    honoured (`exclude_from_stats`). The membership check runs on the server; the page never decides it.
- **XP per hour status** (asked the same day): collection (FB-37 option B) has run since 2026-10-02. 54,647 rows,
  35 players, 72 characters, 36 zones; raid rows are stored but kept out of group answers. The local XP/AA-per-hour
  readout is on the HUD (agent `_meRate`). **No board yet** — the week of data the board waited for is now in. A
  first SQL pass shows bracket 60–64 leading in Plane of Disease, The Deep and Plane of Valor, and level 65 AA/hour
  leading in Plane of Nightmares and Valor. These are percent-of-level numbers on small samples, not yet the exact
  total-XP figures `DESIGN-xp-tracking.md` §2 calls for. The four §5 questions are still open (A/B/C; 7 or 30 days;
  names; raid XP).

## §221 — Spawn map: guessed spawn points, click-to-mark, danger badges, per-zone line of sight (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Guessed spawns, click-to-mark, line of sight*

**The calls** (the guild lead): *"some zones we will pull mobs but not know their spawn point, only guess. by name or by
what mob they came with. if we are standing in a spot where there could have been a mob and it's missing, we should be
able to click on it somehow and mark it. boss mobs or ones that are harder it see invis should have that noted somehow
easy to see"*; and on line of sight: indoor vs outdoor differs; several outdoor PoP zones did not enforce line of sight
through walls for years, mostly fixed on this server in the past week; Plane of Hate has collision and pathing around
walls but does not check line of sight for casting or ranged; with no path, a mob may teleport through walls to reach
a player or its home point.
- **Where it landed:** `docs/DESIGN-mimic-2.9-spawn-map.md`, new section "Pulled mobs, missing spawns, dangerous mobs,
  line of sight". In short: a pulled mob's death is credited to a candidate spawn point by name + spawn group +
  linked-pull proximity, and left **unassigned with "?" rings** when ambiguous; a player can click a spawn point to
  mark it empty / killed / up, which starts a respawn **window** (a range, not a time) labelled as a mark, overridden
  by any observed death; danger badges come from columns we already mirror (`raid_target`, `rare_spawn`,
  `see_invis`, `see_invis_undead`, `see_hide`, `see_improved_hide`) plus the decoded special abilities.
- **Line of sight is not in any database** (`eqemu_zone.cast_outdoor` is indoor/outdoor only), so it becomes a small
  officer-curated table (`zone_los_rules`: spells / ranged / mob warp / notes / verified on), with rows going
  "unverified" after 30 days. In enforced zones the range rings are clipped by walls using the cached EQEmu collision
  mesh; in zones like Plane of Hate they are drawn unclipped with a "no LoS" tag, because walls do not protect you.
- **Not built yet.** These join the 2.9 phases: badges with phase 1, marks + candidate attribution with phase 4,
  the LoS table + clipped rings after the range-ring columns land in the import.

## §239 — Mimic 2.9 spawn map, first cut: a 2D Map overlay with respawn windows (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · 2D Map overlay with respawn windows*

- **The ask** (the guild lead): *"2d overlay on beta with spawn timer tracking"*. The first piece of the 2.9
  line (§216, §220), layout C (tracker), before any 3D.
- **Shipped:**
  - **Bot 3.1.246 (main `dd8a9cb4`):** `GET /api/agent/zone-spawns?zone=<short>` serves the zone's placed
    spawn points (spawn2 + spawnentry + npc_types: coords, respawn, variance, the NPCs each can spawn with
    chance, level, named / raid flags and ability badges) plus the EQEmu wall layer. ETag / 304, 6 h cache.
    **The Brewall layer is never selected** (the map read is exactly `bands,segs,bounds`; a test fails if that
    changes). Brewall stays on the website only.
  - **Agent 3.7.130 + Mimic (beta `79bafcf1`):** a "Map" overlay, off by default, all six parity items.
    Walls, spawn dots, your position, Follow / Fit / pan / zoom / floors. Zone data is cached on disk; local
    mode never asks the bot.
- **How a kill lands on a spawn point** (the rule a later session must not loosen without asking):
  - The death comes from the Zeal target turning to a corpse or 0 HP, or the slain log line (lines older than a
    minute are ignored).
  - The point is picked from where that spawn id was FIRST seen, not where it died: the nearest point that can
    spawn that name, if it is within 60 units and the next one is at least twice as far (or past 120).
  - Anything less certain is drawn as "?" on up to four candidates and starts **no timer**. "Killed — this one"
    settles it. A guessed timer that is wrong is worse than none.
  - The timer is a window, never a time: respawn ± variance. Green waiting, yellow can be up, red/flash overdue.
- **Known gaps:** sightings need Zeal 1.4.8's `target_loc` (the fleet mostly reports 1.4.7), so older Zeal
  gets log-line deaths and manual marks only. Not yet run in a real Electron window; heading direction, floor
  picker and dot density are unchecked. Ability badges: a few get a glyph on the dot (see-invis, see-hide,
  summon, pacify-immune, rampage, enrage, flurry, reverse slow); the rest are spelled out in the hover card.
- **Real-time positions (agent 3.7.131, beta `4bf1ff6e`).** The guild lead: *"local locations should update in
  real time, location data from me/group/raid"*. Self and group already reached the agent every 300 ms; the
  raid rode the 2 s pipe batch. Now a waiting raid sample flushes on the 300 ms beat (other pipe types keep
  2 s), the overlay polls every 250 ms and glides dots between samples (a jump over 200 units snaps). No
  extra uploads: the raid roster still uploads on a composition change or the 3 s heartbeat only.
- **Found while testing: two Mimic installs side by side.** The guild lead saw "Not connected" on a stable
  2.8.1 window while their beta 2.8.2 install was signed in and uploading. Two installs have two settings
  folders, so only one holds the sign-in. Offered: a warning when a second Mimic is already watching the logs.

## §241 — Map overlay round two: the name, tab-target pins, guild-shared timers, walker routes, low-lag positions (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · Map overlay pins, shared timers, routes*

- **Name** (the guild lead): *"just call it Map overlay, not spawn map"*. User-facing text says **Map**; the code key stays
  `map` and the agent block keeps its "Spawn map core" anchor.
- **Pins** (*"need the tab targetting to set the specific mob in a synced way on the map once it's certain"*):
  targeting a live NPC pins its spawn id to a point ONLY when `_mapAttribute` is certain (≤60 units, the next point
  ≥2× or >120). A pin is sticky (a pulled mob stays pinned), name-guarded (the server reuses spawn ids), spent on
  death. Agent 3.7.133 (beta `20cb464d`).
- **Shared timers — guild-wide per zone** (my default, offered to the guild lead to change): bot 3.1.248 (main
  `1f3f5e67`), table `map_spawn_events` (service role only, 24 h retention, pruned on push), `POST/GET
  /api/agent/map-sync`. Only certain events are shared (pinned sightings, assigned deaths, manual marks); a "?" never
  leaves the machine; local mode never syncs. **Known ceiling:** two guild raids in two instances of one zone see each
  other's events.
- **Pather routes** (*"did we find their path data?"*): bot 3.1.249 (main `1ffcdf75`) mirrors the Quarm dump's
  `grid` / `grid_entries` as ONE jsonb row per zone in `eqemu_zone_grids` (410 rows, 8 MB — a plain 711k-row table
  would have cost far more). The Al'Kabor fallback is barred for routes. First import run by hand 2026-10-12.
  Agent 3.7.134 (beta `31777156`) draws routes and measures a walker's distance to its route, so targeting it
  mid-route pins it.
- **Lag** (*"are we able to pull directly from EQ rather than waiting for the pipe?"*): no — we do not read the game
  client's memory; Zeal is the sanctioned surface and already streams at 10 Hz (PipeDelay 100). The lag was our own
  hops. Agent 3.7.134: Mimic pushes positions straight to the Map window (≤20/s, only while it is visible), a short
  smoothing window instead of a glide one interval behind, and beta knobs (Position Direct/Agent, Smoothing
  Off/Light/Smooth, a "pos N ms" readout) in the setup bar.
- **Fit + levels** (*"Fit Zone … should also have fit group or fit raid … a how far to include levels, same with
  spawns"*): one button cycles Fit zone → group → raid; "Levels ±N" (default ±100) replaces the floor list for walls
  AND spawn dots.
- **Zeal `/pipedelay` always printed 0** — a print bug (the setting object passed to `%i`), the value WAS applied.
  Upstream 1.4.8 has it too. Fork branch `pipedelay-print` (`53befe7`), merged into `test-all` (`d42dee6`); a
  one-line upstream PR candidate.
- **Open — outdoor walls:** Plane of Tranquility drew no walls. Our wall layer is horizontal slices of the collision
  mesh, and an open hilly zone gets one slice that catches only cliff edges; Justice, Valor, Torment and Sol Ro Tower
  have no rows at all until the website first renders them. Offered: **A** read the player's own map files locally
  (what Zeal draws, nothing published) with our slices as fallback; **B** better slicing + precompute every zone in
  the weekly sync. Recommended A now plus B's precompute. Waiting on the guild lead.
- **Also from today's dump inventory:** `eqemu_spawn2` holds 43,655 rows against 48,739 in the dump; spawn
  conditions, spell range/class columns and that gap are the recommended next mirror additions (waiting on a pick).

## §242 — Map overlay walls: the player's own map files (A), room and boss names (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · Map walls from player map files*

- **Pick** (the guild lead): *"A for outdoor walls sounds fine, please display names of the rooms and named bosses in
  the map"*. Then supplied a "Good's Maps" pack (566 zones, Zeal-compatible `L`/`P` files, dated 2023-11, **no licence
  file**).
- **Shipped:** agent 3.7.135 (beta `2cfbf9fd`). The agent reads `<EQ>/map_files/<zone>.txt` + `_1`…`_10` (Zeal's
  path) then `<EQ>/maps/<zone>.txt` + `_1`…`_3`, from every EQ folder Mimic knows (`_eqSetupDirs`), and the Map draws
  those walls and labels; zones without a file fall back to our EQEmu slices. Frame **server = (−file_x, −file_y,
  z)**, no swap — derived from `web/lib/zoneMap/brewall.ts` and checked against the real pack (a Plane of Tranquility
  merchant label vs its `eqemu_spawn2` row, within 2 units). Named / raid-target spawn points are labelled at any zoom;
  greedy collision avoidance, bosses first; a Labels toggle; "Walls: Auto / Ours only" in the setup bar.
- **Rule kept:** map-file content never leaves the player's machine — not uploaded, not synced, not in the repo
  (synthetic test fixtures only); `test/map-local-files.test.js` pins it. We do not host or redistribute the pack;
  sharing it with members by hand is the guild lead's call.
- **Also shipped today on the Map (beta, Mimic-only):** the top-right **Timers** button slides the timers list in and
  out (`8f44b741`), with **Widen window** (default — the window grows by the list's 216 px, the map keeps its size) or
  **Share space** (`b076d8a2`); a "Spawn height ±N" filter in the toolbar (game height units; ±25 ≈ your floor).
- **Offered, not built:** a Mimic button that installs a map-pack zip the player picks into `map_files`.

## §244 — Map: a known mob shows its own name, spawn id and symbols (2026-10-12, Mimic beta `37607ac3`)
*2026-10-12 · DECISIONS-2026-09-21.md · Map shows known mob name and id*

- **Ask** (the guild lead, with a Plane of Tactics screenshot): *"targetting needs to update the symbols. it does not,
  and it also needs to display spawn ID and pick which name it is."* The pin worked; the point kept drawing the
  symbols of every mob in its spawn group and named nothing.
- **Shipped:** when the Map knows which mob is up on a point (your pinned target first, else a sighting by you or the
  guild), the point draws only that mob's symbols, is labelled `<name> #<spawn id>` in green ahead of every other
  label (also with Labels off), goes green the moment you target it, and the hover card leads with that mob marked ▶.
  Room names now follow the Labels switch too. Overlay-only (`apps/mimic/map.html`); no agent change.
- **Earlier the same day, a Plane of Tranquility screenshot looked "awful"**: that install was on a Mimic before the
  map-file walls (§242). Updating fixed it; zones without the player's own map file still fall back to our sparse walls.

## §245 — Map walls: Brewall's maps from Zeal's repo; routes at any zoom; colours kept apart (2026-10-12, agent 3.7.136 beta `1c39c995`)
*2026-10-12 · DECISIONS-2026-09-21.md · Map walls, routes, colours from Brewall*

- **Report** (the guild lead, with a Plane of Tactics screenshot next to Zeal's own map): *"Pathing disappears when
  close enough in zooming. We need some differentiation in colors as well, pathing should be a different color, we
  could use the colors in the brewall maps, but we also don't see stairs like we do in the zeal maps. We should try to
  figure out which pather it is when highlighted and highlight that path green as well."* Then: *"we should use the
  brewall maps then"*.
- **Why the stairs were missing:** the player's own pack (§242) has Tactics in black, dark green and a few reds only.
  Zeal's in-game map is Brewall's (eqmaps.info, plus the projectmiragulmaps label layers), compiled into the DLL;
  the same text files sit in Zeal's public repo (`CoastalRedwood/Zeal`, `Zeal/zone_map_src/map_files`). Brewall's
  Tactics has green and purple floors, grey stair hatching, brown and red: exactly the screenshot.
- **Shipped:** the agent fetches a zone's `<zone>.txt` + `<zone>_1.txt` from there the first time the Map shows it,
  keeps them in `brewall-maps/`, and reads that folder ahead of `map_files` / `maps`. Plain GETs, nothing about the
  player; a 404 is remembered a week, a failure retried after 10 minutes. Checked live from a session: Tactics came
  back with 2,715 lines, 51 labels and Brewall's seven colours. We host nothing.
- **Colours:** the old 60%-toward-white lift turned every colour grey. Now greys keep their order (black walls mid
  grey, grey stairs lighter) and a coloured line is brightened at its own hue.
- **Routes:** were drawn only for pathers whose spawn point was on screen, so zooming in dropped them. Now every route
  inside the Spawn height range is drawn, in cyan (not a wall colour), and the pather you have targeted (pinned) is
  green, on top, at any spawn height.
- **Not done:** a choice to prefer the player's own pack over Brewall's (Brewall wins whenever it exists).

## §247 — Map ⚙ settings panel (2026-10-12, Mimic beta `92fcd318`)
*2026-10-12 · DECISIONS-2026-09-21.md · Map settings panel*

- **Ask** (the guild lead): *"give me a config section for the map that pops up similar to the hud's where we can
  toggle on or off different bits, same with spawn height and levels and whatnot, labels can stay as a button. turn
  off individual icons if necessary. background config and color schemas for each label/element."*
- **Built** as one design inside the HUD builder's family (sticky head, groups, ↺ per row), not as options: the ask
  named its model. A ⚙ in the Map toolbar opens a panel over the map's right side with the Levels and Spawn height
  sliders (moved out of the toolbar; Labels stays a button), 19 show/hide switches, the nine ability icons one by one,
  three colour schemes (Default = the previous colours exactly, High contrast, Colour-blind safe on Okabe–Ito) plus a
  picker per element (23), wall colours "map's own" or one colour, background colour + optional own strength, and
  label size 70–180%. One JSON object in the overlay's localStorage (`wp-map-cfg`), validated key by key on load.
- **Not done:** per-character settings (the HUD's are per character; the Map's are per computer), and an
  alternative layout (e.g. a floating palette) — say if the panel over the map is in the way.

## §248 — Map sharing: judged fair; scoped to your raid / group; zone-server port researched (2026-10-13, agent 3.7.137 beta `2e912ca1`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map sharing scoped to raid or group*

- **The ShowEQ question** (raised by members): the guild lead's call — sharing sightings and timers is *"fair and no
  different from typical callouts or other tool timers for spawns"*; the difference is only the logic placing a mob at
  its point at pull time. Sharing stays on. Recorded against it: upstream Zeal's own comment on the 250-unit
  `target_loc` cap reads *"(server policy), so this can't be used to locate spawns across a zone"*
  (`Zeal/named_pipe.cpp`, #239). The test build's cap removal (§243) is still in `test-all`; whether to pull it is open.
- **Pick: C** (A now, B later). **A shipped:** a guild map event is applied only when its sender is in your raid, or
  your group outside a raid (`_mapPartyNames`); solo, only your own. Zeal sends a zone id but no instance id, so the
  open world, our copy and the PvP copy of a zone shared one stream; a raid is one copy.
- **B researched, not built** (a Sonnet agent over Zeal `origin/main` and EQMacEmu): Zeal exports no zone-server address
  and no client offset for it is known. In EQMacEmu each zone process gets its own client port, world sends it in
  `OP_ZoneServerInfo` (`ZoneServerInfo_Struct { ip[128]; port }`), and ports are **recycled** when a zone process
  closes, so a port identifies a copy only while it runs. The public EQMacEmu source shows **no instance support**:
  Quarm's instances are a server-side addition we cannot read, so whether a copy gets its own port is unverified.
  Next step: the guild lead's Resource Monitor check (Network → eqgame.exe → remote port, open world vs instance).
- **New idea, not built:** pull grouping — a graph of neighbouring spawn points so that when several mobs come at once
  their likely points are suggested on the Map and linked from Extended Target (options in the reply).

## §249 — Map: player targets named, and who your target is on (2026-10-13, agent 3.7.138 beta `90b10749`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map names player targets and their targets*

- **Ask** (the guild lead): *"pvp targeting should work as well, where it shows who were targeting and who they're
  targeting from /assistbar ToT from zeal"*.
- **Shipped:** the map payload's target carries Zeal's target type and its `target_of_target` (the field the HUD
  already reads). The Map labels the target ring "Name → Their target" (name only when the target is not already
  pinned to a spawn point) and draws a dashed arrow from the target to its target when that is you, your group or your
  raid; anyone else gets the name only — their position is not on the pipe. A player target is never pinned to a spawn
  point (pins stay NPC-only). Two ⚙ switches (Target name, Target's target) and a colour in each scheme.
- **Limit, unchanged:** the target's own position still arrives only within 250 units on release Zeal (§243).

## §250 — Pull grouping: A picked; unpulled-on-its-spot pin rule shipped; copies and slow mode in timers (2026-10-13, agent 3.7.139 beta `fcb6b310`)
*2026-10-13 · DECISIONS-2026-09-21.md · Pull grouping suggestions and pin rule*

- **Pick: A** (suggestions only) for pull grouping, with the guild lead's refinements: pulls are not one group —
  *"typically monks, rogues, bards, some Shadowknights. paladins and rangers may get an initial tag also"*.
- **Shipped now — the pin rule** (*"if a mob is stationary, not aggroed (no assist currently when pulled) and is in
  the spot where it would typically spawn we can make that educated guess and associate it"*): a live target is tied
  to its point only when it has no target of its own on Zeal's assist bar AND stands on the point (≤ 8 units) or has
  held still within 3 units for 1.5 s; walkers may move. Before, a mob running at someone through another same-name
  point could be pinned there. Candidates are still only points whose spawn list holds the name.
- **Designed, next to build — pull suggestions:** for each Extended Target mob not tied to a point, the candidate points
  are those with its name in their spawn list, not holding another live mob, not under a running "not yet" timer, near
  a raid member of a puller class (MNK, ROG, BRD, SHD, PAL, RNG) when the mob first appeared. Shown as dashed "?" on
  the Map and "probably from …" on its Extended Target row; never shared or timed until confirmed.
- **Asked, needs data — copies and timers** (*"spawn timers need to take into account the slowmode for instance or
  variability if in PVP"*; *"start referencing if people are in guild/guild-slow in raid/live/pvp"*). Known: slow mode
  (§237) is 18 h vs 3 h for the second-floor Bastion of Thunder named; PvP timers vary ±20%; guild-instance bosses are
  3 h from death (#288). Not known: which line, if any, the client prints on entering a guild, guild-slow, live or PvP
  copy, and whether trash respawn changes in those copies. Waiting on the guild lead's capture before any timer
  changes.
- **Facts added the same day** (the guild lead): *"if one guild instance is slow mode they all are for us"* — slow mode
  is guild-wide, not per zone, so the bot's one `slow_mode` switch is the right shape for every copy we own. And
  *"people will sometimes go in other guild instances, like breakfast club. they must be in a raid to join those"* —
  so a member in another guild's copy is always in that guild's raid. Consequences: the raid/group scoping (§248)
  already keeps their sightings and timers out of ours (different raid); a copy can be labelled "another guild's"
  when the member's raid is mostly not ours; our slow mode never applies to someone in another guild's copy.

## §253 — Map: ⚙ settings open beside the map, in the Timers slot (2026-10-13, Mimic beta `ad97bd27`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map settings open beside map in timers slot*

- **The ask** (the guild lead): *"in the map overlay the customization should open up to a new section to the side
  where the timers would be so you can update the map at the same time"* (with a screenshot of the settings panel
  covering the map's right side).
- **Shipped:** the settings are a column of their own, the same width as the Timers list, beside the map. With the list
  out, the settings take its place and the Timers button brings the list back; with the list slid in, opening the
  settings opens the slot the way the Timers button does (the window widens, or the map shrinks in "share space") and
  closing gives it back. `apps/mimic/map.html` (`setCfgOpen`, `slotOpen`, `slotChanged`).

## §255 — Map aggro rings with a ◯ toolbar button (2026-10-13, bot 3.1.252 `f7dc2bba`, Mimic beta `97bad067`, agent 3.7.142 beta)
*2026-10-13 · DECISIONS-2026-09-21.md · Aggro rings on the map with toolbar button*

- **The ask** (the guild lead): *"add aggro rings onto the map, make a circle icon on the main screen."*
- **Shipped:** the bot's zone data now carries each NPC's `aggro` radius (`eqemu_npc_types.aggroradius`, game units;
  17,054 of 18,033 NPCs have one, median 60; 0 → null). The Map draws a ring per spawn point, scaled with the map and
  under the dots: the up mob's own radius when one is known there, else the widest of who can spawn there (cautious).
  No ring while the point is on a "not yet" respawn timer, none when it would be under 4 px, and values past 1000 (the
  database's "whole zone" sentinels, up to 10000) are ignored. ◯ on the toolbar is the switch (off by default,
  remembered), the same as ⚙ → Show → Aggro rings, with its own colour in every scheme. A zone cached before today is
  re-checked once early so the rings show without waiting out the daily revalidation.
- **Not done:** assist radius (only 1,834 NPCs have one; the server default covers the rest, which we do not know).
  *Done in §257, drawn only where the database has one.*

## §256 — Map routes: random wanderers draw as waypoints; a walking target lights its route (2026-10-13, Mimic beta `c2d68090`)
*2026-10-13 · DECISIONS-2026-09-21.md · Random wanderers drawn as waypoints, route highlight*

- **The ask** (the guild lead, with screenshots of a golem in Plane of Valor crossing the drawn line): *"this mob is
  going across the map and not on a path line. Ideally it would highlight the path line."*
- **Why it crossed the line:** its grid (Plane of Valor grid 1) is EQEmu wander type 8, RandomCenterPoint. Types 1, 2,
  5, 7 and 8 walk straight to a random waypoint, so a line through the waypoint list in order was a path nobody walks.
- **Shipped:** those types draw as waypoint diamonds only; the ordered types (0 circular, 3 patrol, 4/6 one-way) keep
  the dashed line. An unpinned target (a walker that left its point before you targeted it) now lights the route its
  name walks: of the routes its spawn points use, the one with a waypoint nearest the mob. A pinned target keeps its
  point's route. The guild lead's follow-up screenshots confirm the green diamonds on the golem's grid.

## §257 — Aggro rings coloured by faction and your con, a dashed social ring, and a ring on your target (2026-10-13, bot 3.1.253 `46303546`, agent 3.7.144 beta `c1fd5534`)
*2026-10-13 · DECISIONS-2026-09-21.md · Aggro rings coloured by faction and con*

- **The ask** (the guild lead): *"This tree frog is dubious, we should have a different color for him … faction matters
  here but for mobs with no faction we could make the assumption that they will not aggro, and solidify it once we
  have the mob targetted and know its exact faction … Green if it's not aggro to anyone, yellow if it could be KOS to
  some but is not to the player. Then a dashed line for social aggro distance"*, and *"This pather does not have his
  aggro radius drawn"* (its ring sat at its spawn point while it walked).
- **Data:** the bot's zone data adds each NPC's `fac` (`npc_faction_id`, 0 = none: 2,113 of 18,033 NPCs) and `assist`
  (`assistradius`, 0 → null). Quarm's data carries generic factions by name ("Beta Dubious" for the frog, "Beta KOS"
  for the golem), but a real faction's KOS-ness depends on the player's own standing, so the con decides.
- **Agent:** keeps your latest /consider per mob name, EVERY tier including the hostile ones the faction upload drops
  (a mob scowling at you mid-fight is KOS to you right then; the next calm con corrects it), six hours, per character;
  sent with the map state as `cons`.
- **Map:** green = no faction (assumed never aggros, until a con says otherwise); yellow = has a faction and your last
  con was dubious or better; red = conned threatening/scowling, or not conned yet (the cautious reading, and every
  NPC of a zone cached before today). A point with no known mob up takes its worst NPC. The dashed ring is the assist
  radius, drawn only when it differs from the aggro radius. Your target carries its own rings at its live position.
  Three new colours per scheme (colour-blind: blue / yellow / vermillion).
- **Not done:** con lines are matched by name, so two same-name mobs on different factions share a colour; no spawn id
  rides a /consider line.

## §259 — Roamers pin to their spawn point: route twins and random-wander distance (2026-10-13, agent 3.7.145 beta `37518472`)
*2026-10-13 · DECISIONS-2026-09-21.md · Roaming mobs pinned to their spawn point*

- **The ask** (the guild lead): *"roamers are not capturing their spawn ids on the map, or tags."* Read as: a roaming
  mob never got pinned, so it never showed its `#id` or its name label on its point.
- **Why:** Plane of Valor's golem spawn group has five spawn points that all walk grid 1. A walking golem was the same
  route distance from all five, and `_mapAttribute` only pins on a clear winner, so it never pinned. Grid 1 is also a
  random wanderer (type 8), so distance to a line through its waypoints in order was wrong anyway.
- **Shipped:** points that share a route AND the same respawn and variance count as one candidate (the nearest spawn
  spot). Whichever of them the mob came from, the route and the timer are the same. A random wanderer's distance is to
  its waypoints' bounding box (0 inside). The Map's label for an unpinned target now carries its spawn id.
- **Kept honest:** twins with a different respawn are still a "?". A box, not a hull: an L-shaped wander grid could
  over-claim its empty corner (marked `ponytail:` in the code).

## §260 — Map readout: your /loc, speed and the cursor's /loc; a • spawn-points button (2026-10-13, Mimic beta `d3dff52b`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map readout of location, speed, spawn-point toggle*

- **The ask** (the guild lead, pointing at Zeal's map): *"the run speed and the current player location coordinates in
  the top left ... as well as the mouseover coordinates where the player's cursor is. Showing/hiding spawnpoints should
  be a quick-button on the top nav of our map next to the circles."*
- **Shipped:** top-left of the Map, in /loc order (Y, X): your location, your speed, and the cursor's location while
  it is over the map (works locked: the window still hears the mouse). • next to ◯ is ⚙ → Spawn points.
- **Speed is game units a second, not Zeal's "% of normal run".** The pipe sends no speed and we have no measured
  base run speed to divide by. One unbuffed run timed on the Map would give the base, and then % is a one-line change.

## §262 — Map: the target's walked path, Opacity first, zoom and pan from the Pan / zoom button (2026-10-13, Mimic beta `d646bdd4`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map shows target's walked path, zoom and pan*

- **The ask** (the guild lead): *"Can we show the path that we observed a mob walking towards? Own strength should say
  opacity in the options and should be right at the top. If you mouse over pan /zoom you should be able to zoom in and
  out, and if you click and drag on that button we should pan."*
- **Shipped:** your target's positions since you targeted it (three minutes, fading) with an arrowhead down its last
  stretch (⚙ → Target's walked path); "Own strength" renamed Opacity and moved to the top of Map settings; the wheel
  over Pan / zoom zooms and a drag from it pans, both while locked, a plain click still toggles Pan.

## §263 — Map: two roamers on one route, your target's point at any height, kept walked paths, con-colour names, Brewall layer walls (2026-10-13, agent 3.7.147 on beta `0f7a48ce`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map handles two roamers on one route*

- **The ask** (the guild lead): *"Going above a spawn point should still show you the spawn point of the creature
  that's targetted. This is attributing both of these pathers to the same spawn point."* Then: keep the extrapolated
  previous/next waypoint of a random path as part of that mob's path while targeted, show it again on a re-target,
  graded from the target colour back to the origin; names in con colour as an override; *"Default colors should
  probably be the same as the Brewall ones"* (eqmaps.info mapping standards).
- **Shipped:** a spawn point already held by another pinned mob loses a tie on a shared wander route, so two roamers
  get two points; the target's point draws at any height; walked paths are kept per mob (up to 40 mobs) and redrawn on
  re-target, with each random-wander leg drawn dashed from the waypoint it left to the one it heads for, and a gradient
  from the target colour to the spawn-point colour; ⚙ → "Mob names in con colour" (off by default, the agent now sends
  your level); walls default to Brewall's layer colours above (Layer 2–7) and below (Layer 8–11) your floor, your own
  floor keeps our wall colour because Brewall's black "Main" vanishes on a dark map. A saved "map" wall mode migrates.
- **Still open, options given in chat:** Target Info map tab + history ✕ + search, map buttons on other overlays,
  raiders' zones on the Map, and a Planes of Power era atlas (continents and planes, click down into any zone). The
  guild lead supplied a PoP-era world atlas picture as the layout reference; it is not ours to commit.

## §264 — Map refinements round: learned roamer paths, trail states, kill fading, Follow/Fit/Labels, movable buttons; overlay tooltips and mouse-over fade (2026-10-13, bot 3.1.255, agent 3.7.148–3.7.150 beta, Mimic beta to `791cb572`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map refinements round and ledger doc*

- **The call** (the guild lead): *"made sure all of this from tonight is actually recorded into a specific map
  refinements doc"*. **`docs/MAP-REFINEMENTS.md` is now the ledger for every Map refinement**: each ask quoted, what
  shipped with its version or commit, and the open list. Add to it in the same change as any Map refinement.
- **Shipped this round** (details and quotes in the ledger): walked legs remembered per route with a count and a
  direction arrow at 60%; the target's route lit, others faded; seconds to the next waypoint; spawn group under the
  target (bot 3.1.255 sends `sg` / `spawngroups`); trail yellow / red / reddish-orange by what the mob is doing with a
  red glow where it left home; killed paths fade, drop out after 3 kills, return faded for the next mob from that
  point; a dashed heading line ahead; shared-route pins drawn to every point on the route; Follow keeps your screen spot
  (right-click locks); Fit ignores stragglers and uses your raid group in a raid; Labels all / targets / off; • hides
  route markers; a ⠿ grip moves the button bar and locks it to an edge (upright on the sides); the readout scales.
  Every overlay: tooltips close after 3 s; Mouse-over opacity / Fade delay / Fade duration, EverQuest's own fade model.
- **Open** (ledger §2): detachable timers window, the PoP-era atlas, Target Info map tab + search, map buttons on other
  overlays, raiders' zones, sharing learned paths across raiders, Follow target, distance from spawn + the gate/leash
  rule (researching).

## §273 — Map Line strength: one dial for how hard the lines and dots draw, Strong by default (2026-10-13, agent 3.7.157 beta `c04db4ea`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map line strength dial, strong by default*

- **The ask** (the guild lead, with an in-game screenshot): *"Can we make the maps and spawns more intense for how
  defined the lines and whatnot are? this is opacity full on the window and off for background and its difficult to
  see"*. Opacity was already full, so the fix is weight, not alpha.
- **Shipped:** `inkStyle(k)` in `map.html`, k from 1 to 3. It scales wall and route width, puts a dark edge under walls
  and routes, grows spawn, raid and group dots, and strengthens the aggro rings and the faint off-floor walls.
  ⚙ → **Line strength** (Normal / Medium / Strong / Max) sits under Opacity and saves with the map settings.
- **Default is Strong (1.75)**, so the change reaches everyone without a setting; Normal (1) reproduces the old drawing
  exactly, and the test pins that.
- Also fixed on beta: `web/lib/gameAccounts.ts` read the guild by a quoted literal, which the guild kit's no-literal
  tests on beta rejected once the accounts page synced over from main. It now reads `GUILD_TAG`.

## §274 — The Map learns a path only from a mob that is walking, never from one chasing someone (2026-10-13, agent 3.7.158 beta `fd50adc5`)
*2026-10-13 · DECISIONS-2026-09-21.md · Map learns paths only from walking mobs*

- **The report** (the guild lead, with a screenshot of a swarm kited by a bard): *"These mobs in a swarm are showing
  that they're on a bunch of paths that they're not, so we need to ignore when a mob is aggroed and has a circular
  path chasing a bard"*.
- **Cause:** a random-wander leg was learned whenever the target headed at a waypoint and reached it. A chase sweeps
  through waypoints constantly, so each pass was saved as a walked leg (and twice-seen legs draw solid).
- **Rule now:** a leg is learned only if (1) the mob never had a target of its own while you watched it (Zeal's
  target-of-target), and (2) its last leg-length of walking was nearly straight (straight-line distance at least 0.8
  of the distance walked, and at least half the leg seen). (2) also covers a Zeal that sends no target-of-target.
  While the target is chasing, the "leg to the next waypoint + seconds" is not drawn.
- **Not done:** legs already learned from earlier chases stay in the local `map_timers.json`. Clearing them needs a
  "forget learned paths" control, offered to the guild lead rather than built.

## §280 — Recorded raid positions also refine the raid-guide paths (2026-10-13)
*2026-10-13 · DECISIONS-2026-09-21.md · Recorded raid positions refine raid-guide paths*

- **The call** (the guild lead): *"are we tracking everyone's positions through the raid so I can replay it on the
  map? we should be ... storing those as we discussed previous, so we can refine the path for these raid
  guides"*. A second use for §161's recorder: the paths drawn on https://wolfpack.quest/pop/raid should come
  from where the raid actually walked, not only from the scripts' coordinates.
- **Measured the same night:** `raid_track_minutes` holds 1,964 minutes (5.5 MB) from 2026-10-06 on, every day,
  with the sweep off. Wednesday's target zones already have earlier minutes: Innovation 193, Nightmare 136,
  Disease 115, the Lair 15, Valor 15.
- **Still not built:** the replay viewer (§161's A/B/C look is unpicked; the previews promised for after
  2026-10-07 never landed) and any path learned from the recordings. Tower's permanent copy is still the open
  STATUS item (its merge script is not a git checkout).
- Options for both offered the same night; the picks are open.

## §281 — /pop/raid: the preflag check works, and the page links everything (2026-10-13, web 1.8.149 main)
*2026-10-13 · DECISIONS-2026-09-21.md · Raid page preflag fix and added links*

- **Report (the guild lead, phone screenshot):** "Could not read the raiders: characters: column characters.level
  does not exist". Plus: *"link to the subsections from the overview, add in mouseover for items and link to
  PQDI. links to PQDI for the mobs"*.
- **Two bugs, one hidden behind the other.** The query asked `characters` for `level`, which lives in
  `who_directory`. With that fixed it would still have shown nobody: it kept only rows with `main_name` null,
  but a main's `main_name` is its own name (0 of the 233 characters of tonight's 66 sign-ups had it null; 52
  players have a main). Now it reads every character a signed-up player has, keeps the mains, and picks one
  per player by the class they signed up as, then active, then raider rank.
- **Loot now comes from the server's drop tables** (`eqemu_npc_drops`), not hand-typed lists, which were wrong:
  Grummus drops eight items at 12.5% each, not "one of five", and Vhaksiz and Mujaki have parchments and gems
  the list left out. Each item has the inventory page's hover card and a PQDI link; each boss name links to
  its PQDI npc page.
- **Overview:** a numbered list at the top linking the preflag check, each zone and each boss (`bossAnchor`);
  each preflag names the zones that need it, linked.
- **The test missed it** because nothing ran the query. `test/pop-raid-plan.test.js` now checks that no
  `characters` select names `level` and that the main filter accepts a self-named main.

## §278 — /pop/raid: one page for the raid night (2026-10-14, web 1.8.148 main)
*2026-10-14 · DECISIONS-2026-09-21.md · Raid night page with preflags, travel, maps*

- **The call** (the guild lead, 2026-10-13): *"this is our target list for tomorrow. make us a raid page that has
  preflag checking, travel guide, expectations, and maps with paths preferably"*. Targets: Grummus; Manaetic
  Prototypes X, IX, XI and the Behemoth; Vhaksiz and Mujaki; Terris Thule; Aerin`Dar. A new page, so it went
  live with the [beta] marker (§135).
- **Travel facts from the guild lead:** the guild-instance doors are in the buildings around the PoK book in
  Tranquility, grouped by tier: tier 1 south, tier 2 north, more of tier 2 and tier 3 east. And: *"in order to
  zone into new zones we do need to zone into live first via the standard portals"*. The page says both; it
  does not name which side Valor's door is on, only that Valor is tier 2.
- **What it shows:** a preflag table for everyone signed up to the night's event (`rh_events`/`rh_signups`, the
  roster as fallback), each target's must-have steps from `web/lib/popSteps.ts`, travel and boss notes read off
  Quarm's scripts and spawn tables ("(inferred)" where the scripts do not say), and a map per zone with the
  route, the markers and the patrol. Walls come from the EQEmu layer only (`zone_map_lines.segs`), never the
  Brewall art. Innovation runs in the guild's order: X, IX, XI, then the Behemoth. The travel notes fold behind
  "Click here for more info", like /pop's top.
- **Where:** `web/lib/raidPlan.ts` (all content), `web/app/pop/raid/` (page, map, walls), `test/pop-raid-plan.test.js`.
  The plan is dated for one night; the next raid needs a new plan or the file edited.

## §282 — The raid plan on /screen: slides (A) and on the live map (C) (2026-10-14, web beta `e958a8a4`)
*2026-10-14 · DECISIONS-2026-09-21.md · Raid plan as slides and on live map*

- **The call** (the guild lead): picked **A and C** of the three /screen options.
- **A — slides.** An officer presses "Load tonight's plan" in the slide editor; the plan becomes "Plan · …" slides
  after the officers' own (16 today: Tonight, Preflags, then per zone before+travel and one per boss; capped at
  30, long bodies split, never cut). Pressing it again replaces only the "Plan · …" slides. `web/lib/raidPlanSlides.ts`,
  POST `/api/screen/slides` `{action:'loadPlan'}`.
- **C — map.** When the screen's live map shows a zone in tonight's plan, the route, bosses, zone-ins, NPCs and
  patrol are drawn under the raid dots (a "Tonight's plan" chip hides it). It shows nothing until raiders are in
  that zone. `SpectatorBoard`'s new `plan` prop is passed only by /screen, so https://wolfpack.quest/spectator is
  unchanged. Overview gains a Preflags box (who still lacks each one), loaded once per page load.
- **Code move:** `loadRaiders`/`loadHeld` left `/pop/raid`'s page for `web/lib/raidPreflags.ts` on beta. Main still
  has them inline until this graduates, so a main edit to them before then will need a hand merge into beta.
- **Not done:** plan points have no height, so the map draws them on every floor.
- **Next:** the guild lead looks at https://b.wolfpack.quest/screen; on a yes it graduates to main before the
  19:30 ET freeze.

## §336 — Kite loops: a live drift coach and a guild loop library (B + C); floor art follows §220 (2026-10-15)
*2026-10-15 · DECISIONS-2026-09-21.md · Kite loop drift coach and loop library*

- **The ask** (the guild lead, with two Map screenshots of a kite): *"common non-drifting circles and speeds are worth
  us hanging onto. [one raider]'s loop here is flawless. mine is not"*. The yellow loops on the Map are the TARGET's
  crumb trail (`trailStep`), memory only, wiped on zoning; nothing kept loops before this.
- **Picked B and C** (A, a local "keep this loop" pin, not taken):
  - **C, drift coach (Mimic Map, local):** your own position at Zeal's rate, a circle fitted per lap, the last lap as
    a ghost ring, and a chip with lap time, radius, centre drift (and its direction), wobble and speed %.
  - **B, guild loop library:** after 3 clean laps Mimic sends ONE fitted circle (zone, centre, radius, lap time,
    speed %, drift, wobble, laps, direction) — never the path, never who ran it — and every Map shows the guild's
    best loops at each spot as guide rings with a pace dot, plus "vs guild" on the coach.
- **Bot 3.1.275 (main):** `POST /api/agent/kite-loop`, `GET /api/agent/kite-loops?zone=` (`utils/kiteLoops.js`); table
  `kite_loops` (migration `20261015120000`, applied 2026-10-15) with NO uploader column; the uploader is used only
  for an in-memory rate limit (30/hour). Same spot = same direction, centre within 0.35 r, radius within 25 %, z
  within 40 (another floor stays apart); the cleaner loop's geometry wins, `seen` counts repeats; 60 per zone.
  quality = 0.45·drift score + 0.35·wobble score + 0.20·laps score. `kite_loop` is sheddable. PRIVACY.md updated.
- **Mimic side (beta):** in progress at the time of writing.
- **Floor art** (the guild lead: *"we could use some floor graphics, even if rudimentary"*) is already decided in
  §220: the website gets none / lines / **parchment generated from our own walls, floors and spawn density**, and
  3D-A stays the EQEmu mesh **shaded with no textures**; painted art and real textures are Mimic-only via the local
  converter (3D-B). Building the web part on the replay page now; no new pick was needed.

## §343 — Rampage reach on the map, from the server's own rules (2026-10-15, bot 3.1.278–3.1.279, agent 3.7.183–3.7.184)
*2026-10-15 · DECISIONS-2026-09-21.md · Rampage reach drawn on map*

- **The asks** (the guild lead): *"HOW WIDE IS AREA rampage FOR THIS MOB? IS IT THE SPACE AROUND THE TANK OR A RADIUS
  AROUND HIM? CAN WE MARK THAT AREA RAMPAGE ON THE MAP"*, then *"show regular rampage range too"*.
- **Read from the EQMacEmu source Quarm runs** (re-implemented in our words; GPL):
  - **Area Rampage** (ability 4): centred on the MOB; hits everyone on its hate list except the current target (unless
    the list has one entry), not feigned, within its melee reach: 0.75 × (mob bounding radius + player radius 5), at
    least 14, +2 when the mob stands still, plus the height difference, at most 75 (60 if perma-rooted). Bounding
    radius = per-race base (default 6) × size ÷ 5. Chance param0 (default 20%), targets param1 (unlimited), damage
    param2 (100%). Example: A Recuso Degenerate (race 237, size 12) → 14.4 radius, reach 14.55 moving / 16.55 still, 5%.
  - **Rampage** (ability 3): hits ONE entity — the first on the mob's rampage list that is not its target, not feigned,
    within range param1 (default 75). Chance param0 (default 20%).
  - **The rampage list** (the guild lead's "engagement slots"): every hate add (melee swing incl. misses, damage, any
    detrimental landing incl. resists, the first bard pulse; heals/buffs on a hated member 50% within 500 units; a pet's
    client owner) takes the first empty slot or appends; death, camp, zoning, invis/escape, resurrection, a far summon
    or 10 min without hate empties it; feigned clients keep theirs; standing from FD drops you under level 35 always,
    otherwise 35%. Unbounded (no 5-slot cap). DoT ticks do not add.
- **Built:** `utils/aeRampage.js`; mob-info carries `ae_rampage` and `rampage` (`_MOB_PACK_VERSION` 7); the Mimic beta
  Map draws, around the TARGET, a red dashed "AE rampage · r" ring and a dotted "Rampage · range" ring, each with its
  own layer switch (default on). The rings are the equal-height reach; the server adds height difference.
- **Open:** engagement slots in Target Info — research done (we can only reconstruct the list from logs; non-damaging
  song pulses leave no trace); options A (this raider's log) / B (raid-wide merge at the bot) put to the guild lead,
  A recommended. Not built.
- **Dropped 2026-10-15** (the guild lead): *"maybe we shouldn't do the ramp list since it's not going to be easy to
  determine"*. The rings stay; the engagement-slot list is not built. Reopen only with a reliable source for every
  hate add (a Zeal or server feed), not log reconstruction.

## §351 — Map: watch a named's placeholder spot — "A now, then C" (2026-10-16, bot 3.1.287, agent 3.7.189 beta)
*2026-10-16 · DECISIONS-2026-09-21.md · Map placeholder-spot watch and shared timer*

- **The ask** (the guild lead, on The Avatar of Anguish's spots): *"Lets add point of interest to targets on the map to
  figure out what path we should take. And when we snipe a single mob we should be able to mark it and create a timer
  for everyone with the named PH spot and map loc ... right now the spawn list is a little hard to read."*
- **Options offered:** A — watch a spot (one click, guild timer); B — free labelled pins; C — hunt list (pick the
  named, the map lights its spots and draws a route). **Picked: "A now, then C".** C builds on A.
- **A shipped:** a spot whose spawn group holds a named gets "★ Watch for <named>"; watches are guild-shared per zone
  copy for 12 h (bot_kv `map_watch:<zone>`, no migration); a placeholder death or empty mark there is taken from
  anyone in the same copy, not just your raid; the window shows in the Timers window / Canvas as
  "★ <named> PH · spot #id · /loc Y, X". Respawn list: a ★ Watched section first, same-name rows folded ("×4"), a
  larger time column, a background that never drops below 94%.
- ⏳ Check one watched spot's `/loc` in game against the label (axis order Y, X follows the Map's own readout).
  ⏳ The timer rows exist only while the Map overlay is open (the zone data and sync live there). ⏳ C next.
- **Corpses on the Map** (the guild lead: *"WE SHOULD show where people died on the map"*): options A (own corpses),
  B (guild corpses, from the death Mimic already sends for the corpse DM), C (whole raid, from Zeal raid positions)
  offered; ⏳ waiting on the pick.

## §400 — Raid timeline for the Plane of Tactics pairs; the map explorer is kill to kill (2026-10-21)
*2026-10-21 · DECISIONS-2026-09-21.md · Tactics pair timeline strip, kill-to-kill explorer*

The guild lead, 2026-10-21, the night before the Zek fights: *"a tracked timeline view ... at the top of the
spectator/replay pages. The death timers between mobs is something we want easily and clearly displayed versus
having to say it out loud ... a timeline view show up on the bottom of the TTS."* Picked B (the strip) over C
(stopwatch cards).
- **Rules (from `apps/mimic/pop-raids.js`):** the two Decorins within 6 minutes of each other; Tallon Zek and
  Vallon Zek within 20. Held in `web/lib/raidTimeline.ts` and the agent's `DEATH_PAIR_RULES`.
- **Web 1.9.20:** `web/components/RaidTimeline.tsx` at the top of `/spectator` (polls the members-only
  `/api/spectator/timeline`, curated kills by `ended_at`) and `/spectator/replay` (the board's boss list, the
  playhead is "now"; Rallos Zek the Warlord has no spawn point, so the replay strip lacks him).
- **Agent 3.8.40 (beta):** `_recentMobDeaths` from the slain lines this PC prints; `triggers.html` bottom strip.
- **Data, done 2026-10-21:** Tallon Zek, Vallon Zek and both Decorins had no `bosses_local` row, and their names
  are shared by other NPCs (Plane of Time, event bodies), so `_resolveBossForPersist` would refuse the kill as
  ambiguous. Curated rows added: `tallon_zek` 214026, `vallon_zek` 214316, `decorin_berik` 214056,
  `decorin_grunhork` 214057.
- **Map explorer:** B, kill to kill (*"A already is recorded technically"* — the replay board). Timing starts at
  the first engage, not zone-in (*"precleaning makes a difference"*), and each leg shows the clearing: *"time
  between named and which spawns we clear."* New page `/raid/routes` built as web 1.9.21 (waits on the main push).
- **Overlay strip, later the same night:** *"Timeline on TTS minimizable, text size scalable, next event due for
  next fight. Next major event in fights queued"* — ▾/▸ collapse, A−/A+ scale, Up next queue, next plan phase
  (beta, `28a4fd99`). *"i need a way to test these things before our raid nights"* — Replay drives the strip as a
  ⏪ rehearsal on the log's own clock (agent 3.8.41, beta).

## §405 — The pre-raid checklist's "our average" comes from OpenDKP ticks, not the live roster (2026-10-22, bot 4.0.2)
*2026-10-22 · DECISIONS-2026-09-21.md · Pre-raid checklist average from OpenDKP ticks*

The guild lead, 2026-10-21: *"these numbers are so skewed"* — the post said "thin roster (52 vs ~82) · 11 class shortages".
- **Cause:** the average was read from `raid_roster`, which the log-ingestion cut (§348) keeps to about half a day. "Typical" was
  every distinct character logged in earlier that day (a morning raid with another group, every alt swap): 82. It also set
  CHARACTERS against signups, which are PLAYERS.
- **Now:** `utils/typicalRaid.js` reads the last six Sun/Wed/Thu nights (never tonight) from `opendkp_raids` + `opendkp_ticks`,
  counts each player once per night (a character's family; the class of the character on the most ticks), and skips a night
  under 30 players (an alt raid or a stub). Fewer than two usable nights prints "Not enough history", never a number.
  Signup classes and character classes go through one spelling (`Shadowknight` and `Shadow Knight` were two classes, so
  Shadow Knights always showed as short).
- **Why OpenDKP and not `raid_attendance_ticks`:** officer-curated, leaves the small alt-raid nights out by itself, and is not
  fed from `raid_roster`. Its weakness is a night nobody entered (the 1 to 11 October 2026 nights were never entered), which only shortens the history.
- **Open:** the six-night window currently spans the PoP unlock (about 47 players before, about 61 after).

## §407 — The route planner on the website, off-night plans by fewest raiders, and the Sol Ro tower (2026-10-22, web 2.0.2)
*2026-10-22 · DECISIONS-2026-09-21.md · Route planner on site, off-night plans, Sol Ro*

The guild lead, 2026-10-21/22: *"put the route planner into the site as is in the tactics route artifact.. put it into the
planner where we can see previous and build in the named and ones in the plan"*; *"Add optional legs. Splits where we divide
for specific tasks"*; *"set us up to do this with the next progression in tower of solusek ro. include mobs and pathers"*;
*"we will want to establish these for off night targets as well. the goal with those is how few raiders we can accomplish
those events with"*. Map editor calls, *"all recommended"*: officers edit; v1 is pins + doors / teleports + following our
recorded paths (navmesh routing later); Quarm's own EQMacEmu maps are the truth for walls; a saved route belongs to the
zone, with dated versions.
- **Where:** `https://wolfpack.quest/raid/plan/routes` (new page, `[beta]`), `?zone=` and `?plan=`. Stored in `bot_kv`
  `route_plan:<zone>` (no migration): a main plan plus up to 12 off-night plans per zone, 30 versions each. "Send to
  in-game map" writes `raid_route:<zone>`, which the bot serves to Mimic's Map (bot 4.0.2, agent 4.0.1).
- **Off nights:** a plan has a night type and a target headcount; splits carry their own headcount. Every boss shows the
  smallest group we have killed it with (PLAYERS, not characters; the damage dealers united with the raid recorder) and
  that group's classes (`web/lib/fewestKills.ts`, also `GET /api/raid/fewest`).
- **Tower of Solusek Ro:** 11 floors, 33 bosses / named / scripted spawns, 375 trash points, 12 pathers, 10 real
  teleporters plus doors and zone lines. The lava rune doors need all five wing flags (`sol_room` 11111) and the Zek flag;
  the Lava Well zone line's spot is approximate. No recorded nights yet, so Follow paths and Compare wait for the first raid.
- **Open:** which bosses are the off-night targets (default: the Tallon and Vallon home wings); the fewest headline counts
  everyone present (A, the default) unless the guild lead picks B, damage dealers only.

## §421 — Traps on the Map: the zone script is the source, a guide is a cross-check (2026-10-23, bot 4.0.12 main + agent 4.0.16 beta)
*2026-10-23 · DECISIONS-2026-09-21.md · Traps shown on Map from zone scripts*

*"maps should show traps as well"*, then *"consume this for traps"* (a third-party Plane of Earth trap guide). In the Planes of
Power a trap is a TRAP NPC spot, not a floor trap: `poeartha/encounters/Traps.lua` maps 13 invisible helpers on 73 spots to
{trap mob, named, placeholder}; walking in spawns the trap mob, and the 5th pull of a type spawns the named or its placeholder
(50/50). The guide's 12 pairs are all in the script; it pairs two placeholders differently and omits one type — the script wins
(standing rule: *"always go off of the scripts and database instead of the guides"*). The server's classic `traps` table is now
mirrored (`eqemu_traps`, 83 rows in 8 zones, none in PoP). The Map draws both, ⚙ Traps on by default. The web maps (Spectator,
replay) draw walls only, so they have no traps yet.

## §422 — Run speed: Zeal's % is the speed you move at; ours was the chord, now the path (2026-10-23, Mimic beta, no agent change)
*2026-10-23 · DECISIONS-2026-09-21.md · Run speed matches Zeal's percent*

Kiting a loop indoors (a bard), Zeal's map read 116% while the Map's top-left read 104% and the kite coach about 102%: *"we are
not accurate to game"*. From Zeal's source (CoastalRedwood/Zeal `main`): `zone_map.cpp` `render_labels` prints
`(mount ? mount : self)->MovementSpeed * (100 / 0.7)`; `Entity.MovementSpeed` (0x5C) is the speed the entity is moving at now
(0 stood still; `game_functions.cpp` `CalcCombatRange` tests `> 0` for "is moving"). **The pipe's player message does not carry it**
(`named_pipe.cpp`: zone, location, heading, autoattack, spawn_id, target_*, pet_id), so we still measure.
- **Why we read low:** `speedOf` was the straight line between the first and last of the samples 1.5 s apart. On a turn that is
  shorter than the path: at 116% on a loop of radius ~35 u the chord reads 104% (reproduced in `test/run-speed.test.js`). The kite
  coach used `2 pi r / lap` of the fitted circle, which falls short on a squarish loop (about 5% on a rounded square in the
  test; the reported 102% is a bigger gap than that and is not fully explained without Zeal's number beside it).
- **The scale was right:** 116% = MovementSpeed 0.812, 277% = 1.939; with 84 u/s on a straight run the base 100% = 30.3 u/s fits
  both once the measurement is the path walked. Kept at 30.3, still ONE straight-run reading; the guild lead is asked for a timed
  straight run (Zeal % beside the Map's tooltip u/s) to tighten it.
- **Change:** `map.html` `speedOf` sums the segments of the window; `kiteCoach.js` `pathUps` joins samples >= 400 ms apart over
  the lap. Tooltip says "measured". `RUN_BASE_UPS` is guarded by `test/run-speed.test.js` (Map and coach must agree).
- **Exact value needs the guild's Zeal fork:** one line in `named_pipe.cpp`'s player block,
  `player_data["movement_speed"] = (mount ? mount : self)->MovementSpeed;` (mount = `self->ActorInfo->Mount`); then the Map shows
  `movement_speed / 0.7 * 100` with no base at all. Not done here (the fork and the agent's pipe reader would both change).

## §443 — A sign-up counts the character it signed up as; the per-person flag link; map timers through a bot restart (2026-10-26)
*2026-10-26 · DECISIONS-2026-09-21.md · Sign-up counts the character signed up as*

- **Live on main (web 2.1.43):** /pop/raid and the raid screen picked one character per Raid-Helper sign-up from MAINS
  only, so a raider who signed up as their alt's class was checked on their main (the guild lead: *"people sign up for
  raids as their class, which can be an alt and not their main"*). `pickSignupCharacter` (`web/lib/raidPlan.ts`) now
  takes the class they signed up as, alt or main, then the main. Measured over three weeks of sign-ups: 31 sign-ups by 15
  players were on an alt's class and none had two alts of it; 28 Shadow Knight sign-ups matched no one ("Shadowknight"
  vs "Shadow Knight", now compared by letters); ~60 rows with Tentative/Absence/Bench in the class field counted as going
  (now not). The bot's `/preraid` class counts were not changed.
- **Per-person flag link (open, the guild lead's pick):** A, a signed-in page `/pop/raid/me` (the character you are
  bringing first, every other character below with its steps left) — recommended; B, a private Discord reply from the
  card's My steps button. B needs the step engine in the bot too; a link button from the card to A gives most of B for
  nearly nothing. No sign-in-free token link: it would show a member's characters to anyone holding it.
- **Map timers through a bot restart:** the guild lead's model (*"hold our own timers per spawn id per zone id from the
  port … if the bot restarted and during that timeframe i killed something it would need to … sync them back in. Source
  is important."*) is mostly how it already works: local `map_timers.json` survives a Mimic restart, the pull refills
  from the bot, events carry spawn id + the copy's host:port token and are applied only to the same copy, and every row
  stores the reporting character and Discord id. The gap is the push: a POST that fails while the bot is down is dropped.
  A durable outbox (agent, beta) plus a dedup index so a resend never doubles (bot, main) is being drafted.
  **Shipped 2026-10-26:** agent 4.0.24 on beta (its own outbox on the map's push queue, kept in
  `map_sync_outbox.json`; the durable upload queue was not reused: per-kind envelope, 404 permanent, blocks agent updates while non-empty), bot 4.0.17 on
  main (migration `20261026160000_map_spawn_events_dedup.sql`, `insertIgnoreDuplicates`). The GET look-back stays 8 h on
  purpose: a port is reused once a copy closes, and a 24 h look-back could apply an earlier copy's event to the current one. Order to ship: bot
  deploys, then the migration is applied (SQL Editor or MCP), then the agent goes to beta. The guild lead ran the migration
  in the SQL Editor the same day (the MCP apply stalled at its approval prompt again); `map_spawn_events_dedup_idx` verified.

## §452 — Mimic map: heading up with the compass always on; kite circles; FB-100 / FB-103; FB-101 / 102 / 104 (2026-10-27, beta)
*2026-10-27 · DECISIONS-2026-09-21.md · Map heading-up mode, compass, kite circles*

- **Heading up** (the guild lead: *"allow map to follow player heading as well as cardinal direction, but make sure we're showing the
  cardinality on the map"*): North up / Heading up toggle on the Map; the compass is always drawn. Default **Rose** (corner dial, red north
  needle, N/E/S/W), with Edges and Both in ⚙ Compass. Text never rotates; drag, zoom and hit-testing use the un-turned frame.
- **Kite circles** (yesterday's asks, the draft found uncommitted in a worktree and finished): other raiders' circles age out and filter
  (Others Live / All / Off; Circles All / My speed / Near me); the drift forecast is ONE look, an arrow plus a landing ring. The faint-copies
  look was dropped because at a unit or two of drift per lap it sits inside the circle. That pick was the session's, not the guild lead's: say so
  if the other look is wanted.
- **FB-100**: the Respawns count opens into its spots; left click pulses, right click focuses (the guild lead's rule). On an opened spot row,
  right click is focus, so the old right-click off/on lives on the folded rows and the dots.
- **FB-103**: a group member's circle now shows while it forms, coached locally from group positions (never posted), dotted in their class
  colour. The guild library still holds only finished, anonymous loops.
- **FB-101** (agent 4.0.30): saved layouts keep positions and sizes across screen setups; ↩ Restore saved layout in the tray and on the
  Overlays tab. The XL / M presets on the trigger window are still unexplained (needs a device check), so FB-101 stays open.
- **FB-102** (agent 4.0.29): the Charm card times the buffs the pet reports, from Mob Info's landing when no other mob is proven.
- **FB-104** (web 2.1.57): Summon leads the special-ability chips in solid red, on Target Info and /db/npc.
- All of it reaches the stable fleet only with the next Mimic stable cut.
