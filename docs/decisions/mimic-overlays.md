# Mimic overlays & HUD

Every overlay window: how it looks, moves, docks and fits. Oldest first. Find an entry by its ID in [the index](README.md); new decisions go in `inbox/` and are merged here.

## 2026-08-14/3 — ⚠ Hover-reveal controls do not work on a repainting overlay
*2026-08-14 · DECISIONS-2026-08-14.md · Hover-reveal controls fail on repainting overlays*

Worth its own entry because it is a general trap, not a CH-chain detail.

The ✕ was first built as a hover-reveal (`opacity:0`, `.row:hover .rmv{opacity:1}`)
to keep a resting chain looking untouched. **Measured in headless Chromium
against `chchain.html`:**

| row state | `.row:hover .rmv` opacity |
|---|---|
| idle | reaches 1 in ~100ms |
| **casting** | **stays 0 indefinitely** |

The rows' innerHTML is rebuilt on every paint while a cast bar moves, and a
freshly-created element under a **stationary** cursor never picks up `:hover`.
So the control would have been invisible precisely on the slot someone is trying
to fix, mid-fight — a new instance of the "the button does nothing" class of bug
that CLAUDE.md already lists for this overlay.

**Rule: on any overlay section that repaints, a control is always drawn and
merely dimmed.** The ✕ sits at opacity 0.30, brightening on hover, inside an
18px right gutter reserved by the row's padding so it can never cover the
countdown.

## 2026-08-19/3 — Overlay size — the shape that survived three rounds (the guild lead, live)
*2026-08-19 · DECISIONS-2026-08-19.md · Overlay size sliders and window resizing shape*

1. **Where sliders live:** dashboard Overlays tab ("Size — all overlays") +
   one per overlay in its setup bar (override, ↺ follows global) + Settings.
   Settings-only was rejected on sight.
2. **A scale change resizes the WINDOW with the zoom** (center-anchored,
   work-area clamped) — zoom inside fixed bounds broke card edges/centering.
3. **Sliders apply on release and the overlay GLIDES (~180ms).** "Smooth
   slider" checkbox = the glide itself, **default ON** (Guild lead: "being off to
   glide doesn't make sense"); off = snap. The earlier live-follow mode is
   gone — it's what made the checkbox read backwards.
4. **The dock does NOT follow the global scale by default** (Guild lead: "don't
   change the [dock] with the scale by default") — "Scale the dock too"
   checkbox opts in. The dock's fit loop also needed the CSS→painted unit
   conversion (the 130% grow/shrink churn).
5. **Setup chrome counter-zooms** (Guild lead: "the actual slider sizing shouldn't
   change on the overlays — it should be the width of the window"): main
   pushes the live zoom (`wp-zoom` → `--wp-zoom`), preload CSS cancels it on
   the setup bar + drag controls, so setup UI keeps one painted size spanning
   the window at every scale.

## 2026-08-19/4 — "Wireframe overlays" is the UNLOCKED state, not a build difference
*2026-08-19 · DECISIONS-2026-08-19.md · Wireframe overlays mean unlocked state*

The guild lead's machine showed every overlay as a colored outline + ✥🔒 buttons while
a member's looked normal: `cfg.overlaysLocked=false` PERSISTS, and unlocked
**force-shows every overlay** for placement (`_overlayForcedOn`). That also
explains "it says hideall is on but its not" — hide-all's flags were off, but
unlock overrode them visible. Two responses: the dashboard now has the
Lock/Unlock + Show-overlays buttons to land the state in one click, and
`_healMootHideAll` clears a hide-all whose snapshot has nothing left to
restore (flags re-enabled one-by-one bypassed `toggleHideAllOverlays` and left
the persisted `hideAllActive` lying to the tray + dashboard banner).

## 2026-08-19/5 — Melody AE badge counts one pulse; damage rides the chip (a member via the guild lead)
*2026-08-19 · DECISIONS-2026-08-19.md · Melody area badge counts one pulse*

⚔123/12 was pulses merging: burst boundaries used wall-clock arrival and the
EQ client flushes the log in multi-second batches under swarm-kite load.
Bursts now clock off the LINE's own timestamp (`SONG_AOE_PULSE_GAP_MS`,
`test/song-aoe-pulse.test.js`). The asked-for display shipped with it:
per-hit damage + Σ running kite total per song (resets after 30s quiet), tray
toggle "Show AE song damage", **default ON** (agent 3.5.88).

## 2026-09-01/2 — Extended Target: an id beats the HP guess, but does not clear the warning
*2026-09-01 · DECISIONS-2026-09-01.md · Extended Target prefers ids over HP guesses*

**The call:** at ≥2 distinct `(zone_name, target_id)` pairs for one mob name,
the ids REPLACE HP clustering for that name. Below that, nothing changes.

- The key is `(zone_name, target_id)`, **never the id alone** — an id is a slot
  in the ZONE's entity table (measured 2026-08-31: you get a new one entering a
  zone, and the corpse keeps the old one). An observation with no zone is
  treated as having no id.
- `ambiguous` deliberately **stays true** on a proven split, because it also
  gates the NAME-keyed restore cache that two instances of one name would
  clobber. The row carries a separate `id_proven` flag for the overlay.
- Same-name debuff POOLING is left in place for proven rows. Un-pooling is the
  next step but needs real multi-reporter id data to validate, and wrong per-mob
  debuffs are worse than pooled ones.

## 2026-09-10/15 — Night timeline, Central HUD, reuse timers — asked and designed (guild lead, 2026-09-13)
*2026-09-10 · DECISIONS-2026-09-10.md · Night timeline, central HUD, reuse timers designed*

The guild lead, mid-raid: *"we need to plan out a visualization of the mobs and trash in
the night, full timeline view"*; a *"central hud that would outline your
character with hits and misses, current target's name and health, your own
health and mana totals"*; and *"a configurable 'How Many ____ Casts left' or
timers for critical class components"* — *"mend, kick, etc lay hands AA
cooldowns, discs"*. Design with options and costs in
`docs/DESIGN-night-timeline-and-central-hud.md`. Standing constraints carried
in: the timeline is web (variants on `b.wolfpack.quest`, the guild lead picks); the
overlays wait for the mini-mode picks. The Mend / Lay on Hands / Harm Touch
lines were read straight from the parser and the spell catalog (Guild lead: "these
could be read directly") — 72-minute recasts on all three touches, landing text
in `eqemu_spells`; only Divine Arbitration needs an authored reuse.

## 2026-09-10/4 — The Tank mini's damage-shield box is PER HIT (guild lead, 2026-09-11)
*2026-09-10 · DECISIONS-2026-09-10.md · Tank damage-shield box shows per-hit value*

*"The Damage shield component should be the sum of damage per hit, not the
total from all the times being hit."* The spiky box on the Tank mini shows
what ONE hit returns — the sum of the tank's active damage-shield buffs
(Shield of Blades 65 + Barrier of Combustion 20 → `85/hit`) — pops on each
hit, and changes only when a DS lands or fades. Today's full overlay keeps
its running-total line; the two are now computed from the same per-hit
figure. Landed on `beta` (ea2893c9) in the vote page's mocks and option
text; it is the spec for the Mimic build once a Tank option is picked.

## 2026-09-10/7 — Quiet mode is now a mute; hiding overlays is its own switch (guild lead, 2026-09-11)
*2026-09-10 · DECISIONS-2026-09-10.md · Quiet mode only mutes; hiding is separate*

*"Quiet mode should separate between muted and not seeing overlays at all.
Two options, and the current mode should just mute."* Landed on `beta`
(0cd30781, agent 3.6.39, builds 2.6.8-beta.2):
- `cfg.quietMode` keeps its key and now means MUTE — no voice callouts, no
  sounds, overlays unchanged. Until today it hid every overlay and silenced
  nothing (callouts speak from the hidden trigger window), so the old label
  "hide HUD + TTS" was wrong both ways.
- `cfg.hideOverlays` (new, default off) is "Don't show any overlays" — the
  EQLogParser / other-parser case. It owns every visibility gate,
  `_overlayWanted`, the tray enables and the tooltip. Uploads and voice are
  unaffected.
- Mute reaches renderers as one boolean (`wp-mute`, broadcast on every
  save-config, read once at load) and is checked in the three places that
  make noise: triggers.html (speak + sound files), chchain.html, charm.html.
- No migration: someone who had Quiet mode on gets their overlays back and
  goes silent, which is what "the current mode should just mute" asks for.
- The vote page also lets people remove a pick (web 1.7.34).

## 2026-09-18/6 — Also today (the code is the record; one line each)
*2026-09-18 · DECISIONS-2026-09-18.md · Mini-mode framework and assorted beta changes*

- **Mini-mode framework** on `beta` (v2.6.9-beta.5): ▭/📌 menu rows for the
  nine voted overlays, `Ctrl+Shift+M`, one writer behind menu/hotkey/dashboard.
  The nine renditions are not built; the vote result is in the table below.
- **Settings Save floats bottom-right, only when dirty** (beta.6).
- **A callout about your own character says "You" from every direction**
  (agent 3.6.44, beta.7) — relayed fires carried the originator's captured
  name. Applied to overlay text + speech only; deliberately not to the dedup
  key or the Discord/voice message.
- **v2.6.9-beta.4 shipped with no installer** — the `.exe` upload errored after
  the release was already published; re-running resolved the *next* tag
  (beta.5) and reported success while beta.4 stayed broken. Fix designed
  (publish as draft → verify the asset → flip live), stashed, not landed.

## §3 — Target Info — mana bar + Factions tab, measured 2026-09-22
*2026-09-21 · DECISIONS-2026-09-21.md · Target Info mana bar and Factions tab*

Asked for by the guild lead; feasibility pass in
`docs/DESIGN-target-info-mana-and-factions.md`. The findings that matter:

- **The log never names an NPC's spell** — only `X begins to cast a spell.` The
  way in is the LANDING message, which the guild lead spotted live: *"This
  should display the spell he cast that covers his hand with a dull aura"* →
  `eqemu_spells.cast_on_other` → **Grim Aura, 25 mana**.
- **Text matching alone is unsafe**: 153 landing strings are ambiguous and the
  worst maps to 27 spells. On The Spire Lord's own list `"staggers."` is seven
  lifetaps from 9 to 225 mana.
- **Narrowing by `npc_spells_id` + the NPC's level fixes it: 7,621 of 7,806
  (NPC, landing) pairs — 97.6% — resolve to exactly one spell**, worst residual
  4. For The Spire Lord at 49 the collision vanishes entirely.
  `eqemu_npc_spells_entries.manacost` is a per-entry override and is the cost to
  use, not `eqemu_spells.mana`.
- ⚠ **Two unknowns gate the bar itself, and a cloud session cannot close
  either**: whether Quarm NPCs actually spend mana, and at what rate it returns
  — **our `eqemu_npc_types` mirror has no `mana_regen` column**, so "resting
  regen" has no authoritative number behind it.
- **Other players' mana is not on the Zeal raid pipe.** Our own code proves it:
  the CH-chain roster is `mana: null` per slot and the healer roster parses
  percentages out of raid chat. Player bars work only for raiders uploading live
  state.
- ⚠ **The Factions tab is mostly already built** — `_factionValueMap()` resolves
  mob → faction values, is 6h-cached, and was validated against a real client
  log. It already knows that names come from `eqemu_faction_list_full` because
  `eqemu_faction_list` is **empty** in our mirror.

**Recommendation: ship the Factions tab and a "last cast" line first** (the
second thing actually asked for), and hold the mana bar until a local session
answers the two unknowns — an invented number on a mid-raid overlay is the one
thing this platform's design rules forbid.

## §187 — Five picks: A for all (the guild lead, 2026-10-07: "A for all of them")
*2026-09-21 · DECISIONS-2026-09-21.md · Five picks all option A*

- **Canvas group hotkeys (§180):** the defaults stand — a group key with the Canvas off turns it on and shows the
  group; a hide-all stays in force.
- **Another raider's charm pet (§183):** A, meter only. The claim credits the owner on everyone's live meter and
  local History; `_provenPets` does not upload it, so stored parses are unchanged.
- **Clicky picks (§185):** A, seven on two rows at the 70% floor.
- **Charm break with the alert's 🔊 unticked (§184):** A, the Charm overlay still says it once.
- **Canvas design rules (the A–G list in chat, 2026-10-07):** A, show-when rules — each piece can show only in
  combat, out of combat, with a target, with an NPC target, in a raid, or for chosen classes; it fails open (a
  missing signal keeps the piece visible) and everything shows while arranging. Being built on alpha. B–G (loudness
  budget, no layout shift, legibility preview, piece-to-piece guides, full undo, role starters) stay on the list.

## §300 — Mimic Chat overlay: design B now, A next (agent 3.7.165, Mimic beta `3be5b8e4`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat overlay with filter chips, tabs next*

- **The ask and the pick (the guild lead, 2026-10-14):** *"i need a chat overlay so i can move it off the screen and be able to
  show/hide different components from it, or break it into tabs"*; picked "B then A" — one feed with show/hide chips now, tabs
  that tear out into their own windows next. C (Canvas pieces) was ruled out: the Canvas lives on one screen.
- **Privacy split:** the upload filter (`DEFAULT_DROP_PATTERNS` / `shouldKeep`) is untouched. A separate local tap beside the tell
  tap feeds a 500-line memory ring, served only on 127.0.0.1 (`/api/chat`, origin-checked). It is skipped for excluded characters
  and never written to disk or queued. The route serves an empty page on failure rather than a stale one, so a switch turned off
  never re-shows lines.
- **Defaults, pending the guild lead's call:** guild, raid, say, OOC, shout, auction and NPC speech show; tells follow Settings →
  Tells (Off by default; Local/Synced show them, neither uploads); officer, group and custom channels are off until switched on in
  the overlay, and are captured only while it asks.
- **Where it landed:** `apps/mimic/chat.html` + every overlay-parity site in `main.js`, the dashboard row, `test/chat-overlay.test.js`;
  `/privacy` and PRIVACY.md say the same.

## §303 — Chat overlay round 2: the Seer's tells, copy on the timestamp, channel breakouts (agent 3.7.168, Mimic beta `432b4999`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat overlay tells, copy, channel breakouts*

- **The asks (the guild lead, 2026-10-14, from a screenshot of EverQuest's Tells window):** *"tells from seer did not come through"*,
  *"Add a copy button if you clikc on the timestamp next to the message"*, *"Add breakout abilities for different tabs by right
  clicking the name of the chat type"*.
- **Seer:** her recital is written to the log as a bare sentence (no "tells you"). `classifyChatLine` reuses the flag matcher
  (`_POP_RECITAL_RX`) and files it as a Tells line from "Seer", under the Tells gate. Her "nothing new" answer is added to the chat
  block only (`_SEER_QUIET_RX`), never to the flag matcher, so it is not uploaded as a recital.
- **Copy:** the timestamp is a button; it copies `[hh:mm] Speaker: text` and flashes "copied".
- **Breakouts (design A, first half):** right-click a channel chip → its own window (`chat.html?groups=<id>`), remembered across
  restarts (`cfg.chatBreakouts`), own bounds. Breakouts exist exactly while Chat does; a breakout's ✕ puts the channel back.
- **Open:** a per-breakout font size; whether ✕ should close instead of put back; tabs inside one window (design A, second half).

## §305 — Chat overlay round 3: earlier characters, history from the logs, search, zone lines (agent 3.7.169, Mimic beta `f3840337`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat overlay history, search, zone lines*

- **The asks (the guild lead, 2026-10-14):** *"CHAT overlay should be able to bring in the chat from the previous characters you were on,
  and put a line in saying swapped character, and the timeframe between. If you log out and log back in, show the previous logs (and
  give a timeframe, past 24h, past 12h, past 6hr, 3, 2 1"*; *"and search to only show chats from that specific character"*; *"Lines
  like 'You have entered Plane of Knowledge' are worth showing too"*.
- **Calls:** a swap is a different log's line ≥30 s after the last (the /camp timer alone is 30 s, so dual-boxing doesn't draw a rule
  every line; below that a dim "heard on X" tag). History is OFF by default and reads only when asked, backwards from the end of each
  log; it never writes or uploads. Zones are an ungated group, on by default. Search matches the speaker or the character that heard it.
- **Privacy:** PRIVACY.md and `/privacy` say the overlay can read the last 1–24 h from the game's own logs, on the PC only.
- **Open:** history is not time-merged with live lines newer than the ring's start (it sits above); the history window is remembered
  per window in localStorage, not in Mimic's config.

## §311 — Chat overlay: group chat and joined channels on by default (Mimic beta `a069a5ee`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat overlay shows group and channels by default*

- **The ask (the guild lead, 2026-10-14):** *"not seeing group chat or channels in the chat window either"*. The classifier read them; the
  overlay's ⚙ switches for them defaulted off.
- **Call:** group and joined channels default on (`p.group !== false`, `p.custom !== false`); officer stays opt-in. A switch turned off
  stays off. Still memory-only on the player's PC; `PRIVACY.md` and `/privacy` updated to match.

## §314 — Target Info: the mob's observed hit types (agent 3.7.172, beta `4ec04404`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Target Info shows mob's observed hit types*

- **The ask (the guild lead, 2026-10-14):** *"when we observe what types of hits a mob is doing, put that onto the target info
  (slashing/ piercing/etc)"*.
- **Calls:** keyed by mob NAME (`_mobCaseKey`), not spawn id — the melee line has no id and a mob swings while you target another;
  misses / dodges / parries count (the verb is the attempt), max hit from damage only; our pets and declared guild pets excluded; a
  one-word attacker counts only when it is not a known player or pet. Verb map reuses the Pet tracker's `_verbToSkill` (+ stab, backstab,
  strike, rend). Local only, nothing uploaded.
- **Open:** chip placement (slate chip vs the stats grid); an alpha Canvas piece; pooling across the guild would need a new upload.

## §315 — Chat overlay round 4: tags, per-channel switches, show-only, Melee, per-window text (agent 3.7.173 · Mimic beta `efd30696`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat overlay tags, per-channel switches, melee*

- **The asks (the guild lead, 2026-10-14):** *"put the [P] [RS] [GU] [1] [2] [3] [4] etc in front of the lines"*, *"Allow for turning off
  specific channels and keep people's settings"*, *"need rightclick on chat to 'show only this' as an option to toggle on and off"*,
  *"have a spot for combined melee"*, *"extra windows need their text to be configurable"*.
- **Calls:** joined-channel switches keyed by lower-case NAME (slot numbers move), shared by every character; show-only is a view toggle
  that never writes the switches; Melee is opt-in with its own ring and reuses the agent's melee parser; "extra windows" read as the
  breakouts + Melee window + main, each with its own font size / spacing / timestamps / tags. All local, memory only.
- **Open:** per-character channel switches?; a real `/abc` log to confirm.

## §316 — Overlay flicker on app switch (Mimic beta `65eceea9`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Fix overlay flicker on app switch*

- **The report (the guild lead, 2026-10-14):** *"lately i've been seeing a flicker for the overlays when i switch between applications"*.
- **Cause (a9919715, 2026-10-13, overlays drop behind other apps):** a NULL foreground sample while switching read as focused, raising
  every overlay over the incoming app for the 600 ms debounce; and clicking back into EverQuest covered the dropped overlays until the
  next 400 ms sample. **Fix:** ignore NULL samples; poll every 120 ms (two user32 calls; parent-alive check still ~4 s).
- **Open:** Windows retest; quick A/B is "Other apps can draw over overlays when EverQuest isn't focused" off.

## §317 — The timer ✕ dismisses on the press, for every row kind (agent 3.7.174 · Mimic beta `4ae64a3b`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Timer close button dismisses on press*

- **The report (the guild lead, 2026-10-14, a screenshot):** *"These timers aren't able to be clicked off"* — the second time (§171's
  `data-wp-interact` round did not fix it). The rows: the server tick, two spell recasts, two zone-timer countdowns.
- **What changed:** the ✕ no longer owns a click listener. One `mousedown` listener on the stable `#timers` parent reads the row's
  `data-timer-id`, so a repaint between press and release cannot lose it, and a row sliding up under the cursor cannot take the click.
  The window stays armed until the button comes up. The cancel POST retries twice. The ✕ has a 5 px invisible ring.
- **Server tick:** ✕ hides it for as long as the overlay stays open (tooltip says so); nothing is sent to the agent, and the agent's
  clear-all leaves it alone.
- **Zone timers:** a countdown the raider ✕'d stays dismissed when the bot hands that window out again on re-entry (2-minute
  tolerance; a new emote arms normally). Before this the "stampede window" came straight back.
- **Not proven on Windows:** whether the Canvas iframe ever armed its window; main.js now logs `[hover] first arm from <page>` once per
  page. Test: `test/timer-dismiss.test.js`.

## §320 — Chat overlay round 5: Spells, Skills, Melee filters and colours (agent 3.7.175 · Mimic beta `0d4d33bd`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat overlay spell, skill, melee filters*

- **The asks (the guild lead, 2026-10-14):** *"chat can also have separable spell and skill information"*; *"For Melee in the chat, it
  would be helpful to filter out other's information the same way we do with in game filters (do i want to see others combat or just
  mine). The color schema could be updated as well."*
- **Calls:** `[SP]` and `[SK]` are opt-in groups built like Melee (own ring, breakable, per-window text). Melee lines are mine / on me /
  others (EQ's own split; a hit ON your pet is "others"), with a Misses switch; all on by default so nothing changes until switched.
  Colours: mine near-white, on me red, others grey, misses dimmer; spells purple, skills amber — CSS variables, colourblind themes apply.
- **Open:** skill-result line shapes beyond forage/traps are from memory (fishing, sense heading, hide/sneak, bind wound, tradeskill);
  check a real log before widening. Landings on others cover only what the agent already indexes.

## §321 — Grow-upward overlays get a top-corner resize grip clear of the ✕ (Mimic beta `ac73bace`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Top-corner resize grip for grow-upward overlays*

- **The ask (the guild lead, 2026-10-14):** *"when grow upwards is on, we should be able to drag the top right corner of overlays while not
  hitting the X button."*
- **Call:** a 12 px grip in the top-right corner, and the ✕ steps 8 px left while grow-up is on (shrinking the grip into the 6 px margin
  left a sliver too small to hit). Dragging keeps the bottom-left fixed. One shared preload grip, so every ✥ overlay gets it.
- **Open:** Windows check; a header right under the ✕ may lose up to 2 px of gutter.

## §324 — Chat overlay: Spells and Skills get mine / on me / others filters (agent 3.7.176 · Mimic beta `7488b291`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat spell and skill mine/others filters*

- **The ask (the guild lead, 2026-10-14, a screenshot of the ⚙):** *"same here with spells skills - Filters for spells for others
  should be there as well."*
- **Calls:** Spells show My spells / On me / Others' spells; Skills show My skills / Others' skills; all on by default; shades of each
  group's hue. Resists, fizzles and interrupts count as mine (no separate switch). Known edge: your self-buff landing on you reads
  "on me", because EQ's landing text does not say who cast it.

## §326 — Chat overlay: main channels up front, the rest under More (Mimic beta `e6c95d9e`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Chat main channels up front, rest under More*

- **The ask (the guild lead, 2026-10-14):** *"This is getting crowded. Make the main set Guild/Raid/Party/Say/Tells/ooc/shout, then
  the rest as an expandable section 'More' that opens up to show the rest"*.
- **Calls:** main chips Guild · Raid · Party · Say · Tells · OOC/Shout; everything else behind `More ▾`, which shows "More (N)" while
  closed so nothing is on unseen; the ⚙ gets a matching "More settings" fold. Open states remembered per window. Open: "Party" vs
  "Group (party)" wording.

## §328 — Overlays stop repainting from blank when you click back into EQ (Mimic beta `6bebcb79`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Overlays stop repainting when returning to EQ*

- **The report (the guild lead, 2026-10-14):** *"When i click onto a different window and then back into EQ the Overlays all refresh"*.
- **Finding:** nothing reloads (no reload, navigation or broadcast on the focus path; pages keep their state). Since §316's z-order change
  overlays can be covered by another app, and Chromium's occlusion tracker then treats them as hidden — stops painting, throttles
  timers — so uncovering repaints every overlay at once. **Fix:** `disable-features=CalculateNativeWinOcclusion`; covered overlays keep
  painting. Cost: negligible (the dashboard also no longer slows when covered). Unverified on Windows.
- **Open:** the guild lead's A/B (turn off "Other apps can draw over overlays…" — if the refresh stops, this is the cause).

## §329 — Overlay sets come to beta from alpha (Mimic beta `5206a591`, 2026-10-14)
*2026-09-21 · DECISIONS-2026-09-21.md · Per-character overlay sets move to beta*

- **The ask (the guild lead, 2026-10-14):** *"push up the multiple overlay layouts per character to this beta from alpha please"*; then
  *"canvas does exist on beta, but in a different format"*.
- **What moved:** alpha's `e9e4f3d6` (cherry-picked with `-x`): named overlay sets per character, `/pipe mimic load|save|next|prev|lock`,
  the tray's 🗂 Overlay sets (placed under Overlays in layout B) and Settings → Overlay sets (badge BETA). Plus `/pipe mimic edit|arrange`,
  which drives beta's own Canvas arrange mode. **Not moved:** `/pipe mimic group` — it needs alpha's saved Canvas groups.
- **Found on the way:** the automatic beta → alpha sync has failed since 05:33 UTC today (conflicts in `charm.html`, `main.js`,
  `settings.html`, the agent `package.json`, and now the overlay-sets files on both sides). A hand-resolved merge is under way; alpha keeps
  its superset overlay-sets code and takes the agent version from beta.

## §360 — Canvas Pieces round: backing is only a plate (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas backing is only a plate*

The guild lead: *"Backing changes spacing instead of just background."* Root cause: `.panel.part.back > .pbody` added
`border:1px` and `padding:3px 6px` over the base `1px 3px`, so Panel shrank the content box by 8 × 6 px (text and bars
moved) and ↕ Fit, which adds a flat 4px, clipped a Panel piece by 4px. Decision (the guild lead picked plate-only over
a padded plate): the plate is `background` + `box-shadow: inset 0 0 0 1px`, no border or padding, so Clear and Panel
are the same box and every existing Clear piece is unchanged. The whole-Canvas 🌫 Background switch is separate.
Landed: `canvas.html` CSS; `test/canvas-pieces-round.test.js` (A).

## §361 — Canvas: one choice for a whole group (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas look choice for whole group*

The guild lead: *"select the whole group and say slim bar or upright bar."* The selection bar already was the bulk
path (a click on a grouped piece selects its group) but had no look controls. Added Show as / Thickness / Backing
there and a "Whole group" row in the piece ⚙ GROUP section, both through `bulkSet`. A piece whose data cannot be drawn
that way keeps its look and is counted. Upright bar re-flows the set into a row, Bar / Slim bar into a column, only
when every piece changed shape. Fit is skipped (see the open check on the single-piece Upright bar).

## §362 — Canvas: copy, rename and update a saved group (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas copy, rename, update saved group*

The guild lead: make changes to a default grouping (Command Center) and *"save a new version of that one or make it
called something else."* Saving a set that already is a saved group now makes a NEW group beside it (original
untouched); 💾 Update replaces its pieces; ⧉ copies; ✎ renames in place (id kept, so hotkey and placed pieces stay).
Group names are unique case-folded because `/pipe mimic group <name>`, the tray and the dashboard take the first match.
Command Center is an overlay preset (the page itself), so it is changed by placing it "as pieces"; the Groups tab
now says so. Known: saving at 60 groups still drops the oldest (`slice(-60)`), copy refuses at 60.

## §363 — Canvas: previews with real data in the palette (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas palette previews with real data*

The guild lead: *"the pieces could have samples of the actual data from the client and displays to just drag off."*
Chose the cheap version: one preview per piece row, drawn by the same `WpParts.render` call a placed piece uses, from
the data now (else the part's sample, dimmed); hovering a mode chip previews that mode. Rejected for now: one preview
per mode (about 10× the DOM), previews of "Overlay parts" (each needs an isolated page), group thumbnails (own round).
Cost: build about a day, maintenance low (new modes appear by themselves), runtime ≤ ~25 renders per source answer and
the 250 ms countdown repaint on a countdown tab only, change low. Pets: the Zeal pipe gives a pet's name and HP only,
so no pet mana, endurance or speed pieces exist or can.

## §364 — Canvas: a line between a row and its piece (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas line linking row to placed piece*

The guild lead asked for a dashed, bright-green line from a Pieces row to its placed overlay, and back. The chooser is a
div in the same page as the pieces (not a separate window), so it is a real SVG line, not a cross-window impossibility.
A preset placed as pieces is now remembered as `'preset:<id>'` in `_layout.named` so its row can find it; nothing else
reads that value as a saved-group id.

## §365 — Canvas: clicking a placed group shows where it is (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas click on placed group shows location*

The guild lead: *"clicking on the charm group it says it's up, but I don't know that it's a different set, or maybe
it's buried."* A click on a preset, saved-group or overlay row that is already on the screen pulses it and says where
(and if it is hidden) instead of "already on the canvas" or, for a saved group, stacking another copy. A piece row
still places a copy. Dragging always places another.

## §366 — Canvas: deleting a saved group can take its pieces, with Undo (alpha, 2026-10-18)
*2026-09-21 · DECISIONS-2026-09-21.md · Canvas group delete can remove pieces, undo*

The guild lead called the leftover pieces *ghosts*. Cause: deleting a saved group dropped only its `_layout.named`
links; the pieces kept their shared group id. The delete's second click now asks "delete + remove N on screen" or
"delete, keep them"; one Undo restores the group at its place, its pieces, its links and its hotkey. Ghosts left by
past deletes cannot be told from a hand-locked set, so those are cleaned up by hand (⚙ → Select its group → Delete the
group).

## §11 — The Me overlay, Blind Mode, and the next five (2026-09-24)
*2026-09-24 · DECISIONS-2026-09-21.md · Me overlay, Blind Mode, next five*

**The asks.** *"we need another overlay for the player. essentially a 'me'
overlay. my target, my casting, my health, mana, XP detail. avg DPS per fight,
total per day/night during raids, then the things that are important to
classes with mana — clerics focus on how many CHs are left, enchanters, charms
or mezzes left, theft of thought or harvest timers, party health data"*; *"a
concept … to automatically show the overlays that make sense if the character
is blinded"*; then *"generate me those me overlays as versions a/b/c to deploy
live into beta … give me a picker in game. nillipuss has some good display
bits we could learn from."*

**What landed (beta, agent 3.7.2; catalog fields in bot 3.1.144–145).** One
overlay, `apps/mimic/me.html`, three layouts of the same `/api/me` data, picked
with the A/B/C switch in its title bar (remembered per machine):
- **A · Classic** — the Nillipuss player window: cur/max inside the bars, the %
  column on the right, XP/hr and AA/hr, spell bar with casts left, group, DPS.
  Build S · maintenance M (the most fields to keep true) · runtime: the largest
  DOM of the three, still a 500ms local poll · change M.
- **B · HUD** (replaced "Glance" the same night — the guild lead: *"one of those
  me overlays should be a HUD style that goes around the players center of
  their screen … as well as damage in/out shown clearly. resists and cast
  damage too with elements associated with it"*; agent 3.7.3, element = catalog
  resist type, bot 3.1.146). HP/endurance and mana/cast as arcs either side of
  the character, target + cast above, damage OUT | IN below with per-element
  chips and a hit feed, resists left, class numbers right. The window grows to
  a centred rectangle when B is picked. ⚠ Screen centre is sacred in the
  overlay rules, so the ring is HOLLOW (a test pins it) — that is the
  compromise with the ask, and the thing to judge in game. Build M ·
  maintenance M (geometry is JS, so it moves when content changes) · runtime:
  one SVG repainted per poll · change M. An incoming unnamed spell's element
  comes from the landing text just before it, only when unambiguous.
- **C · Role** — the class's numbers first, large (CH left, Mez/Charm left,
  ToT/Harvest countdowns), then vitals, group, DPS. Build S · maintenance M (a
  new class focus means agent + overlay) · runtime small · change M.
All three read one serializer, so graduating one is deleting two render
functions. The catalog now carries `mana`, `recast`, `mez` (SPA 31) and `blind`
(SPA 20); the agent measures XP/AA per hour itself and keeps tonight's damage
in memory (a restart starts the night over).

**Blind Mode.** It never auto-showed for a capitalised name (state stored
lowercase, looked up in display case) — fixed. It also knew one spell's text;
it now reads every SPA-20 spell's landing and fade from the catalog, skipping
any text a non-blind spell shares. Me joins the four overlays it forces open.
Not changed: the old hand list matches both the Pitted Iron Ring's "Flames of
mana…" line and its manaflare line, so a ring that prints both is announced
twice — as before.

**Mob mana drains (a member's request) — scoped, not built.** Drains exist in
the catalog as SPA 15 with a negative base: Theft of Thought, Mana Sieve, Mind
Wrack, the Torments, bard songs (Cassindra's, Denon's, Ervaj's) and eight proc
spells on ~20 items. What the agent can see: its OWN drains exactly (the cast
names the landing); others' TIMED drains through the bystander index (per-tick
drain must be synthesized — no log line per tick); others' INSTANT drains and
all procs only where the landing text is unique (most share "staggers."). Needs
a `drain` catalog field with formula decoding (formulas 1–99 are unmodelled;
ToT reads 40 + 360 = 400 at L60, its max — verify before trusting). Also found:
the mana ledger's reset/evict functions are never called in production.

**Verified against the Quarm server source (2026-09-24, EQMacEmu
`zone/spell_effects.cpp`, `SE_CurrentMana` + `CalcSpellEffectValue_formula`):**
- Formulas 1–99 are `base + level × formula` — ToT 40 + 60×6 = 400 at L60 is
  right, not a guess.
- ⚠ **Instant drains are CUT on NPCs above level 52** ("from client decompile"):
  ÷2 at levels 53–54, ÷3 and capped at **105** at 55+. Nearly every raid mob is
  55+, so a ToT takes at most 105 from a raid boss, not 400; Mind Wrack ~100.
  **Timed drains are not cut** — Torment of Argli's 35 × 20 ticks = 700 beats
  six ToTs on a raid mob. The design must apply this or the bar lies downward.
- Bards — NPC or player — are immune to mana effects, good or bad.
- A mana TAP on a class with no mana does nothing at all.
- A timed drain does nothing on landing; it works per tick.
- **Players take instant drains at FULL strength** (the NPC cut is `IsNPC()`),
  and no PvP-specific reduction exists in that code.

**PvP (the guild lead asked, 2026-09-24): the bar cannot work on a player.**
The bar needs a max, which for an NPC comes from the NPC catalog; a player is
not in it, and Zeal sends a target's HP only — never mana (groupmate mana is
not on the pipe either). What CAN work: a "you drained N from them this fight"
tally for your OWN drains (the cast names the spell; full strength on players),
shown as an upper bound because the server only takes what they have. /who
class says whether there is anything to take (no-mana classes and bards: none).

**Built the same day (agent 3.7.4 on beta, catalog `drain` in bot 3.1.147).**
The guild lead: *"go on the mob version, and yes to the PvP tally. add in class
and level from /who data for target overlay for players … capturing exact
level from even con or /who, or a range from con and anon."*
- Mob drains follow the rules above, including the high-level cut; timed ticks
  count to the nearest whole tick (the server's tick phase is unseen). The
  ledger now dies with its mob and evicts idle entries — the reset bug found in
  scoping is fixed.
- Target Info for a player: class and level from live /who → raid roster →
  /who history; when anonymous, a /consider gives the exact level on an even
  con and a RANGE otherwise, by the server's `Mob::GetLevelCon` table
  (mirrored exactly). Only three con phrases are typed in (red, yellow, white —
  documented by ZAM and the Project 1999 wiki); the blue/green phrases vary by
  level bracket and the references disagree, so the agent **learns** them from
  considers of targets whose level it already knows, and keeps what it learns
  in `logsync.con-phrases.json`. Until a phrase is learned, that consider gives
  no range rather than a guessed one.

**The next five** (from the roadmap review — 13 roadmap votes from 3 voters,
so votes break ties, they don't set order; 20 of 30 active players now send
spawn ids):
1. Extended Target places each debuff on its mob by spawn id — `buff_casts.target_id`
   is stored and unused there (S, bot, #194 vote).
2. Mez owner + timer chip on Extended Target — design already in
   `DESIGN-extended-target-v2.md` (M, bot + overlay).
3. Mimic's same-name mob tracking uses spawn ids — a death clears only that
   mob's debuffs (M, agent, #194 vote).
4. Charm-pet damage credited by `pet_id` — the bot still credits by name and
   time, the class of bug behind the open Blood-phantom report (M, bot).
5. One archive entry per fight, #191 (S, bot, 1 vote).
Housekeeping alongside: the roadmap vote queue is stale (it still lists the
Zeal spawn-id request, golden-log CI, `/guide`, `/raid/review` as open).

## §13 — The HUD, round two: three circle HUDs (2026-09-24)
*2026-09-24 · DECISIONS-2026-09-21.md · HUD round two: three circle HUDs*

**The asks** (the guild lead, after a night with layout B): *"The circle looks
nice, but managing it is rough right now resizing is rough. It's so spread out
on mode B The Circle should be the bounds for the resizing with some light info
on the inside of the circle"* · *"Monks, rogues, and warriors have no mana so
don't expose that for them"* · *"Melee cooldowns and discipline cooldowns need
to be in here"* · the target *"should have their target's health as well. If
it's slowed, does it enrage? If it enrages make it a red outline on that
section"* · *"Nillipuss is able to provide server tick counters and melee delay
timers"* · hits inside the circle, MH/OH *"would be a nice addition"* ·
*"Give me 3 versions of the circle hud to work on in beta release."*

**What landed (beta, agent 3.7.5).** B is gone (a saved B opens H1); the picker
reads A · H1 · H2 · H3 · C and sits in the window's bottom-right corner. Every
HUD is ONE square SVG (viewBox 400×400) filling the window: resize the window
and the ring resizes, nothing is placed in screen pixels, and picking a HUD
makes the window a centred square. Four costs each:
- **H1 · Rings** — everything is an arc: target on top (name written along the
  ring), HP left, mana/endurance right, resists written along the bottom, a
  cooldown ring across the bottom, swing and tick as short inner arcs; the
  centre stays clear (a test pins it). Build M · maintenance M (angular layout —
  a seventh cooldown needs room found) · runtime: one ~60-node SVG repainted
  10×/s · change M.
- **H2 · Dial** — an instrument cluster: a nameplate-style target panel, big
  numbers, cooldowns as a row of round buttons that wipe clockwise like the
  game's. Most text of the three. Build M · maintenance S · runtime same · change S.
- **H3 · Reticle** — a hairline sight: slim HP/mana arcs, the target as a
  straight bar across the top, a timer strip across the bottom that shows only
  what is cooling down (ready ones collapse to one green word). Least clutter.
  Build S · maintenance S · runtime lowest · change S.

**Where each number comes from — and how sure it is:**
- **Server tick — exact.** Zeal gauge 24, which the pipe already sent and
  nothing read. Zeal's reverse option is detected from the gauge's own text.
- **Swing timer — learned, marked "~".** Zeal computes an attack-recovery gauge
  (34, `labels.cpp`) — that is what Nillipuss draws — but the pipe's
  `GaugeNames` map stops at 33, so it never reaches us. Until it does, the
  agent learns the delay from your own swing rounds (the log is read every
  500 ms and stamped to the second: ±0.5 s). The one-line Zeal PR is drafted in
  `docs/zeal-attack-timer-pipe-request.md`; the agent switches to 34 on sight.
- **Combat abilities — the server's rule, haste estimated.** Kick, Bash,
  Backstab and the monk specials share ONE timer (`special_attacks.cpp`):
  base × 100 / haste − 1 s, bases from `common/features.h` (kick/bash/FK/RK 8,
  backstab 10, TC 7, DP/ES 6). Haste is not on the pipe, so the timer starts at
  the unhasted ceiling and tightens to your quickest repeats, never below the
  100%-haste floor. Mend 289 s and Taunt 5 s from their server messages.
- **Disciplines — the server's rule.** The disc's own landing text starts it,
  with `CastDiscipline`'s reuse: base − 54 s per level above where it unlocks,
  clamped 3:54–72:00. The refusal line (*"You can use a new discipline in …"*)
  is exact and wins. ⚠ Kept OUT of the Command Center's refusal-only timer: if
  Quarm runs the server's disc timer groups, a disc from another group is
  usable while this counts down.
- **Enrage** — "can it" from the mob-info row (`Enrage` special); "is it now"
  from the server's own `has become ENRAGED.` / `is no longer enraged.` (10 s
  default, `EnragedDurationTimer`).
- **Target's target** — Zeal's own when a build sends it, else who the mob is
  meleeing in the log; their HP from you, your group's gauges, or the relay.
- **MH/OH** — only when your hands swing different verbs (the server swings the
  primary first). A monk's punch and punch cannot be told apart, so no hand is
  claimed — exactly the case the guild lead expected.

**Bug found on the way (fixed, same commit).** The Command Center's discipline
countdown has never worked in the live agent: `trackDisciplineTimerLine` added
milliseconds to the Date that `parseEqTimestamp` returns, which in JS is string
concatenation, so every read was NaN and `toISOString` threw. Its test passed
because its stand-in parser returned a number; the stand-in now returns a Date,
and fails 9 of 17 against the old code.

**Round two, same day (agent 3.7.6).** After playing all three: *"Bars are a
little too thick"* · *"I would need feign death and Mend on here as a monk /
warriors would use taunt and kick / paladins and shadowknights would have their
lay on hands and harmtouch"* · *"The way the text wraps on H1 for the name up
top is the format I want to see for the other pieces. Ticks, swing, HP and
Endurance."* · *"There needs to me more open space in the middle"* · *"I can
add in /pipeoutput for FD too"* · *"Lets also change the name to HUD"*.
- Arcs roughly halved in width. HP, mana/endurance, tick and swing are now
  written along the ring like the target's name; hits are written along the
  inside of the ring (H2, H3) or in the bottom band (H1). A test measures every
  straight line's full width and keeps it ≥ 95 units from the centre — the old
  side columns reached ~75.
- **Class cooldowns always shown**, as *unknown* (a dash, never green) until
  first used this session — we cannot tell "ready" from "used before Mimic
  started". Monk Kick · Mend · Feign Death; warrior Kick · Taunt; paladin Lay
  on Hands; shadow knight Harm Touch.
- **Feign Death** (`Handle_OP_FeignDeath`): the server prints only the
  FAILURE (*"You have fallen to the ground."*); a feign that works is silent.
  So `/pipe <word>` on a hotkey starts a timer at the press — `fd`, `mend`,
  `taunt`, `loh`, `ht`, or an ability verb — read from Zeal's custom messages
  at Mimic's receive time, each line once. **Length (corrected in agent 3.7.7):**
  the CLIENT's button timer, not the server's — the guild lead, Rapid Feign 3/3:
  *"my feign death is only 5 seconds because of my AAs"*; the AA text says it
  cuts reuse by 10/25/50%, so a 10 s base. The server's own 9 − 1 s (3 s at
  3/3) is shorter than the button and never the limit. The pipe carries no AA
  ranks and Rapid Feign unlocks at 59, so a monk of 59+ is taken as 3/3 (5 s),
  anyone else 10 s — marked `~`.
- **Lay on Hands / Harm Touch** are spells with a 72-minute recast, less 12
  minutes per rank of Fervent Blessing / Touch of the Wicked (`zone/spells.cpp`)
  — hence `~`. Started by the cast line, *"You harm touch …"*, or the landing
  text on YOUR target when you are the class that has it (a bystander sees the
  same landing text, so an off-target one is not credited).
- Renamed "HUD" in every label a raider sees; the internal key stays `me` so
  saved positions and settings carry over. ⚠ Sits next to the existing "DPS
  HUD" and "Tank HUD" overlays in the tray list.

**Round three, same day (agent 3.7.8): one HUD, built from parts.** The guild lead
after a night with all three: *"I think we need an overlay builder for this one
in mimic - people will want to customize it, and we can make subelements on
this"* · *"The wrap mode on H1 is the way i want things to be"* · *"H2's
separation of hits against me vs hits out"* · H3's hits *"should be smaller and
more - i sometimes hit 6 times in one round, that will fill everything up"* ·
*"Damage shield hits are also mixed in there - those should be separate, and
should have a button with current DS amount per hit in it"*.
- **H1/H2/H3 merged into one HUD** in H1's wrapped style (the pick, per the UI
  rule: graduate it and delete the rest — H2/H3 code and tests are gone). A
  saved H1/H2/H3/B opens the HUD. A and C stay until the guild lead says otherwise.
- **Parts**, each with a fixed place so switching one off leaves a gap instead
  of moving the others: target · who it is hitting · slow/enrage · health ·
  mana or endurance · DPS · class number · tick · swing · cast · cooldowns ·
  hits on you (left) · your hits (right) · damage shield · resists · rounds per
  lane (2–5).
- **Hits: one ROUND per line** — every hit sharing a log second — numbers only,
  newest line outermost; `main | off` when the two hands swing different verbs.
- **Damage shield: its own kind.** A named shield line, or *"<mob> was hit by
  non-melee for N"* when that mob meleed you within 1.5 s and N fits the shield
  you visibly wear (+30 slack) — the same test the fight parser applies, which
  runs too late for the HUD's hook. A weapon proc lands on YOUR swing, so it
  stays a spell. The button shows the worn shield's per-hit value, else the last
  one that landed (marked `DS~`).
- **Builder — what shipped and the alternative, four costs each:**
  - *Shipped:* a ⚙ checklist over the ring, saved per computer. Build S ·
    maintenance S (one list: `HUD_PARTS`, with a test that every part has a
    default and vice versa) · runtime nil · change S.
  - *Alternative:* a builder on the dashboard's Overlays tab with a live preview
    and drag-to-place slots. Build M–L (a preview renderer outside the overlay,
    slot geometry per part) · maintenance M (every new part needs a slot rule) ·
    runtime nil · change M. Worth it only if people want to MOVE parts, not just
    hide them; the checklist answers "what do you want displayed".

**Round four, same day (agent 3.7.9).** The guild lead: *"Tick and swing timer
should be their own bars underneath abilities"* · *"Everything feels very bold,
we need to be able to make it thinner."* · *"The configuration section needs to
pop up on the side and not over the overlay."* · *"I lost my discipline timer"* ·
*"The ENRAGES section should just make a red outline for the last 8% of the
healthbar"* · *"Each overlay should get its own hotkey config as well. so if i
want to pull one up i can do it without much effort"*. A seventh line, *"The
numerical text should be"*, was cut off; round five's *"Text should be
vertically aligned"* reads as its end, and was built as that.
- **Bottom of the ring:** cooldowns on an inner arc (r 150, up to five, each
  labelled beneath); under them, on the ring itself, the tick bar (left) and
  the swing bar (right; the cast takes it while casting), each labelled
  beneath. Resists move inside the cooldowns.
- **Line weight** is a builder part — thin (the new default), normal, bold (the
  round-three look). It scales every arc and the text's dark edge, and takes the
  numbers off bold. Thin reads as regular on Consolas, which has no 500 weight.
- **Builder opens beside the ring.** The window grows by 240 px toward whichever
  side of the screen has room; the ring keeps its exact size and place; closing
  puts the window back. The pre-open bounds stay on the computer until the panel
  closes, because the HUD window saves its size on every resize — quitting with
  the panel open would otherwise leave the ring off-centre at the next launch.
  One design, no variant: it is a placement fix inside an established design.
- **Enrage** is a red outline around the last 8% of the target's health bar only,
  the low end the bar empties toward, solid while ENRAGED. 8% is the Tank
  overlay's existing threshold (`threshold_pct: 8`). The "enrages" word is gone.
  "ENRAGED" stays while the mob is enraged: that is the moment melee acts on it.
- **The lost discipline timer had two causes.** Timers were memory-only, so a
  Mimic update (which restarts the agent) wiped them. A ready discipline was
  also dropped 60 s after it came up. Now every disc class has a Discipline slot
  from the start (dim "—" until one is seen). Ready stays ready. Discs, the
  refusal line and skill cooldowns save to `logsync.hud-timers.json` next to the
  agent and are kept 12 h past ready.
- **Damage shield leak fixed:** the shield line can print BEFORE the mob's hit,
  so the mob's hit now re-reads the unnamed non-melee lines of the last 1.5 s on
  that mob. With no visible shield, non-melee stays a spell.
- **Per-overlay hotkeys: built (agent 3.7.11), in the Overlays table.** Mimic
  already had four global hotkeys (hide-all, backdrops, damage alert,
  minimize-all), a key-capture "Change…" row on the dashboard, and one toggle
  path per overlay (the `toggle-overlay` IPC). A per-overlay hotkey is that
  toggle bound to a key: `cfg.overlayHotkeys`, bound by `_registerOverlayHotkeys`,
  running `_toggleOverlay` — the same function as the row's ON/OFF button.
  No default keys: a global shortcut takes its key away from EverQuest, so
  nobody gets one they did not ask for. A key the OS refuses (another app,
  another overlay, malformed) is shown in red.
  - *Shipped — a Hotkey column on the Overlays table:* click, press the keys,
    saved; Backspace clears. Build S–M · maintenance S (a new overlay row
    gets the button for free, and a test fails if a row has no toggle case) ·
    runtime nil (OS-level shortcuts) · change S.
  - *Alternative — one "Overlay hotkeys" card* using the existing "Change…"
    rows. Build S · maintenance S · runtime nil · change S. All the keys in
    one place for spotting clashes, but away from the toggle each one drives.
  The key capture is now one function (`_wpCaptureAccel`) shared with the old
  rows. It reads letters and digits from the physical key, so Ctrl+Shift+1
  saves as `Shift+1`. The old rows used to save it as `Shift+!`, and that
  bug is fixed too.
  The tray does NOT show the keys yet: the parity rule runs tray → dashboard,
  and putting a key on each tray item means touching all seventeen of them.
  That is a cheap follow-up if wanted.

**Round five, same day (agent 3.7.10).** The guild lead: *"if a mob summons we
should get a marker next to the 97%"* · *"Text should be vertically aligned,
and each round of damage can come out as individual hits but get merged into a
single line item after the next round shows up. It should be animated and
smooth, not just jump. Have them slide and smoosh together into the new
number"*.
- **Hits are upright columns** (on you left, yours right, damage shield under
  yours). The newest round is one line per hit. When the next round lands, the
  last round's hits slide onto a single line with the round's total and fade
  into it. Older rounds are one line each.
- **Why a separate layer:** the ring is rebuilt as a string every repaint (10×
  a second), so nothing inside it can animate. The columns are kept `<text>`
  elements keyed per hit (`#hudlanes`), moved by CSS transitions — the one
  deliberate motion on the HUD, 0.3 s, off under the OS "reduce motion" setting.
  Motion is a cost on an overlay read mid-fight (the design skill's rule); this
  is spent because the guild lead asked for it, and it runs only when a round lands.
- **Summon mark at 97%:** an orange tick across the target bar plus a pointer
  outside the ring when the mob can summon. 97% is the server's default
  threshold (eqmac `Mob` summon code: `hp_ratio` falls back to 97). A mob's own
  override is in the special ability's parameter, which our catalog row does
  not carry.

**Same day, two more asks on the DPS meter (agent 3.7.11):**
- **History lists its fights on the right** (the guild lead: *"History should give
  us a list of the fights to choose from on the right side"*). The last six
  fights, newest first, with each one's duration and how long ago it ended;
  the one on screen is marked; "…" while the guild numbers settle. It replaced
  the ◀ 1/6 ▶ pager. The 7-column layout now keys off the scoreboard's own
  width (a container query) instead of the window's, so History uses the
  compact columns until the window is wide enough for both. The requested
  design is the one built; the alternative (grow the window by the list's
  width, like the HUD builder) costs more to keep right and was not built.
- **The L size is 420 px, not 400** (a member: *"the large 400px preset cuts off a
  bit on the dps window. and the xl is just a bit too wide"*). It applies to
  every overlay's right-click L size.

**Answered, not built — keeping the mouse cursor on screen with the UI hidden
(the guild lead: "is there a way to keep EQ from hiding the mouse when using
hide UI mode?").** No setting does it, in the client or in Zeal. The cursor is
a UI-skin sprite (`A_DefaultCursor`) drawn by the game's own window manager,
and F10 (UI state 3 at `0x0063B918`) stops that drawing. Sources:
`EQMacEmu/eqgame_dll_takp` `eqmac_functions.h`/`eqmac.h`;
`CoastalRedwood/Zeal` `game_functions.cpp` `is_gui_visible()`,
`camera_mods.cpp`. The new eqw.dll also blanks the Windows cursor over the
game window (`CoastalRedwood/eqw_takp` `eq_game.cpp`, `WM_SETCURSOR` →
`SetCursor(NULL)`). So another program cannot bring the real cursor back,
only draw one of its own. Practical options:
1. Close the windows you don't want instead of pressing F10 (the game keeps
   drawing its cursor).
2. Use a stand-in cursor such as PowerToys' Mouse Pointer Crosshairs with
   "hide when the pointer is hidden" turned off. It lines up with the game
   cursor on the new eqw. Not tested in game.
3. Ask upstream: either eqw_takp skips `SetCursor(NULL)` while the UI is
   hidden, or Zeal draws the cursor when the UI is hidden.
4. A Mimic-drawn cursor is possible but only worth building if Zeal adds the
   UI state to its pipe — without it Mimic cannot tell F10 is on.
Unverified: that the game's own cursor-draw call sits behind the same UI-state
check. That needs a disassembly from a local session.

## §15 — HUD round six, and a player's /consider is not a level (2026-09-24, agent 3.7.12)
*2026-09-24 · DECISIONS-2026-09-21.md · HUD round six; player con is not level*

The guild lead, with four screenshots: *"INcorrectly characterizing 'looks like
quite a gamble' as a yellow con. these folks are level 60"* · *"Please display
level or level range and class under the target's bar, above the target of
target"* · *"Corpses shouldn't ever say 'not slowed'"* · *"If a mob is
unslowable it should say that in its place., but also smaller text."* · *"The
combining of rounds of combat is happening strangely. I liked seeing the
separate hits, but it wasn't clear how that was operating."* · *"Huds should be
configurable per character as well."* · *"Have the damage shield hits roll into
a total instead of roll off."* · *"Have the damage done and taken per mob roll
off into a total as well, then drop out after each mob."* · *"When a mob flurries
or Rampages denote that with an F in a fist outline or an R in a fist outline
next to the boss's name."* · *"Lets try adding in small sliders next to each of
the hud's elements for font size on the config page."*

**A player's consider does not give a level — decided, from the evidence.** ⚠ *Superseded in part by §98
(2026-09-29): "looks like quite a gamble" to a player IS the even con, so it gives your own level. Every
other phrase still gives a player nothing.*
- **What the server does:** it sends only a colour. `Handle_OP_Consider` →
  `GetLevelCon`, the same table Zeal copies from the client, and by that table
  60-vs-60 is white.
- **What the client printed:** level-60 players read *"looks like quite a
  gamble"* to a level 60, which is yellow (ZAM agrees with our phrase map). It
  also printed *"regards you indifferently"* where the server sends players
  faction 1.
- **So** the client handles a player's consider its own way. The exact rule is
  unknown, and could only be pinned in game.
- **Two changes:**
  - Target Info takes a player's level from `/who` only, live or the last one
    history saw. It shows no con chip for players.
  - The phrase learner only learns from NPCs, whose catalog level is fixed. A
    player could otherwise have taught a phrase the wrong colour.
- NPC considers are unchanged.
- If the character that did those considers was actually level 58–59, yellow was
  correct. The change is still right: the phrase gave a 61–62 range for someone
  `/who` had seen at 60, and `/who` is the better source.

**HUD, round six:**
- **Under the target's bar:** its level (or range) and class, above who it is
  hitting. An NPC's come from the catalog, a player's from `/who` (marked "last
  seen" when that is all there is).
- **Corpse:** a corpse shows only its name and 0%. No slow line, enrage outline,
  summon mark or badges.
- **Unslowable:** says "unslowable" where the slow state goes, one size smaller.
- **F / R badges in a fist outline, left of the name:** the mob can flurry or
  rampage. The ability comes from the catalog's special abilities (Rampage or
  Area Rampage count as R). A badge turns solid red for 6 s after the log
  shows it happen. The server strings are NPC_FLURRY *"%1 executes a FLURRY of
  attacks on %2!"*, NPC_RAMPAGE (Quarm adds *"against <target>"*) and
  AE_RAMPAGE *"%1 goes on a WILD RAMPAGE!"*.
- **Hit columns are ledgers now**, replacing round five's merge-the-last-round
  rule that read as strange:
  - On top, each mob's running total, "Σ 3,340". The mob is named when two are
    in the column.
  - Under it, the last few rounds as separate hits: oldest first, newest at
    the bottom, a small gap between rounds.
  - Rounds that fall out of the window slide up into their mob's total.
  - When the mob dies, all its hits roll in, the total dims, and after 8 s it
    drops out.
  - The damage shield column works the same way.
  - The totals come from the agent (`combat.tallies`, per mob and per life,
    split at the slain / died lines). They are not summed from the hits on
    screen, so they cover the whole fight.
- **Per character:** the builder's settings save per character. A character with
  none of its own starts from the last settings saved by any character.
- **Size sliders:** a small slider beside each part with text, 0.7×–1.6×,
  scaling only that part.

Design notes: one build, no variants. It is the established HUD, refined to
explicit instructions. The ledger is the one real design change. Its
alternative is to keep round five's per-round totals but label them (a "Σ" and
a hit count per merged line). Costs: build S · maintenance S · runtime nil ·
change S. It was not built, because per-mob totals are what was asked for.

## §16 — HUD round seven, Feign Death failures, clicky cast times, NPC Harm Touch (2026-09-24, agent 3.7.13)
*2026-09-24 · DECISIONS-2026-09-21.md · HUD round seven, FD failures, clicky cast times*

The guild lead: *"on Large size for abilities we should just show the name of the
ability and a checkmark instead of ready"* · *"IN and Out should be
side-swapped. Damage in should be next to health and out should be on the
right"* · *"Target name should curve with the HP bar"* · *"Move target of
target's healthbar and name to the top of the circle above the current"* ·
*"It's hard to tell when the different rounds are there. The concurrent hits in
a round should show up sidebyside before merging into a single line. Then
after the fight a ghost of those shows up."* · *"Replace the fist you made with
this fist shape i've uploaded"* · *"Add Harmtouch tracking to Shadowknight mobs
in Target Info"* · *"Config for hud should be able to scroll easily, and have a
top level slider for all of the text as well as reset to defaults for each
line."* · *"I did not get an 'FD Failure' message when this happened - FD
cooldown in the Hud should show an X on it"* · *"Cast time is definitely wrong,
especially for clickies"*.

**Three were bugs, and the causes are worth keeping:**
- **Feign Death failure** prints in the THIRD person with your own name —
  *"<name> has fallen to the ground."* The agent only knew *"You have fallen to
  the ground."*, so a failure never registered. Now either form marks the FD
  timer failed. The HUD shows "FD ✗" in red until 5 s after the timer ends.
- **Cast time** came from the spell's catalog cast time. A clicky casts at the
  ITEM's time, and haste or a focus changes it too. It is now timed from
  Zeal's own cast gauge (how fast its percentage moves). The catalog time is
  only used, marked "~", for the first quarter-second of a cast.
- **Cooldown labels cut off at large sizes** ("ND rea" for "MEND ready"): a
  label longer than its arc is clipped. Now "ready" becomes "✓" when it would
  not fit, and every ring label is fitted to its arc (it shrinks, never clips).

**NPC Harm Touch on Target Info — how it is decided:**
- **The timer:** an NPC Shadow Knight casts Harm Touch off its knight-attack
  timer and waits **40 minutes** (`HarmTouchReuseTimeNPC = 2400`, eqmac
  `zone/special_attacks.cpp`; its own comment reads "NPCs have 40 minute
  timers according to logs"). The timer is not running at spawn, so a fresh
  knight has it.
- **The log line:** it lands as *"You writhe in the grip of agony."* (Harm
  Touch, Harm Touch NPC — spells 88, 929, 2821), or *"<name> writhes …"* on
  anyone else. The log never names the caster.
- **Pinned at once** when your target is a Shadow Knight mob on the victim:
  it hit YOU in the last 20 s, or the victim is its target's target.
- **Pinned later**, as the guild lead proposed ("if we tab target to a
  shadowknight that's attacking us, there's a good chance we can assign that HT
  to it"): the landing is held with the list of mobs that were hitting you,
  and pinned on the first Shadow Knight among them you target that has none
  on record.
- **Keyed by name + spawn id**, so same-named knights are told apart on Zeal
  1.4.6+.
- **What it cannot see:** a knight that used its Harm Touch on someone else
  before you targeted it still shows "HT ✓". The log gives no way to know.

**HUD layout:**
- **Damage in** now sits on the health label, **out** on the mana/endurance
  label.
- **The target's name** runs along the INSIDE of its bar and keeps to the bar's
  span: it gets smaller (to 70%), then is cut with "…". The health is never cut.
- **Who the target is hitting** sits on top of the circle: a thin bar just
  outside the target's, with its name along the outside of that.
- **Hits:** a round is ONE line of hits side by side. If it is too wide, it
  shrinks (to 75%) and then wraps, with its wrapped lines closer together
  than the 4.5-unit gap between rounds.
  - The columns now start at y 146 instead of 126, because the circle is
    narrowest at the top. The right-hand column had 39 units there; now its
    narrowest row has about 48.
  - Older rounds still slide up into the mob's total.
  - After a fight, a dead mob's total stays, dim, as the fight's ghost until a
    live mob takes the column. The agent now keeps a dead mob's total 90 s
    (was 8 s).
- **The fist** is now drawn from the image the guild lead supplied.
- **Builder:**
  - 300 px wide, so the rows stop wrapping.
  - The header — name, close, and a new **All text** slider that multiplies
    every part's own size — stays put while the list scrolls under it, with
    a visible scrollbar.
  - A **↺** on every line puts that line's on/off and size back to default.

One build, no variants: these are explicit refinements of the established HUD.

## §17 — HUD round eight: the swing timer fitted, columns along the ring, procs (2026-09-24, agent 3.7.14)
*2026-09-24 · DECISIONS-2026-09-21.md · HUD round eight: swing timer, ring columns*

The guild lead: *"swing timer is completely wrong."* · *"Summations of hits should
not overlap with the outside rings."* · *"Right justify outbound hits and left
justify inbound hits. These should travel up the outside arc, but still be
oriented correctly."* · *"In the last screenshot the 62 69 110 line should have
been combined into [one number] for that round of combat on the third line
up."* · *"Remember that several classes can have up to 6 melee hits at once, on
TOP of procs. Procs should be purple."* · *"L40-43 Necromancer should also be
curved to fit the top bar."* · *"Put the name of the mob on the top of their
healthbar."* · *"Put their resists below their name. and the slowed/not
slowed/unslowable next to that"* · *"Clicking on the config button brings [up]
the mimic main dashboard."* — and, mid-round, *"FD still shows ready instead of
a checkmark"*.

**The swing timer — why it was wrong, and what replaced it.**
- **The old reading** took each round's ARRIVAL time (when the agent read the
  line) as the swing. Arrivals come in 500 ms polls against 1-second log
  stamps, so the phase could be off by most of a second, and the period
  (median gap) wandered with it — about 240 ms off in simulation. On a hasted
  two-hander (~1.8 s) that is a large part of the bar.
- **The fit (`_meSwingFit`):** each round is pinned by two facts — it happened
  inside its log second, and before we read it but no more than
  `_ME_SWING_LAG` (1 s) before. At the right delay those windows, carried
  forward to the newest round, all overlap, and many rounds overlap in a far
  narrower slot than any one of them (a vernier). The delay is searched at
  5 ms steps within ±20% of the median gap; the middle of the delays that fit,
  and the middle of the slot they leave, are the answer. A skipped swing (out
  of range, stunned) counts as a double gap, not a new delay; if nothing fits,
  the oldest rounds are dropped until it does. `swing.spread_ms` says how wide
  the slot is.
- **Measured:** it predicts the next swing within 0.12 s over realistic
  simulated logs (four delay/phase cases); with lag spread over the whole
  second it degrades to ~0.26 s and says so in `spread_ms`. The one-line Zeal
  change (attack timer on the pipe) would still make it exact.

**Procs.** A spell hit of yours in the same moment as your own swing (within
1.5 s, printed either side of it) is a proc and is drawn purple. ⚠ **Your own
nuke usually prints anonymously too** (*"<mob> was hit by non-melee for N"*),
so a spell hit with no name claims the cast you began in the last 12 s — once
(the cast lands one hit; a proc after it is still a proc). A fizzle or an
interruption drops the cast. Up to six swings plus their procs sit on one line,
shrinking and then wrapping as before.

**Hit columns.**
- **Along the ring:** out is flush right and in is flush left. Each line's
  outer end sits on an arc just inside the ring (r 158), so the column's edge
  curves with the ring while every number stays upright. Nothing reaches
  inside r 100.
- **Rounds:** the mob's Σ total on top, then older rounds as ONE number each
  (the round's sum), and only the newest rounds hit by hit — two by default,
  set in the builder ("Newest rounds hit by hit", 1–3), under "Rounds listed"
  (3–8). When the next round lands, the oldest split round's hits slide
  together onto their sum; a sum past the rounds listed slides into the total.
  (The example line 62 + 69 + 110 reads **241**.)
- **Totals** are fitted to their row: smaller (to 70%), then without the mob's
  name — never past the ring.
- **Checked by rendering what is drawn**, not by the lane constants: six
  four-digit hits a round with off-hand tags, eight rounds all split, two
  long totals, at 1× and 1.6× text — every box inside r 169 and outside r 95.

**Target block, from the outside in:** who it is hitting (its own thin bar) ·
the name + health **on top of its bar**, fitted then cut with "…" · level and
class **curved** inside the bar · its resists with the slow state beside them,
curved under that ("unslowable" smaller). ENRAGED stays the one straight line.
⚠ The resists come from the bot's mob-info row, which carries them nested as
`resists: { mr, fr, cr, pr, dr }` — the first draft read them flat and would
never have shown them; a test now pins the shape.

**Ready is always ✓.** Round seven only swapped "ready" for ✓ when the word did
not fit its arc, so FD (short enough) kept "ready" beside KICK ✓ and DISC ✓.
Every ready cooldown is now "<name> ✓", at every size.

**The ⚙ opening the dashboard — not reproduced, question out.** The HUD's ⚙ is
wired only to the builder panel inside `me.html` (a local file, so preload's
injected dashboard gear never runs there), and no IPC from it opens the
dashboard. Leading guess: the click takes focus from EQ, the game drops
behind, and a dashboard window that was already open shows through. Asked
whether a NEW window opens or an existing one is revealed; the fix differs.

One build, no variants: explicit refinements of the established HUD.

## §18 — Colour-blind themes, hotkeys that say "in use", opacity split, mini mode found unbuilt (2026-09-24, agent 3.7.15)
*2026-09-24 · DECISIONS-2026-09-21.md · Colour-blind themes, hotkey conflicts, opacity split*

The guild lead, in one evening: *"Put the Move icon and X at the bottom underneath
the tick timer and the swing timer. We can remove version C, default the HUD
to version, rename A into Box."* · *"Endurance can be small"* · *"Remove the
background from the Box version. Give the numbers on health some drop
shadow."* · *"Add the colorblind color schemes to themes as well."* · *"When
setting hotkeys it should tell you when you're trying to use one that's
currently in use rather than doing nothing."* · *"I don't see any of the
Mini-mode overlays in here. Those need to go in"* · *"Currently mini mode
doesn't do anything on 2.7.1 beta 14"* · *"Currently opacity only works on
backgrounds, not on the actual content. The Opacity slider at the top of the
Setup this overlay doesn't work at all. The HUD mode shouldn't include the
background as a square, rather as a shadow behind the content."* · *"Make the
top section of the overlays dashboard into two columns and put the opacity
slider with the background button. Put the actual overlays in alphabetical
order, keeping the dock and TTS up top."*

**Mini mode did nothing because it was never built — found, not regressed.**
The 2026-09-17 framework commit (`4cb14cff`) says so itself: *"this lands the
framework they all hang off, and nothing else."* The toggle, the 📌, the
Ctrl+Shift+M hotkey and the `body.wp-mini` class all worked; no overlay had a
single `wp-mini` rule, so the only visible change was the corner buttons
fading. The vote result (`DECISIONS-2026-09-18.md`, open table) is what gets
built: tank A · target B · CH chain B · charm A · ext A · pet B · dps B ·
pop A · buff B. ⚠ The main.js comment claimed the dashboard had a mini
button; it did not (the preload bridge `setOverlayMini` had no caller). Both
are now there: a **Mini** column (▭ + 📌) on the Overlays table and a
**Minimize ALL** key row — the tray-parity rule. And `miniHotkey` was missing
from the save path's re-register list, so a changed key would have waited for
a restart.

**Colour-blind themes — fitted, not the textbook daltonize.** Each is one
colour matrix over every overlay (preload `_WP_CVD_MATRICES`, an SVG
`feColorMatrix` the body filter points at), the same one-filter-per-theme idea
as the existing five.
- **Scored against an independent simulation** (Machado, Oliveira & Fernandes
  2009, severity 1.0), not the model used to fit them, on the platform's own
  tokens and the pairs that sit side by side with different meanings:
  danger/healthy (red/green), warning/OK (orange/green), danger/warning, a
  proc/a plain hit (purple/white), mana/health (blue/green), and gold/green
  (orange/gold for tritan).
- **The textbook daltonize (Fidaner 2005) was measured and rejected:** it
  lifted deutan red/green from 12.7 to 49 ΔE but dropped gold/green to 5.7,
  and its tritan matrix put red and orange at 0.4 ΔE — identical.
- **An unconstrained fit was rejected too:** it separated everything by
  pushing red to near-black (#500000), invisible on a dark overlay.
- **What shipped:** every row sums to 1, so greys and text stay grey; every
  token stays at L\* ≥ 45 as that eye sees it; every key pair is ≥ 30 ΔE.
  Deutan: key pairs from 12.7–17.3 up to ≥ 33.7, drift 14 — red reads
  vermillion, green light green, orange amber (Okabe-Ito-like). Protan: from
  7.8 up to ≥ 53, drift 31. Tritan: from 8.5 up to ≥ 42, drift 22.
  `test/overlay-themes-cvd.test.js` holds all three to it.

**Hotkeys that say "in use" — why it looked like nothing happened.** A key
held as a GLOBAL shortcut never reaches the focused window; Windows hands it
to its owner. So pressing Ctrl+Shift+H in the capture fired hide-all and the
dashboard saw nothing at all. Now:
- while the dashboard captures, Mimic lets go of every key it holds
  (`hotkey-capture` IPC; `_setHotkeysSuspended`, resumes on its own after
  30 s) and returns them (`_mimicHotkeyUses`), so its own keys arrive and the
  clash is named — *"Ctrl+Shift+H is already the Show / hide ALL key"* — while
  the capture keeps listening;
- a key another PROGRAM holds still never arrives; its signature is the
  modifiers going down and up with no key between, and that is now said;
- after a save, a key the OS refused says so instead of "Saved", for the
  per-overlay keys and now the four all-overlay keys too (`hotkeysBlocked`).

**Opacity split in two (main `_opacityMaps`).** Mimic 1.2 had made the one
slider drive only the card background (`--bg-alpha`) so text stayed bright —
which is why an overlay with no card, the HUD ring above all, showed no change
at all ("doesn't work at all").
- `cfg.overlayOpacity[k]` — **Opacity**, the whole overlay, faded in the
  renderer (preload `--wp-content-alpha`) — never its setup bar, menu, corner
  buttons or banners, or at 15% the slider would vanish under the cursor. The
  setup-bar slider and "Opacity — all overlays" set it.
- `cfg.overlayBgAlpha[k]` — **Background**, the 1.2 meaning (100% = solid
  card). Its own slider, beside the backgrounds button.
- Every value saved before the split was a background value, so it moves
  across once (`opacitySplit`) and Opacity starts at 100%: nobody's overlays
  change on update.

**The Me overlay:** C is gone; A is **Box** (its stored key stays `a`, so a
pick survives the rename); the **HUD is the default**, and a first run opens
in the centred square the HUD button gives. HUD: ✥ under the tick bar and ✕
under the swing bar (206° and 154° at r 199); the name and picker moved to the
top corners they left, which the ring never reaches. The backgrounds toggle
draws a drop shadow round the arcs and text, strength from the Background
slider, instead of a square. Box: no card, a thin endurance bar, a dark halo
on the numbers inside the bars, and no mana row for warriors, rogues and
monks (the screenshot showed an empty 0% bar for a monk; the HUD already had
that rule).

**The Overlays page:** two columns — how overlays look (theme, opacity and
background with the backgrounds key, size) and the all-overlay keys with
placement (show/hide ALL + lock, setup, arrange, rescue; minimize ALL; the
damage alert; per-character layouts) — folding to one on a narrow window.
The table: the Dock and trigger alerts first, the rest alphabetical.

One build, no variants: explicit instructions plus fixes inside established
surfaces. The mini renditions follow as their own change.

## §19 — The nine mini renditions, and Mimic 2.7.1 to stable for raid night (2026-09-24, agent 3.7.16)
*2026-09-24 · DECISIONS-2026-09-21.md · Nine mini renditions built; stable for raid*

The guild lead: *"These are the mini modes to build to start from"* (the ballot:
tank A · target info B · CH chain B · charm A · extended target A · pet B ·
DPS/tank meter B · PoP raids A · buff queue B) · *"HUD doesn't make sense to
dock, remove that"* · *"after these mini modes are built and included, I want
to push all of this to main so we have them available for tonight"* · *"For
the Hud, the character name doesn't need to be at the top left. The
selection for Box/Hud should be in the middle horizontally, vertically below
the bottom tick/swing timers, directly next to the movement and X buttons"* ·
*"When this is over make sure to post to raid-chat in discord so that people
know to get the new version … Looking for feedback on skills that people want
to track."*

**The nine minis**, each behind `body.wp-mini` in its own overlay; full mode
is byte-identical to before (each was run through the same harness before and
after). What each shows, and the calls made where the data or the mock left
room:
- **Tank A** — one strip: the tank's bar, "tank ← mob", the damage-shield box
  showing the SUM of the tank's DS buffs per hit (grey "no DS" when none); a
  rampage row only while rampage has a target, with the DA countdown and CH!.
  The DA is labelled "DA" as voted even when full mode would say "INV".
- **Target Info B** — the mob's bar and name (Shadow Knight HT chip beside it),
  a draining amber SLOW row. ⚠ **No ROOT row:** nothing the overlay receives
  marks a debuff as a root. The fix is agent-side — flag root (SPA 99) on
  `target_buffs` as pacify is flagged — then one more row. Open item.
- **CH chain B** — timeline lanes (see the CH agent's notes in HOW-ITS-BUILT).
- **Charm A** — the pet's bar → its target, then a draining purple timer (red
  "recharm" on the overlay's own imminent flag — 12 s bard, 30 s others — so
  the bar turns red when the overlay speaks). ⚠ **No MR:** the charm data
  carries no resists. Open item.
- **Extended Target A** — one row per mob: bar, name → its target, S / M
  pills, and every OTHER debuff folded into a "·N" whose hover lists them
  (slow and mez are not double-counted in N — the guild lead to confirm).
- **Pet B** — the pet's bar → target, then a haste bar. ⚠ **No haste %:** the
  pet data carries the buff's name, not its haste value, so the short name
  stands in. A dim "⚡ no haste" line keeps the slot when none is up (reads as
  "rebuff", not "not tracked").
- **DPS B** — the player above me, me, the player below, from whichever tab
  was last picked (me first → me and the two below; last → the two above; no
  row → the top three). The title row stays, because it carries the /rs copy
  button the vote said to leave alone.
- **PoP A** — the shared checklist and the ↗ guide link only; a row click still
  checks it raid-wide.
- **Buff queue B** — buffs left, cures right, a chip per category with its
  character count; click one to list who needs it with their group; the open
  chip survives repaints.
Every mini hides its overlay's connection dot (it lives in the title bar) —
worth knowing when an overlay "freezes" in mini. Found in passing, not fixed:
the full Buff queue's category headers and the full Pet list's dismiss ✕ have
no hover handshake, so on a locked overlay those clicks likely fall through
to EverQuest.

**The HUD:** no longer dockable (out of main's `_DOCK_CATALOG`, no DOCK button;
a HUD that was docked gets its own window back in `loadConfig`, as undocking
would have). Its chrome is one row centred under the ring: ✥ [Box | HUD | ⚙] ✕,
below the tick and swing labels, and no character name (the Box keeps it).

**Graduated to stable the same evening, before the raid freeze.** Mimic
**2.7.1**, agent **3.7.16**, bot **3.1.148**, web **1.8.3** (the roadmap entry).
A file-level promotion as always: `apps/mimic/`, `packages/wolfpack-logsync/`
and their tests. ⚠ **Left on beta deliberately:** the item page's quests and
tradeskills layouts (`?v=b` / `?v=c`) — two variants not yet picked, and a
variant never goes to main unpicked. Beta re-parked at **2.7.2**.

**The raid-chat post** is a one-shot in the bot (`_announceMimic271Once`),
latched in `bot_kv` so it posts once ever, and gated on the stable v2.7.1
release carrying its installer — the bot deploys minutes after the push, the
installer builds after that, and a post that beat it would send the raid to
an update that did not exist yet. It checks every 5 minutes for up to 12 hours.
An unreadable latch (Supabase down) holds and retries rather than posting.

## §22 — DPS meter header: a bare 📋, and the controls in two stacked columns (2026-09-25, Mimic 2.7.2 beta)
*2026-09-25 · DECISIONS-2026-09-21.md · DPS meter header: copy icon, stacked controls*

The guild lead, mid-raid, from a screenshot of the DPS meter on Blood of
Ssraeshza (the name wrapped to three lines beside `📋 /rs`, `− 16 +` and a
one-row `DPS Tank History` strip): *"the /rs is too big, should just be a copy
icon. We should stack DPS and Tank on top of each other and make more
horizontal room."*

**Built as asked, plus one step, and why.** The copy button is a bare 📋 (✓
for two seconds after a copy) and DPS sits on top of Tank. Measured in a
headless render at the screenshot's 321px: that alone took the name from
three lines to two — the name needs ~147px and got 86. History, left beside
the DPS/Tank column, was the next-widest thing (~52px), so it moved under the
− N + counter: `[− N +] / [History]` then `[DPS] / [Tank]`, two columns, the
header two rows tall. With Consolas-width text (what Windows renders; the
cloud box has none, so widths were scaled) the name then fits on one line,
with ~4px to spare after trimming two margins; at 260px it wraps to two. The
header row is centred vertically, which also moves the name clear of the ✥
corner.

**The alternative, if History under the counter reads wrong:** History back
beside DPS/Tank (as literally asked). Cost: the name wraps to two lines at
~320px. Build and change cost are one markup move either way.

## §35 — HUD tracking arrows — eight round the ring, the tracked mob's direction lit (2026-09-26, agent 3.7.18 beta)
*2026-09-26 · DECISIONS-2026-09-21.md · HUD tracking arrows around the ring*

**Where it came from:** a member, in a Discord DM to the guild lead, with a mockup of
eight yellow arrows round the HUD: *"for tracking. Ahead, Head and to right/left,
behind left/right behind you? you think thats too much?"* The guild lead: *"YES omg
great idea"*, then to this session: *"let's get to work"*.

**The data is the client's own tracking lines**, from eqstr_us.txt. It was checked in
two independent copies of the file (a Trilogy-era `eqstr_en.txt` and an archived
`eqstr_us.txt`); the EQMac server source only defines the IDs, so the client prints
them itself:
- 12040 `You begin tracking %1.`
- 12676 `%1 is straight ahead.` · 12677 `%1 is ahead and to the %2.` · 12678 `%1 is
  to the %2.` · 12679 `%1 is behind and to the %2.` · 12680 `%1 is behind you.` —
  with %2 = 12674 `right` / 12675 `left`.
- 12681 `You have lost your tracking target.` · 12499 `You have lost or do not have a
  tracking target.`

**Not yet seen in a real log.** Quarm's client is expected to print these words, and
community posts quote the same shape ("Gorenaire is ahead and to the left"). If the
live wording differs, the parser table `_ME_TRACK_DIRS` is the one place to change.

**Decisions taken while building (the guild lead to overrule):**
- **Guard against /emote.** A player can emote "Bob is behind you." So a direction
  line counts only for the mob named by "You begin tracking", or when the character
  is a Ranger, Druid or Bard.
- **How long a direction lasts.** It is kept 5 minutes after its line, because the
  client speaks when the direction changes, so silence is not a lost track. It dims
  after 15 s on the HUD, and a zone change or either "lost" line clears it.
- **Where the arrows sit.** The diagonals are in the square's corners, as in the
  mockup. The four others sit INSIDE the ring (inner end at r 110), because the edge
  is taken at 12, 3, 6 and 9 o'clock:
  - the target's target on top;
  - the HP and mana labels at the sides;
  - the always-visible ✥ Box HUD ✕ row underneath.

  A Playwright render measured the result. The first try put all eight at the edge
  and collided at all four; inside, "behind" ends 4 units above your resists at the
  default size.
- **Builder options.** A new ⚙ section, Tracking: on/off, "Arrows drawn: all | lit",
  and a size slider. All eight is the default, matching the mockup.
- **No rotation between lines, yet.** Zeal sends our own heading, so the arrow could
  turn as you turn. But which way EQ's heading counts is not pinned down, and a wrong
  sign would swing the arrow the wrong way. Left out until it can be checked in game
  (turn left, watch the number).

**Checks:**
- 5 agent tests and 4 HUD render tests.
- Mutations of the class gate, the zone drop and the lit-only option were each
  caught.
- The full suite passed (4,045 tests); lint and check:dashboard are clean.
- Beta `fe43d0b8` (Mimic builds as 2.7.2-beta.N); roadmap entry with Web 1.8.9.

## §41 — /who overlay: the player you click goes on top, guild under the name; tags when you alone zone (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Who overlay: clicked player on top, guild shown*

**The guild lead**, raiding alongside Dungeons and Dragons and other guilds: *"add guild
under the player's name when we know it. When we click on them put them at the top of
the /who overlay"*. Then: *"If we can persist the tags per name per spawnid that would be
good if we zone out and zone back in and most people didn't"*.

**The /who overlay (agent 3.7.19, beta `f087f5c3`):**
- The player you target (click on in game, or in the raid window) gets a **Target
  card at the top**.
  - Their name, class and level show on the first line.
  - **Their guild shows on its own line underneath**, like a nameplate.
  - They are taken out of the lists below.
- **Sources, in order:** this session's /who, then /who history from the bot, then the
  raid roster's class. So an /anon raider or one you never /who'd still gets a card.
  - A history value is in italics.
  - The card appears even before any /who.
- **A pet never gets a card:** a card needs a /who row, history or a raid class.
- **The EverQuest raid window itself cannot show guilds.** It is the client's own
  window. The card is where the guild goes.
- **Considered and not built:** a guild line under every row of the list. It doubles
  each row's height, so half as many raiders fit. It is one CSS rule if wanted.

**Tags when you zone and others don't:** no change needed; it already works.
- **NPCs** have been restored by zone, spawn id and name since §28. A mob that
  stayed put keeps its id, so its tag comes back when you return.
- **Players** are restored by name since §40. That covers both the ones who stayed and
  the ones who zoned too.

## §42 — /who overlay: a Zek only mode (2026-09-26, agent 3.7.20 beta)
*2026-09-26 · DECISIONS-2026-09-21.md · Who overlay Zek-only mode*

**The guild lead:** *"Show me a Zek only mode on the Who tab"*, then *"who overlay"*.

**Built (beta `6df10cac`):**
- **The toggle:** a `ZEK` button in the overlay's title bar, lit in the ZEK flag's red
  when on.
  - **On:** Current and Recently gone show just the Zek players, and the header reads
    "Zek N of M". The Target card stays whoever it is. With none, it says "No Zek in
    your last /who".
  - It is remembered on that machine, and it has the hover handshake, like every
    clickable control on a locked overlay.
- **"Zek" is what the bot already means by it:** the guild named Zek, or an unguilded
  player the bot inferred belongs to it (who_directory's `ever_zek_guild` /
  `ever_inferred_zek`).
- **A fix that came with it:** every row now carries its Zek flag. Before, only an /anon
  row did, so a player showing `<Zek>` in /who was not flagged red.
- **Test:** `test/who-target-card.test.js`, five deliberate breaks, all caught. The
  screenshots of both states went to the guild lead.

## §44 — "Background: ON" is a near-opaque plate; Melody's bard strip gets readable (2026-09-26)
*2026-09-26 · DECISIONS-2026-09-21.md · Background option made opaque; Melody strip readable*

**The guild lead**, with a screenshot of Melody over bright grass: *"Really hard to see this
bandolier and the background doesn't work"*. "Bandolier" was read as Melody's bard buff
strip (Amplification, Resonance, Selo's, Niv's, Nature's Melody), the part of that
screenshot that was unreadable.

**Why the Background did nothing (every overlay, not just Melody):**
- The backdrop rule in `apps/mimic/preload.js` painted `rgb(8 10 14 / var(--bg-alpha,0.92))`.
  Every overlay defines `--bg-alpha`, so the 0.92 fallback never applied.
- Since the plate moved onto `#wrap` (July, so it hugs the content), it paints the card
  itself. Turning it on only swapped the card's tint at the same see-through level.
- Measured in Chromium with the card at 0.45: ON was 0.45 before, 0.92 after. OFF is 0.45
  both ways.

**The call:** Background ON means a plate you can read through grass: at least 0.92, and a
higher card alpha still wins. With the backdrop on, the Background slider can only make it
darker; with it off, the slider works as before.

**Melody:** a 1px dark text edge on the card (the other overlays already have one), the
strip's labels in the lighter song-chip purple, and the grey "off" chips a step lighter.

**Landed:** beta `08d4e892` (Mimic files only, so no agent bump; the beta build picks it
up). `test/overlay-opacity-and-mini-dashboard.test.js` checks the rule; putting the old
rule back fails it.

## §45 — Melody: the DIRGE NUKE board (2026-09-26, agent 3.7.22 beta)
*2026-09-26 · DECISIONS-2026-09-21.md · Melody Dirge Nuke control board*

**The guild lead:** *"the melody overlay needs a little switch and a red button that says DIRGE
NUKE on it when amplification and resonance/harmonize and Puretone is available … As soon as
Amplification flips on as the last item, the control board slides out quickly but animated and
shows the Puretone Key (that turns if you do it) and then the NUKE button that has a cooldown on
it for recast and HOW MANY Dirges you can do (mana divided by 800)"*. The pre-buffs named: both
Guardian Rhythms and Psalm of Mystic Shielding, 3 minutes left on Selo's, Niv's Harmony.

**Built** as asked, with an animated preview for the guild lead (a private page, not in the repo).
How it works: `HOW-ITS-BUILT.md`, "Melody: the DIRGE NUKE board".

**Calls made from the data, for the guild lead to confirm:**
- **Selo's: 2:00, not 3:00.** Selo's Accelerating Chorus is 25 ticks (2:30) at most: formula 4 in
  `eqemu_spells` 2605, and 25 is the highest of 73 live samples in `character_live_state`. A 3:00
  lamp could never light. 2:00 means it was sung in the last 30 seconds. One constant,
  `DIRGE_SELO_MIN_SECS` in `melody.html`.
- **"Niv's Harmony" is Niv's Harmonic** (spell 1763), the only Niv's song with "Harmon" in it.
  The bard strip's existing "Niv's Melody" row is a different song (Melody of Preservation →
  Breath of Harmony) and is left alone.
- **The NUKE "cooldown" is the 3-second sing.** Denon's Desperate Dirge (742) has
  `recast_time 0`, so there is no lockout after it. The ring fills while Zeal shows the Dirge
  being cast and starts over for each back-to-back cast.
- **Puretone "ready"** uses the agent's existing disc timer. That timer is an estimate of the
  shared discipline timer (4320 s at 60), except when the refusal line gives the exact time. A
  timer never seen counts as ready, since the board is a reminder, not a gate.
- **Exact spell names** for the pre-buffs. The strip's matcher falls back to the first word,
  which would take any "Psalm of …" for Psalm of Mystic Shielding.

**Found on the way, fixed in the same change:** `melody.html` read `curKind` in the label shown
between casts but never defined it. Every tick in that gap threw, so the song list froze and the
connection dot went red until the next cast. It is also on stable. One line defines it.

**Landed:** beta `611b145b`. `test/melody-dirge-board.test.js` covers both halves; seven
deliberate breaks, all caught.

**Round two, the same morning (beta `bb40c989`, now "DIRGE TACTICAL NUKE").** The guild lead:
*"Make it Harmonize instead of Resonance, and do that first, then Selo's, then your resists, Niv's
Harmonic is a Breath of Harmony Clicky … put each of the Dirges as its own button and have the
Keyturn under a little plastic cover … Underneath put in 'Dirge Team 6 Tactical Nuke'"*.
- **Steps**, numbered and in singing order: Harmonize, Selo's (2:00+), Guardian Rhythms, Psalm of
  Mystic Shielding, Niv's (Breath of Harmony), Amplification.
  - Resonance alone reads amber: the guild lead asked for Harmonize "instead of".
  - The Niv's step checks on either buff. In `eqemu_items` the Breath of Harmony item (5156)
    clicks Niv's Melody of Preservation (748), not Niv's Harmonic (1763).
- **Cover and key:** with all six checked, a plastic cover over the key flips up. Puretone turns
  the key, and the Dirge buttons pop in.
- **One button per Dirge:** `floor(max mana ÷ 800)` buttons (up to 12), numbered. The ones current
  mana holds are lit, and the one being sung is the top lit button, its ring filling.
- **Recast:** the guild lead believes Dirges have a small recast delay. Our spell catalog and PQDI
  both give spell 742 a 0.0 s recast and 0.0 s recovery, so the only wait shown is the 3 s sing.
  That stays open until someone measures one in game.
- **Also asked for:**
  - the current Dirge count by the switch;
  - a DISC key in the bottom right: up (ready), down with the time left, or lit while Puretone
    runs;
  - the "Dirge Team 6 · Tactical Nuke" labelmaker strip under the board;
  - preview steps you can click to jump to.
- The single big NUKE button and the lamp chips are gone.

**Public demo (web 1.8.18):** the guild lead: *"throw this up on wolfpack.quest and i'll use it. I
want to place it in Discord."* It is at **wolfpack.quest/mimic/dirge**, public (it reads nothing and
names no real player), with a large Discord card. Link previews can now carry a picture, per page,
through `pageMeta.ts`. The page is a snapshot of beta's board, built by
`scripts/build-dirge-demo.js`; rebuild it when the board changes.

## §56 — The duplicate kills deleted; the Zeal health overlay becomes the Tick overlay (2026-09-27, agent 3.7.31 beta)
*2026-09-27 · DECISIONS-2026-09-21.md · Duplicate PvP kills deleted; Tick overlay renamed*

**Duplicate kills — the call (the guild lead):** *"yes delete the 23 duplicate kills"* (§55).
- Checked first: each kill was stored exactly twice, and no `pvp_assists` row pointed at either copy.
  (The FK is `ON DELETE SET NULL`, so a pointing assist would otherwise have lost its link.)
- Kept: the row written when the kill happened, either the live `pvp_channel` row or the first
  catch-up.
- Deleted: the later catch-up copy.
  - The DELETE also required `source = 'log_backfill'`, so a live row could not be removed by mistake.
  - Ids: 393, 394, 402, 404, 405, 406, 414, 417, 419, 426, 436, 461, 462, 482, 483, 517, 518, 519,
    535, 547, 606, 612, 619.
- After: 0 duplicate pairs, 589 rows. §55's check stops new ones.

**Tick overlay — the call (the guild lead):** *"let's change the zeal health overlay into the tick
overlay request that [the co-leader] asked about. the zeal health info could still be accessible there.
could also display clock skew offset"*.

The co-leader's request, feedback 2026-09-27 00:32 UTC: *"The server tick function within the HUD thing
is awesome, but would be even better if it could be broken out or customized to put somewhere else, as a
standalone timer"*.

**What shipped:**
- `apps/mimic/zealhealth.html` is now the **Tick** overlay.
  - Key `zeal`, flag `showZeal`, the file name and the saved bounds are unchanged, so anyone who had
    Zeal health on finds Tick in the same spot.
  - The labels were renamed: tray "Tick timer (server + charm ticks, Zeal health)", overlay list,
    hotkey names, window title, dashboard Overlays row, and the no-Zeal notification.
- **One server-tick row per character streaming Zeal**, from the new `/api/state.serverTicks`
  (`_serverTicksNow`: gauge 24 via `_meTick`, sorted by name).
  - Per character rather than "the active one", because that flips with whichever Zeal stream
    reported last (the flip-flop flagged in §52). The countdown never jumps.
- **A charmed mob's own tick** while a charm is active, from `charmPets.mob_tick_at`. It shows "?"
  plus "learning" until a DoT tick or a break reveals it.
- It counts down locally ten times a second from absolute tick times.
- **Two layouts on beta** (the UI-options rule), switched with ◯/▭:
  - **Bars:** one shared grid, a number plus a draining bar. Server is blue, the mob is purple.
  - **Dials:** a ring per tick with whole seconds inside.

**Status line:** "📡 Zeal ok · ⏱ clock 2.4s slow". The clock is green under 1 s, orange under 5 s, red
past that; 5 s is also where the agent warns. Clicking it opens:
- the old Zeal type table, pid line and admin-mismatch hint, unchanged;
- the clock in words, against the Wolf Pack server (`clockOffsetMs`) and against internet time
  (`ntpOffsetMs`), with the `w32tm /resync` fix.

**The cost of the two layouts:**
- Bars are CSS widths (cheapest to change).
- Dials are one SVG `stroke-dashoffset` per tick (cheap too, but geometry to touch when resizing).
- Both are rebuilt only when which rows exist changes.

**Left for the pick:** whichever layout loses goes when a stable is cut.

**Where:**
- Agent: `_serverTicksNow` and the `serverTicks` field in `_serializeForDashboard`.
- Mimic: `zealhealth.html`, plus the `main.js` labels.
- The dashboard `WP_OVERLAY_ROWS` row.
- Tests:
  - `test/tick-overlay.test.js`: 10 tests, 11 of 11 mutants killed.
  - `test/tray-overlay-order.test.js` follows the label.
- Both layouts were rendered in Chromium with sample data. That caught the bar rows not lining up.

## §59f — The same member's other reports that day, investigated, none built yet (2026-09-27)
*2026-09-27 · DECISIONS-2026-09-21.md · Member's feedback investigated, nothing built yet*

The guild lead asked for every remaining item from that member's Sunday feedback to be looked into.
Five read-only investigations ran against beta at `f24af63f`, and the load-bearing lines were
re-checked by hand. **Nothing here is built.** Each fix is the smallest change that answers the
report, and all of them fit inside one agent + Mimic beta round.
| # | Report | Root cause | Smallest fix | Size |
|---|---|---|---|---|
| 1 | Two charm-break rows that switch on together; "charm break" spoken twice, even with its speech box unticked | **One** suggested trigger (`self_charm_broke`). Its personal-trigger copy is listed again under Personal triggers, on the same object, which is why ticking either box moves both. It is spoken twice because the same log line reaches the overlay twice: once as 3.7.34's instant break (§59c) and once as the trigger fire. `_pushCharmBreakInstant` marks the instant fire as already spoken only when the trigger's speech box is ON. `triggers.html` `fire()` speaks any fire with text whether or not that box is ticked, so unticking the box turns one call into two | `charm_spoken` on `sug.enabled` alone (index.js ~36087) + update `test/charm-break-instant.test.js`; label `suggested:` rows in the Personal list as the Suggested panel's copy | S |
| 2 | An imported bard charm trigger fires on Test, never live | An import whose pattern will not compile is stored **disabled** with `import_error` (index.js ~28641). The live matcher skips it (`enabled === false`, `!_regex`), but `_rehearseTrigger` checks neither and fires the actions anyway, so Test succeeds on a trigger that can never fire live | `_rehearseTrigger` refuses a disabled or uncompiled row, and the Test note names the import error | S |
| 3 | Bard charm-break speech lags a few seconds; the Recharm tick bar never appears on the bard | The log-line break path (instant speech + `_noteMobTick`) needs the charm to be known as ours. `_gaugeOwnerIsBard` reads the class only from /who or the raid roster. Unlike every other class lookup in the agent, it never reads Zeal's own class label (`_meLabel(zst, 3)`). So a solo bard who has not /who'd themselves can go untracked. The break then comes only from the gauge reconciler, after a **6 s** grace, and that path calls neither the instant speech nor `_noteMobTick`. The Recharm bar waits for a known mob tick, so it never shows | `_gaugeOwnerIsBard` reads `_meLabel` first; the gauge break branch also calls `_noteMobTick` | S–M, medium confidence (no live capture) |
| 4 | Separate my triggers from the pop-up that shows Tash | The Tash callout is a **guild** trigger. Every fire goes through one `fire()`, which shows the Earlier / Good / Too early vote strip for all of them (`triggers.html:696`). The fire already carries `scope`, but nothing uses it here | Show the vote strip on personal fires only, or add a per-trigger "no feedback" flag. **The member's intent needs confirming first** | S |
| 5 | Clicking a trigger in the manager does not show or edit it | Personal rows have no Edit and no click handler; `onAdd()` only appends. `prefill()` already fills every field, but only "Copy to personal" calls it | An Edit button calls `prefill(t)` and saves in place over the same id. Guild and suggested rows get a read-only detail view | S (personal) / M (with detail) |
| 6 | Does Mimic have EQLP's "Warn with time remaining"? | **Yes, except in the hand-made trigger form.** The warning columns exist, the EQLP import maps `WarningSeconds`/`WarningTextToSpeak`, and the overlay speaks the warning (`triggers.html` `paintTimers`). The dashboard's Add-personal-trigger form has no fields for it | Two inputs in `buildEditorHtml` + two lines in `onAdd()` | S |
| 7 | DPS copy leaves out the charmed pet; History copy shows the pet's damage but not whose pet it is | The on-screen meter folds pets into their owners with `_foldPetsIntoOwners` (`overlay.html:547`/`689`). Neither copy builder calls it. The current-fight copy drops pet rows outright, so the header total includes the pet while no line shows it. The History copy gets the owner's damage already folded in by the bot, with no "+pet" mark, and a leftover local pet row can be counted twice in the header | Build both copies from the folded rows and print "+pet" where the meter shows it | S |
| 8 | Per-character layouts do not seem to work at all | Saving and applying work. The trigger is the problem: the active character is **whichever Zeal stream reported last** (§52), so with an enchanter and a bard boxed, it flips several times a second and each flip re-applies the other character's layout | Debounce in Mimic `_onActiveCharacter`: a switch counts after the new name holds for ~5 s. The real fix, focus-based detection, stays the separate item from §52 | S |
Row 8 assumes the member runs both characters at once; one client at a time would not flip, so ask.

## §60 — DPS HUD: your row always, highlighted, a % bar under every name, and the HUD finally knows who you are (2026-09-27, Mimic 2.7.3 beta)
*2026-09-27 · DECISIONS-2026-09-21.md · DPS HUD own row, percent bars*

The guild lead, mid-raid on Thall Xundraux Diabo: *"your own row always, and always highlight it so
its easier to see. Have a thin row underneath each person with their percentage done."*

**The call and where it landed** (`apps/mimic/overlay.html`, beta `4d89add1` + `881f07c0`):
- **Your row always shows.** It was already appended under a dashed rule when you fell below the
  visible rows. It now also appears at zero, rank "—", when you did nothing this fight, on every
  tab and in mini. An empty board stays empty.
- **Highlighted as a band:** gold background and a gold left edge, not only a gold name.
- **A 2px bar under every row**, drawn against the TOP row rather than the raw share. A raw share
  of a 50-person raid tops out near 7% of the width, so every bar would be a stub. The % column
  still shows the real share. Gold for you, blue on DPS, red on Tank. Mini already had its own
  share-of-raid bar and keeps it.
- The rank column went from 1.1em to 24px: two-digit ranks spilled out of it into the new gold
  edge, and the em also differed between the 9px header and the 11px rows.

**Why none of this showed before (root cause).** The HUD looked for you under `s.character`,
`s.uploaderCharacter` and `s.self`, and `/api/state` sends none of them. That is the overlay
catalog's finding 1 (§57, `DESIGN-overlay-catalog.md` §3). So the gold name, the always-show-you row
and mini's centring on you had never run, and the screenshot had no highlighted row. The HUD
now reads `activeCharacter`, then the live fight's `uploader`, with the old three kept as fallbacks.
When two characters are boxed, `activeCharacter` still flips with whichever Zeal stream reported last
(§52), so the highlight follows that flip.

**Deliberately not touched:** the Threat meter has the same wrong keys (the same catalog finding).
It is a one-line fix of the same shape; it was left for its own change.

## §70 — Target Info F/Q/V: Faction, Quest, Vendor (2026-09-28, bot 3.1.166 main, agent 3.7.37 + Mimic beta)
*2026-09-28 · DECISIONS-2026-09-21.md · Target Info Faction/Quest/Vendor tab*

The guild lead: *"lets make a quest tab on target info that has the quest details for what to say and
copyable /say and /map items for who to talk to next"*, then *"Lets make it the same tab as Faction, Make
it F/Q/V for Faction, Quests, and Vendor. Don't bother showing Vendor if its not a vendor mob"* and *"Then
have sub-tabs underneath that."*
- **The tab:** Factions became F/Q/V with sub-tabs Faction / Quest / Vendor. Vendor appears only when the
  NPC sells something. The chosen sub-tab is remembered per viewer.
- **Quest** is read from the NPC's own script (`utils/questDialog.js` over `eqemu_quest_scripts`; all
  5,719 mirrored scripts are Lua). Keywords come from `e.message:findi("…")`, never the [brackets] in
  replies, which can differ (Tarerd Gahar says "[from you]" and listens for "from me"). Each keyword is a
  `/say` chip with the reply; "depends on you" when the answer turns on flags, items or faction; "flag"
  when it can give one. GM-only branches are never offered (the Seer's "delete" wipes every PoP flag and
  is gated on `GetGM()`). Hand-ins come from `scripted_npc_turnins`; who to talk to next is every named
  NPC the replies mention (full names anywhere, a bare surname only in the same zone) with a placed
  spawn for `/map Y X`.
- **Data path:** `GET /api/agent/npc-interact?id=` (bot, 6 h cache) → agent `/api/npc-interact` (asked
  only while the tab is open; an empty answer retried after 10 minutes, not pinned for 6 h the way
  mob-info pins a miss) → `mobinfo.html`.
- **One overlay fix rode along:** Target Info's body is only rewritten when its HTML changed. Before, it
  was replaced every 500 ms, which would have wiped a chip's "copied" and the hover under the cursor.
- **Not built, the one alternative:** a one-line "next step" strip on Stats for quest NPCs, with no tab
  switch. Cheaper to read mid-fight, but it can only show one keyword, and the ask was the full dialogue.
- **Fix, bot 3.1.169:** Willamina's "Some are not even aware…" listed an NPC called Some in Grieg's End
  under who to talk to next (the guild lead: *"Why does this mention Grief's end?"*). The catalog also
  has NPCs named "One" and "Perhaps". A bare word the replies only capitalise at a sentence start is no
  longer looked up catalog-wide; it can still match this zone's NPCs by surname ("Thiran will give you
  the book" → Vicar Thiran). The agent caches an answer for 6 h, so Mimic shows the old list until it
  restarts or the entry expires.

## §73 — The /who overlay gets a Zone column (2026-09-29, agent 3.7.38 beta)
*2026-09-29 · DECISIONS-2026-09-21.md · Who overlay gets Zone column*

The guild lead: *"lets include zone on /who overlay as toggleable column"*.
- **Switch:** `ZONE` in the title bar, next to CLASS and GUILD. Off by default so the overlay looks as
  it did; remembered on this machine. The column sits after level, a fixed 96px, full text on hover;
  the Target card holds an empty cell so it stays lined up.
- **Where the zone comes from:** `/who all` prints each player's short zone name on the row
  (`ZONE: wakening`). A plain /who prints none there, but its footer names the zone everyone listed is
  in (`There are 12 players in The Wakening Land.`), so every row gets that. A `/who all` row with no
  zone (an /anon player) goes blank instead of keeping an older zone. Recently gone rows keep the zone
  they were last seen in.
- **Shown as the game printed it,** so the column can mix `wakening` and `The Wakening Land` across the
  two kinds of /who. The agent has an id-to-name zone table but no short-name one; adding one (about
  200 rows from `eqemu_zone`) would make it read one way. Left for the guild lead to ask for.
- **Upload untouched:** the zone map (`_whoZoneSeen`) sits apart from `whoData`, whose rows upload to
  the bot as they are, so a footer's long name never lands in `who_observations`.
- **Can follow on the same data:** a zone filter chip, or sort by zone.
- `test/who-zone-column.test.js` runs the real /who tracking and row markup; mutation-checked (the /anon
  blanking and the off state).

## §74 — Quest tab: NPC text folded, warnings, give/get, faction; Quarm's own hand-ins (2026-09-29, bot 3.1.170–3.1.171, Mimic beta)
*2026-09-29 · DECISIONS-2026-09-21.md · Quest tab folds text, adds warnings*

The guild lead: *"we should be collapse the npc text and put a warning on anything that despawns a mob or
spawns something else, or causes negative faction. If there are turn-in requirements or you get an item as
output from a quest we should denote that"*, *"we should also track faction for these quests as well where
it makes sense"*, then *"go out and get the missing script info"*.
- **Folded:** what the NPC says sits behind "▸ says" per row (open rows kept per NPC in JS, so the 500ms
  repaint keeps them).
- **⚠ tags** from the script: the NPC despawns; it despawns another NPC; it spawns a mob (named, "may
  attack" on hover); a faction loss (red, the factions on hover). `utils/questDialog.js` `effects()` reads
  both the Lua mirror and the Perl turn-in snippets; the call forms are the ones the scripts actually use
  (eq.depop() 646 scripts, eq.depop_with_timer() 480, e.other:Faction(e.self, id, n)).
- **Items:** a say branch shows "needs <item>" (a HasItem in its own condition) and "get <item>"; a
  hand-in reads GIVE / GET ("one of" for random, "· exp"). **Faction:** every change a branch or hand-in
  makes, gains green and losses red.
- **The script gap, measured** against a fresh clone of SecretsOTheP/quests (5,806 Lua files): every real
  zone's count matches the mirror; the 87 skipped files are `iceclad2`, `lua_modules`, `global`,
  `cshome2` and two `_tryout` folders, none quest NPCs. 16 files changed upstream since the 2026-09-20
  sync (PoP events, the Timekeeper of Druzzil Ro's new dialogue, the Tribunal) and a manual run of
  `sync-quarm.yml` pulled them in (run 47). ⚠ That step is `continue-on-error`, so a failing quest sync
  still shows green; read its log line ("N new/changed").
- **The real gap was the hand-in table:** `scripted_npc_turnins` is ProjectEQ's (every era), not
  Quarm's. So each `check_turn_in` branch in Quarm's script with no ProjectEQ row is now added as a
  hand-in (bot 3.1.171), and a ProjectEQ row with no branch in Quarm's script says "not in Quarm's
  script" on the tab.
- Tests: quest-dialog, npc-interact, target-info-fqv. Mutation-checked.

## §76 — "Save layout" stuck on "no active character yet" (2026-09-29, Mimic beta)
*2026-09-29 · DECISIONS-2026-09-21.md · Save layout stuck on no character*

The guild lead: *"Why doesn't this work"*. Two causes, both fixed: Mimic's state poll, the only source of
the active character, dropped any response over 256 KB without a word (a long session's state grows past
that; cap now 16 MB, logged when hit); and a quiet Zeal (zoning, camping) cleared the character without
rebuilding the menu, so another rebuild in that gap froze the item disabled. The last character is kept
now. `test/char-profile-active.test.js`.

## §77 — The same evening's beta reports, and the timers question (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · Evening beta reports and timers question*

- **Charm tracker REMOVE** (the guild lead: *"It's hard to read the REMOVE"*): the button also carried the
  corner ✕'s class, so it inherited its absolute top-right spot and 35% opacity, under the owner's name.
  Back inline beside BROKE, full strength (beta `6a0931fe`).
- **Trigger TTS "stopped working"** (a bard on beta.3, in Discord): not reproduced. The trigger queue has a
  watchdog, so it cannot wedge for good. What changed that evening: bard charms became tracked, and the
  Charm tracker called `speechSynthesis.cancel()` before every line, which may cut off another Mimic
  window's speech if Chromium's engine is shared. It no longer cancels. The member's agent log records
  trigger playback failures; the next report should come as Mimic feedback with logs.
- **More reports from the same member on beta.1** (feedback table): "charm pet tracker not working"
  (answered by §75), "click one of these and look at the settings it has set for it", "this NEEDS a loop
  timer setting", "does not appear to work as intended when swapping characters" (likely §76). Their
  screenshots sit in the private bucket and need the service key to open.
- **Timers, individually placed** (a member's idea on beta.3: *"What if EVERY timer could be put on the
  screen and resized how you wanted it to be?"*; the guild lead: *"would we be able to accomplish this
  with a single overlay that lets us individually move components? That would be part of my vision for
  3.0's UI/Overlay builder, but this seems like a good starting point"*). Yes — it is the "one freeform
  window" branch of `DESIGN-mimic-3.0-overlay-builder.md` §5.3, and timers are the simplest part to pilot
  it with. Options, costs as build / maintenance / runtime / change:
  - **A. Freeform timers canvas (3.0 pilot):** one transparent click-through window per monitor; the
    three groups in the picture (charm, callouts, debuff timers) are panels placed and sized inside it,
    and any group or single timer can be pulled into its own panel later. Dragging moves an element, not
    an OS window, so the EQ-focus drag fight (the CH chain's) cannot happen. Build 3–4 sessions;
    maintenance medium (per-part hit-testing, per-resolution layouts); runtime one surface, but a
    screen-sized transparent layer over EQ that must be measured on a raid machine first; change low —
    it becomes the 3.0 engine.
  - **B. Split windows now (EQLogParser's shape):** timers leave the trigger overlay for their own
    window, and more timer windows can be made, each trigger assigned to one. Build 1–2 sessions;
    maintenance medium (every window owes the parity checklist); runtime a renderer per window; change
    medium — throwaway once A exists.
  - Recommendation: A, scoped to timers, behind beta.

## §79 — The Timers canvas — option A, first slice (2026-09-29, agent 3.7.42, Mimic beta; FB-33)
*2026-09-29 · DECISIONS-2026-09-21.md · Timers canvas first slice*

The guild lead: *"Go with A"* — the freeform timers canvas from §77, as the first piece of the 3.0
overlay builder. A member's report FB-33: *"What if EVERY timer could be put on the screen and resized
how you wanted it to be?"*
- **What shipped (beta):** `apps/mimic/canvas.html`, one transparent window the size of a screen. Three
  starting panels — **Callouts** (the text of what the voice says), **Timers** (every countdown nothing
  else claims) and **Charm** (recharm tick, charm songs and spells). Arranging: drag a panel by its tab,
  size it from ◢, snaps to the screen's edges and centre and to other panels (Shift: off). ⚙ per panel:
  name, text size, stack up or down, and what it shows — groups (charm, trigger countdowns, lulls, my
  spells on mobs, server tick, loot bids) and timers **by name**, with the countdowns on screen now as
  one-click claims. ＋ Timers panel adds more (12 at most). Hidden panels dim while arranging.
- **Routing, the rule that makes it safe:** a name claim beats a group claim beats the catch-all, and
  there is always exactly one catch-all and one Callouts panel (`sanitize()` restores them), so no
  countdown and no callout can end up with nowhere to show.
- **One voice:** the panels ARE `triggers.html` (`?part=timers` / `?part=callouts`), not a copy. A part
  never speaks or plays a sound; a timers part reads no fires and fires no warnings. The trigger window
  keeps running hidden as the voice (#97's rule — hidden, never freed) and, while the canvas is on,
  speaks without flashing or pinning (`canvasOwnsTriggers`), so a pinned callout lives in one place.
- **Out of the way:** click-through always, unlocked included — a panel takes the mouse only through
  the hover handshake, with a drag shield holding it mid-drag. Dragging moves an element, not a
  window, so there is no focus fight with EQ (the CH chain's stutter). Never force-shown by setup or
  unlock (it is an alternative home for the trigger visuals — on means on); never rescued or
  auto-arranged as a rect; re-covers its screen on display changes; ⇆ Next screen moves it.
- **Where it lives:** layout per screen resolution in Mimic's config (`canvasLayouts`, positions as
  fractions of the screen, sizes in px — EQ's ini rule), saved only by the canvas itself and bounded.
  Tray: "Timers canvas" + "↳ Arrange the canvas…"; dashboard Overlays row with ✥ Arrange; hotkey,
  hide-all, per-character layouts, process name. Agent: `GET /api/timers` (the three fields a part
  reads) and a `group` on every timer row.
- **Cost, measured and not:** one renderer for all panels (iframes share it). Each timers part polls
  the slim `/api/timers` at 700 ms instead of the multi-MB `/api/state`. **Not measured:** a
  screen-sized transparent window over EQ on a raid machine — the guild lead's first run is that
  measurement; it is opt-in and off by default.
- **Next slices** (not built): the Charm tracker, Tick and CH chain as panels (the dock's iframe host
  pattern, one host at a time); a per-panel background; the trigger overlay's 🗑 clear-all on the
  Timers panel. The trigger window's own `/api/state` poll could move to `/api/timers` too — a real
  saving for every raider, left alone here under the minimal-diff rule.
- **Also this evening (agent 3.7.41):** the dashboard's 💾 Save layout button now answers — "✓ Saved for
  <char>" in green or "✗ Not saved — no character yet" in red, for 2.5 s (the guild lead: *"this button
  has no feedback"*).

## §80 — Zeal's bars in UI Studio, where EQ really is, ask before moving; the 3.0 requirements (2026-09-29, Mimic beta)
*2026-09-29 · DECISIONS-2026-09-21.md · Zeal bars in UI Studio, ask before moving*

The guild lead: *"we need to account for /raidbars and /assistbar in uistudio as well, as parts of zeal.
add B, and if the desktop orientation changes or the monitor setup changes, prompt the user to bring the
overlays back to the screen where EQ is. if I kick the power out of my monitor it moves everything to a
different screen and I have to rearrange it."*
- **UI Studio shows Zeal's raid bars and assist bar** as Zeal windows. They are not EQ windows: Zeal keeps
  them in `zeal.ini` as screen pixels at the game's resolution (read from Zeal's own `raid_bars.h` /
  `assist_target.h`): `[RaidBars]` Left/Top/Right/Bottom (0 = the bars may run to the screen edge),
  `[AssistBar]` Left/Top with a size that follows FontSize. Moving writes Left/Top; sizing the raid bars
  writes their box; the assist bar has no size to set, so it shows at an estimate with no grip. Auto-arrange
  keeps overlays off the bars that are switched on. Zeal reads `zeal.ini` at login, so an edit applies
  after a relog, the same as EQ windows (UI Studio's save-on-logout covers it).
- **B is in** (3.0 plan §4): Mimic asks Windows where each EverQuest window and its client area are
  (PowerShell + user32, DPI-aware), on demand and cached, never polled. It decides the overlay home screen,
  projects the UI layout onto a windowed EQ's real client area, picks the Timers canvas's screen, and runs
  before auto-arrange. A 🧲 Rescue clicked after the last reading still wins ("this screen").
- **Screens changed → remember, then ask.** Mimic no longer snaps overlays to the primary screen when the
  screens change. Every overlay's position is remembered per screen setup (the last six), and moves that
  land while the screens settle — Windows shoving windows off a dead monitor — are not remembered. A few
  seconds after the screens stop changing: a setup it remembers gets **"Put them back where they were?"**
  (the power-kick case, when the monitor comes back); overlays whose screen went away or changed shape
  (rotation, resolution) get **"Bring them to the screen EverQuest is on, each at the same spot?"**;
  anything else gets no question. "Leave them" only rescues an overlay left fully off-screen.
  ⚠ Someone running EQ in exclusive fullscreen at a resolution other than the desktop's changes the screen
  on every launch and alt-tab, and would be asked each time. How many raiders run that way is **not
  measured** (the UI backups that carry `eqclient.ini` are encrypted). ~~Not seen in the guild (overlays
  need a windowed EQ)~~ — corrected in §80a: overlays do not need a windowed EQ.
- **The 3.0 requirements, recorded as R11–R15** in `DESIGN-mimic-3.0-overlay-builder.md` §2:
  - R11 every part in formats — horizontal, vertical, arc, circle, thin, thick, transparent, or locked to
    another window;
  - R12 know the shape of EQ's and Zeal's windows;
  - R13 anchor a part to a game window, e.g. charm parts on or around the pet window;
  - R14 minimal parts over the game's own window, e.g. just the HP numbers over the target window, to cut
    the latency people feel while targeting;
  - R15 one product: *"many parts of our mimic feel disjointed. the overlays are the main thing people
    focus on, and the rest of the dashboard has gone to the wayside, with bits of goodness sprinkled in."*
  R12–R14 need live window rects, which only Zeal has (§4 D), so the Zeal "ui windows" pipe message moves
  from a nice-to-have to the load-bearing ask; it should carry Zeal's own bars too.
- **Not decided here:** how the dashboard and the builder fit together (R15). That is a design question,
  so it goes to the guild lead as options before any build.

## §80a — Overlays keep their screen — with EverQuest, on another screen, or both (2026-09-29, Mimic beta `f3e444dd`)
*2026-09-29 · DECISIONS-2026-09-21.md · Overlays keep their screen assignment*

The guild lead: *"why do overlays need windowed mode? it won't work with full screen? folks might want these
overlays on a second monitor, it's up to us to know if they're on the same or a different monitor. or both."*
- **Correction: overlays do not need windowed EQ.** §80 said so; that was an assumption, and too strong.
  What actually holds (general Windows behaviour, **not measured on our fleet**):
  - on a **second screen**, overlays work whatever mode EverQuest runs in; clicking one moves focus off
    EQ, and an exclusive-fullscreen EQ may minimize when it loses focus;
  - on **EverQuest's own screen**, they show over EQ when it runs windowed or borderless; over
    **exclusive** fullscreen, windows generally do not draw on top (Windows' fullscreen optimizations
    change that on some machines, so it varies).
  The crash runbook already recommends windowed or borderless for display-reset crashes, for a different
  reason.
- **It is on Mimic to know each overlay's side.** Built (beta):
  - **Auto-arrange works screen by screen.** An overlay on a side screen is arranged on that screen; only
    EverQuest's screen carries EQ's own windows and the keep-the-middle-clear rule. Before, everything was
    packed onto one screen, and with tonight's live EQ reading that screen had become EQ's, pulling
    second-screen overlays onto the game.
  - **The screen-change question keeps sides.** Each remembered setup also records where EverQuest was;
    an overlay that sat with EverQuest follows it, one that sat on another screen goes to another screen
    that is not EverQuest's, and lands with EverQuest only when no other screen is left. The prompt names
    which is which.
- **Not built, proposed:** knowing EverQuest's display mode. The client's `eqclient.ini` should say
  whether it runs windowed; the exact key on Quarm needs a local session to confirm before Mimic reads it.
  With it, Mimic could warn when an overlay sits on EverQuest's screen while EQ runs exclusive fullscreen,
  and skip the screen-change question that EQ's own resolution switch causes.

## §82 — 🧲 Rescue brings back only what is lost (2026-09-29, Mimic beta `1cd1d423`)
*2026-09-29 · DECISIONS-2026-09-21.md · Rescue brings back only lost overlays*

The guild lead: *"not only does the rescue capture all of the overlays but it puts them all into one spot
which is dreadfully annoying."*
- **Cause.** Rescue parked every overlay whose middle was off the cursor's screen at the same corner,
  24 px apart, then ran auto-arrange over the whole set — so overlays kept on a second screen were
  captured, anything auto-arrange could not place stayed in the pile, and everything already placed got
  re-arranged.
- **Now.** Only a LOST overlay moves: its middle, or its top-left corner (where ✥ sits), is on no screen.
  It goes back to where it last sat on this screen setup, else to the first free spot beside the
  overlays already there and EverQuest's windows. Nothing else moves and nothing is re-arranged.
- **Overlays on another screen** stay unless the raider says so: *"Bring them to this screen too, each at
  the same spot?"*, default "Leave them there" (§80a's rule: keep each overlay's side). With nothing
  lost and nothing elsewhere, Rescue says so instead of doing nothing silently.
- `test/rescue-overlays.test.js` runs the real rescue over two fake screens.

## §83 — 3.0: edit in place, overlay sets, sharing, local-first storage, six display types (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · 3.0 overlay sets, sharing, display types*

The guild lead: *"when we do get this new format working we should be able to edit displays in place, and
lock/unlock windows will be crucial for whether we drag and resize during gameplay. we also need to build in
multiple overlay modes per character, switchable via hotkeys or a simple pipe output that we pick up /pipe
mimic load <overlay set name> or /pipe mimic save <overlay set name> the same load/save should also be
available from taskbar or cycle through via command. overlay designs can be saved and shared, even
suggested … we need our overlays arrangements to be stored locally in case of server issues, but backups
will need to be saved to our database for portability."*
- Recorded as **R16–R21** in `DESIGN-mimic-3.0-overlay-builder.md` §2, with how each lands on what
  exists (the `/pipe` channel is already live — Zeal type 4; sets replace `cfg.charProfiles` and
  `cfg.canvasLayouts`; UI Studio's `ui_layout` backup is the precedent for the database copy).
- **Six display types rendered** on the claude.ai canvas "Mimic 3.0 display types" (the guild lead's
  artifact list): Bar, Ring, Readout, Pips, Timeline, Chips, each applied to target HP, the charm
  timer and the debuff list side by side, with a board per type and an edit-in-place board (locked vs
  unlocked, the set switcher, the `/pipe mimic` verbs). **Not picked yet** — the guild lead's call.
- **Not built.** These land on the `alpha` branch (§81) when the builder does. Proposed order: sets +
  `/pipe mimic` verbs + local file first (useful on today's overlays), then the database backup, then
  sharing, then the display types on the canvas panels.

## §83a — The build order is taken (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · 3.0 build order settled*

The guild lead: *"do your ordering for the new types and the two latest entries."* So the proposed
order stands, and the display types go in pairs by what they reuse:
1. **Overlay sets** — local file, `/pipe mimic load|save|next|lock`, tray load/save/cycle, the same on
   the dashboard (tray ↔ dashboard parity). Useful on today's overlays before any builder exists.
2. **Database backup** of the sets, then **sharing / suggesting** a set.
3. **Display types: Bar, Readout, Chips first** (what today's overlays already draw, so the builder
   proves itself on known shapes), **then Ring and Pips, Timeline last** (it needs a time axis every
   data element would have to supply).
Builder work goes to `alpha`; anything the agent needs goes to `beta` first (§81).

**Step 1 shipped the same day — alpha `e9e4f3d6`.** Overlay sets: which overlays are on, where each one
sits, how see-through and how big, and the Timers canvas panels, saved under a name in
`overlay-sets.json` beside Mimic's config (no network). Switched by `/pipe mimic load <set>`,
`save [set]` (no name = over the set you are on), `next`, `prev`, `lock` / `lock on|off` / `unlock`;
the tray's 🗂 Overlay sets; and Settings → Overlay sets (tray ↔ dashboard parity, through one command).
Choices made in the build, each the guild lead's to overturn:
- **A set is loaded only when asked.** A character switch does not load one: with two clients open
  the active character flips on every alt-tab, and the screen must not rearrange itself under you.
  The old per-character layouts keep working beside sets until sets replace them.
- **`next` cycles the sets that character has used**; a character with fewer than two cycles every set.
- **No delete from the game** — a hotbar typo must not lose a set; Settings deletes.
- **The hotkey is EverQuest's own**: a social with `/pipe mimic next`. No new Windows-wide key.
- **Feedback shows on the trigger overlay** ("Overlay set: raid"), because a Windows notification does
  not show over full-screen EverQuest.
- A set saved on another screen setup lands like a screen change (§80a): each overlay keeps its side.

## §85 — DPS HUD +pet: the pet's share on the bar; click for name, damage, spawn id (2026-09-29, agent 3.7.45 beta `672ff15e`, bot 3.1.175)
*2026-09-29 · DECISIONS-2026-09-21.md · DPS HUD pet share on bar*

The guild lead: *"show the +pet on the DPS hud, then the color of the +pet and the section of the bar that
is highlighted should match to distinguish how much was the player vs the pet, and if you click on +pet it
should open a line below to show the pets name and damage and spawnid. we should be able to get this when
someone does pet leader and has zeal tags on"*
- **Built as asked, one design.** The request named the design, so there were no variants to offer.
  The one open choice was the colour: the pet's end of the row bar and the "+pet" label are the
  dashboard's pet orange `#f0883e`. The owner's part keeps its row colour: blue, red on the Tank tab,
  gold on your row. If orange next to your gold reads too close in the 2 px bar, purple `#a371f7` is
  the alternative.
- **Click +pet** → a line per pet under the owner: name, damage, its share of the owner's number, and
  the spawn id, or "spawn id unknown" with a tooltip. The locked HUD takes the mouse only over a +pet,
  so the rest of the scoreboard stays click-through to EverQuest.
- **Where the spawn id comes from — provable only, best first** (`_petSpawnIdFor`):
  1. this machine runs the owner, and Zeal's pet gauge names that pet → Zeal's `pet_id` (1.4.6+);
  2. a fresh Zeal `/tag` on the pet (the tag line carries the id);
  3. one of this machine's characters has it targeted;
  4. the owner's own Mimic uploaded (1) with the pet's damage, and the bot pooled it beside the
     "My leader is" owner (bot 3.1.175: `addPetSpawnIds`, served as `ids` on the `pet_owners` poll,
     one hour max, since an id lasts one zone and one summon).
  So "when someone does pet leader and has Zeal" works through (1) and (4): the owner's Mimic knows the
  id, and the declaration names the owner for everyone else. Otherwise the line says unknown; it never
  guesses.
- Tests: `dps-hud-pet-breakdown` (beta) and `pet-owners-stream` (main), each rule mutation-checked.

## §87 — Timers canvas: a ✥ on every panel, all the time (2026-09-29, Mimic beta `1a292133`)
*2026-09-29 · DECISIONS-2026-09-21.md · Canvas panels always show move button*

The guild lead, looking at the canvas in game: *"these windows look good, they do not have a move button
on them which should be there at all times"*. Until now a panel moved only inside Arrange.
- **Every panel carries a small ✥** just outside its top-left corner, tucked inside when the panel sits at
  the screen's left edge. Drag it to move the panel; right-click it for the panel's settings. While
  arranging it hides, and the panel's tab carries ✥ as before.
- **The canvas stays click-through.** Locked, the ✥ is the only part of a panel that takes the mouse: it
  arms the hover handshake, the drag shield holds the drag, and a panel's body still passes clicks to EQ.
  So the §79 rule ("click-through always, unlocked included") holds; the ✥ is one more control on the
  handshake, like the ✕ on every other overlay.
- A settings menu opened from ✥ while locked closes when the cursor leaves it, because a click outside
  would land in EQ and never reach the canvas.
- Resize stays in Arrange (the ◢ grip). Sizing mid-play was not asked for, and a second always-on handle
  is one more thing on screen during a fight.
- `test/timers-canvas.test.js` pins the ✥, its any-time drag and that the panel body takes the mouse only
  while arranging; the guard was mutation-checked. Rendered headless, locked and arranging, before pushing.

## §89 — Rescue never relocates an overlay you can see (2026-09-29, Mimic beta `a12d157c`)
*2026-09-29 · DECISIONS-2026-09-21.md · Rescue never moves visible overlays*

The guild lead, on beta.15, which already had §82: *"make it so that rescue to screen only brings the
overlays that were missing from the screen, not the ones that are already arranged"*.
- **Why §82 still moved arranged ones.** Lost was "middle OR top-left corner on no screen", and the corner
  half assumed every ✥ sits top-left. An overlay whose see-through edge hangs past a screen edge counted
  as lost and was relocated. The clearest case is the HUD ring: its corners are transparent, and in the
  ring layout its ✥ sits under the ring.
- **Now:** lost means you cannot see it, i.e. its middle is on no screen or under half of it is on a screen.
  Only those are brought back (remembered spot, else a free one), as before.
- **A visible overlay whose ✥ is past the edge** is nudged just far enough that its top-left corner is on
  its own screen, and the "No overlay was lost" note names it. For the HUD, either the top-left or the
  spot under the ring counts as grabbable, so an arranged ring is left alone.
- `test/rescue-overlays.test.js`: the old "top-left off the top is lost" case is now "moves only as far as
  its ✥ needs". New cases cover under half showing (lost) and the HUD ring against the corner (untouched).
  Each rule was mutation-checked.

## §90 — Right-click 🖥 Move to another screen; Rescue always lands what it brings (2026-09-29, Mimic beta `f494f41c`)
*2026-09-29 · DECISIONS-2026-09-21.md · Right-click move overlay to another screen*

The guild lead: *"rescue did not bring the extended target to the current monitor. perhaps we add it to the
right click menu"*.
- **Why Rescue left it:** when this screen had no free spot for an overlay, the placement skipped it, so it
  stayed where it was. "Bring them here" then did nothing for it, and a lost overlay stayed lost. Now a
  brought overlay lands at the same spot on this screen, and a lost one at its remembered spot (else a
  cascade near the top-left), overlapping if it must. (If Extended Target was sitting whole on the other
  screen and the answer was "Leave them there", that was the old design working as meant; the new menu
  row is the direct way.)
- **The menu row:** every overlay's right-click menu gets one row per other screen, "🖥 Move to the screen
  on the left / right / above / below". EverQuest's screen is marked when Mimic has read where EQ is, and
  the size is added when two screens sit on the same side. The overlay goes to the same spot on that
  screen, kept whole, and the spot is saved (`_persistBounds`; `setBounds` alone does not save).
  There is no row with one screen, and none on the Timers canvas, which follows its own screen.
- Tests: `test/move-to-screen.test.js` (new; the real handler over fake screens) and two new
  `rescue-overlays` cases. Mutation-checked.

## §92 — Timers canvas: 🧪 test rows per panel; the settings view stays on screen (2026-09-29, Mimic beta `7ebe2989`)
*2026-09-29 · DECISIONS-2026-09-21.md · Canvas test rows, settings stay on screen*

The guild lead, on a panel's settings opened from ✥: *"This view could go off the screen. give me a button to
show test data there of each type that's selected there"*.
- **🧪 Show test rows** (every timers panel's settings): that one panel shows a sample of every kind of
  countdown that would land in it: one per group it claims, and one per timer it claims by name. It lasts
  30 seconds or until pressed again, works locked or while arranging, and nothing is saved.
  - The catch-all panel shows samples of whatever no other panel claims. The samples are routed exactly
    like real countdowns.
  - A callouts panel gets **🧪 Show a test callout** instead: one sample, shown and never spoken.
- **The samples now cover all six groups.** "My spells on mobs" and "Loot bids" had none, so a panel
  claiming only those looked empty while arranging too.
- **The settings view is placed whole on the screen:** under the ✥ or panel it came from, else above it,
  else as low as it can sit. It is never taller than the screen (it scrolls inside). It is placed again
  when the "on screen now" list fills in, which used to grow it past the bottom edge. Opened from ✥, it
  anchors to the ✥.
- Tests in `test/timers-canvas.test.js`, mutation-checked:
  - the samples cover every canvas group and the claimed names (run for real);
  - `placeMenu` is run for real in three positions.
  Rendered headless near the top and bottom of a screen.

## §97 — Command Center: 📋 on a deathroll (2026-09-29, Mimic beta `013e2e0c`, agent 3.7.47)
*2026-09-29 · DECISIONS-2026-09-21.md · Command Center deathroll copy button*

The guild lead: *"add in a copy button for deathrolls"*.
- **What it copies:** the whole game as one chat line, e.g. "Deathroll 32,000: A 26189 > B 24160 > … >
  B 0. B loses.". A game still going ends with whose roll it is.
- **Fits EQ chat:** plain ASCII (EQ's chat font has no dash or arrow glyphs), at most 250 characters.
  A long game keeps the first roll, "...", then as many of the last rolls as fit.
- **The button:** ✓ for two seconds after a copy; on the hover handshake, so it works on a locked overlay.
  The clipboard is the only path; the agent never types into chat.
- **Tests:** `test/deathroll-copy.test.js`.

## §98 — Target Info: a player who cons even shows your level (2026-09-29, Mimic beta `386cfc99`, agent 3.7.48)
*2026-09-29 · DECISIONS-2026-09-21.md · Target Info shows player level from con*

The guild lead: *"Faedar conned even to me he should show up as level 60"* — an anonymous bard, whom Target
Info had called "level unknown until a /who sees them out of anonymous".
- **Partly reverses §15.** §15 stopped using a player's /consider after "looks like quite a gamble",
  yellow by the documented table, gave level 60s a range of 61–62.
- **The evidence:** both reports are level-60 players reading that phrase to a level 60. For a PLAYER it
  is the even con.
- **Now:** a player's level comes from live `/who`, else an even con (that phrase or "looks like an even
  fight") = your own level, shown "(even con)", else `/who` history. The con outranks history, which can
  be weeks old.
- **Unchanged:** every other phrase still gives a player no level and no colour. NPC considers, and the
  phrase learner (NPCs only), are as they were.
- **Tests:** `test/mana-drain-and-con.test.js`.

## §102 — 3.0 alpha: every overlay can live on the Timers canvas, as it is today (2026-09-29, alpha `d2dadf94`)
*2026-09-29 · DECISIONS-2026-09-21.md · Every overlay on Timers canvas*

The guild lead: *"i would like the next version of alpha to have all of the data elements from the current
overlays. each current overlay's data elements can come in as they are today, no new modalities if that makes
this less of a lift, but the end goal is to incorporate the different views"*.
- **The least lift is the builder plan's "compat part":** each overlay's own page in an iframe, the way the
  Dock already hosts panes. No fork, no new display type. The 15 are the Dock's 14 plus the HUD ring, which
  a free screen can hold even though a grid cell cannot. The trigger overlay was already there as its
  callouts and timers panels.
- **One copy of each overlay.** While an overlay is on the canvas, it has no window of its own
  (`_canvasHostedKeys` in `_overlayWanted`, ahead of every force-show), and it leaves the Dock. Adding one
  switches its own flag on, so Remove gives its window back visible, the Dock's undock rule. Hiding a panel
  keeps the overlay on the canvas and unloads its page. Turning the canvas off gives every overlay back to
  its own switch.
- **"Bring in the N on screen now"** moves every overlay that has a window or a Dock pane onto the canvas, at
  its window's spot, size and zoom. So the first alpha looks like the raider's current setup, in one window.
- **What the canvas owns:** the always-on ✥, size (A−/A+ scales the whole page), hide, remove. The page's own
  ✥, ✕ and setup bar are hidden there (preload `WP_IN_CANVAS`); its buttons and tabs work through the hover
  handshake as they do in its window.
- **The end goal:** the six display types (§83) replace these panels one overlay at a time. Each overlay's
  data becomes parts, and the compat panel goes.
- ⚠ **Not measured:** the cost of 15 pages in one screen-sized transparent window on a raid machine. The Dock
  shows iframes cost less memory than windows, but not the compositing cost of a full-screen surface. Watch
  the tray's "Resource use — what Mimic costs this machine" on the alpha.
- ⚠ **Known gap:** docking an overlay that is already on the canvas shows it in both places until one is
  removed. Only the canvas-to-Dock direction is guarded.
- Alpha only, like all builder work. Tests `test/canvas-overlays.test.js`; the full alpha suite is green.

## §103 — 3.0 alpha: pieces — every data element on its own, by category, in the mode you pick (2026-09-29, alpha `994eb032`)
*2026-09-29 · DECISIONS-2026-09-21.md · Canvas pieces by category and mode*

The guild lead, the same day, after §102: *"break them up and put them into categorization like we did with
the HUD. My Info, Group info, Raid info, target info, pet info, charm info, etc. Make it a persistent chooser
that i can pull up and move things around, then select the mode for the data. break out every data element.
when I'm designing this it should feel like i'm putting down individual legos instead of prebuilt pieces,
then be able to save groups. Start with the groups of our overlays today and let me pull pieces out as
well."* This supersedes §102 as the direction; the whole-overlay panels stay as one section of the chooser.
- **116 pieces in 12 categories:** My info, Target, Group, Raid, Pet, Charm, Fight, Main tank, Healing,
  Timers & ticks, Zone, Casting (`apps/mimic/parts.js`).
  - Each piece reads one field of an agent endpoint the overlays already use: `/api/me`, `/api/state`,
    `/api/tank-state`, `/api/command-center`, `/api/extended-target`, `/api/buff-queue`, `/api/timers`.
  - Each has a kind: gauge, value, countdown or list.
  - Each has a sample for building with no game running.
  - Field paths come from the serializers themselves, not from the catalog's prose.
- **Modes per kind**, a subset of the six display types (§83):
  - gauge: bar, ring, readout, big number, pips;
  - countdown: bar, ring, readout, big number;
  - value: readout, big number;
  - list: rows, chips.
  - Timeline and the "locked to a window" anchor are still to come.
- **The chooser** is a movable palette that remembers whether it is open, where it sits, and its tab.
  - Drag a piece onto the screen, or drag one of its mode chips to place it in that mode.
  - Every piece shows its live value in the list.
  - The Groups tab holds today's 17 overlays as groups of pieces, laid out as the overlay had them, then
    "my groups", then the whole overlays as today (§102).
- **Legos:**
  - A dropped group lands as separate pieces that share a group id.
  - Ctrl-drag moves the group; a plain drag pulls one piece out.
  - Shift-click selects; 💾 saves the selection as a group (`cfg.canvasGroups`, one list for every screen).
  - Delete removes the selection; right-click a piece to change its mode, backing and size.
- **Cost to watch:** a source is polled only while a placed piece, or the open chooser tab, needs it. A
  piece's HTML is only written when it changes. But `/api/state` is multi-MB on a raid machine, and a piece
  that reads it pulls the whole thing every second. **A slim endpoint per piece family is the next
  performance step** once the pick of pieces settles.
- Not measured on a raid machine. Alpha only. Tests `test/canvas-pieces.test.js` (the library run for real,
  mutation-checked). A headless run against a fake agent showed live values, a Tank group dropped as 11
  linked pieces, and a saved group.

## §105 — Pieces, round two: delete, a group drags whole, edit from any corner, lock and save your own sets (2026-09-29, alpha `291ddcaa`)
*2026-09-29 · DECISIONS-2026-09-21.md · Canvas pieces delete, group drag, saved sets*

The guild lead, on the first pieces alpha:
- *"when i hit the X on one of these elements it just hides it … I should be able to delete out the elements
  instead of hiding them"*;
- *"I should also be able to drag the whole group that came out from the panel at the same time instead of
  grabbing the top one and having it get disconnected"*;
- *"I have no way of bringing up the overlay editing other than the taskbar now. It needs to be something
  that i can get to from the right click menu in the top corner of the overlay panel"*;
- *"I need a faster way to get to the editing mode for individual components"*;
- *"I should be able to select multiple pieces, lock them together (and not necessarily touching) and move
  them at the same time. Should be able to save my own subsets."*

This reverses §103's drag rule. What changed:
- **✕ on a piece deletes it**, with an Undo toast for 8 s (and Ctrl+Z). Other panels' ✕ still hides. The
  callouts panel and the catch-all timers panel can never be deleted.
- **A plain drag moves the set:** the selection the piece is in, else its group, else just the piece. The
  grabbed piece snaps; the rest keep their distance.
  - **Alt-drag** pulls one piece out and takes it out of its group.
  - Ctrl-drag is gone.
- **Selecting:**
  - Click selects; Shift- or Ctrl-click adds, however far apart.
  - A bar under the toolbar then offers 🔗 lock together, 🔓 unlock, 💾 save as a group, and 🗑 delete.
  - Any panel kind can be locked with pieces, including an overlay or a timers panel.
- **The ways into editing:**
  - One click on a piece's always-on ✥ while playing opens its settings, and the settings open with ✏
    Arrange the canvas / ✓ Done and 🧩 Pieces.
  - Double-click a piece while arranging.
  - "🧩 Arrange the canvas (pieces)" in every overlay's right-click menu.
  - `/pipe mimic edit` (also `arrange`, with `on` / `off` / `done`) from the game.
- Tests `test/canvas-pieces.test.js` (the drag set and delete/undo run for real). A headless run moved all 11
  Tank pieces by one offset, pulled one out with Alt, deleted and undid, and moved a far-apart locked pair
  as one.

## §106 — Old characters fold away; the Overlays tab gets three mockups; a group sizes as one (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · Old characters fold away, Overlays tab mockups*

**Characters touched in the last 3 months show; the rest fold into "more".** The guild lead, on the
setup walkthrough's character list: *"i have too many old files in here. we should really just show things
that have been touched in the last 3 months and then a collapsed section with more. Same thing for the /me
page."*
- **Mimic setup walkthrough** (beta `3f390c1c`): the table shows characters whose log was written in the
  last 90 days, plus the starred main. The rest sit under a closed "N more · not played in 3 months",
  with the same Main and Send controls. `splitRecentChars()` in `apps/mimic/welcome.html`.
- **/me** (web 1.8.54, main `318cbe1d`): "touched" means the newest agent upload on any stream, or a
  live-state snapshot, within 90 days. The character cards and the Mimic sync list both split this way.
  The sync list's old "with no uploads" section now holds the older characters too.
- On both surfaces, if nothing is recent, everything shows. An empty list would be worse than a long one.

**The Overlays tab: three mockups, no pick yet.** The guild lead, from a screenshot of the tab: *"Show me a
few mockups for a new overlays tab that can build these overlays faster, right now it's just a wall of
text and toggles, then mismatched keybinds. We should have a gallery view in here if it's a selection
tool, but ideally it would be a home for the builder to live."* The mockups are a
private page in the guild lead's artifact list, titled "Overlays Tab Mockups". The three options:
- **A, gallery:** cards with a sketch, a switch, a key and "Open in builder".
- **B, studio:** a pieces library, a miniature of the screen and a settings panel. The builder lives in
  the tab.
- **C, layouts:** saved layouts as tiles, "on screen now" with one key each, and "Arrange on screen". The
  tab launches the on-screen builder. A's cards become C's Add drawer.

All three share one key format, with clashes shown in red. The recommendation is C, which does not
build a second editor. B's costs are high on build and on maintenance, because two editors of one layout
have to agree. ⚠ The tab lives in the agent dashboard (`packages/wolfpack-logsync/dashboard.html`), so
whichever option is picked lands through `beta` and must show the builder parts only on a Mimic that has
the canvas.

**A group sizes as one** (alpha `a5532ace`). The guild lead: *"when a group is selected by grabbing the top
bar you should be able to resize the entire group"*.
- A click on a grouped piece now selects the whole group; Alt-click selects just the one piece.
- Two or more selected get a dashed box with a single ◢. Dragging it stretches every piece from the box's
  top-left corner, keeping their places relative to each other.
- A piece's text grows with the height. A wider group alone keeps the text size. Shift keeps the group's
  shape.
- The ◢ on any grouped piece does the same; Alt-drag on it sizes only that piece.
- `groupBox()` and `scaleGroup()` are pure functions and are tested for real in
  `test/canvas-pieces.test.js`.

**Background on the Timers canvas** (beta `45e76402`). The guild lead: *"background on the timer canvas just
makes the whole screen dark"*. The backdrop painted `<body>` on any overlay without a `#wrap` card. The
canvas window covers the screen, so the whole screen went dark. On the canvas the plate now goes on each
visible panel instead, in `preload.js`, marked by the canvas's own `#screenBtn`. The alpha picks it up by
sync; the merge was checked and is clean.

## §107 — Canvas round three: Target Info's every tab as pieces, the HUD's formats, a menu that moves aside, option C for the Overlays tab (2026-09-29)
*2026-09-29 · DECISIONS-2026-09-21.md · Canvas rename, Target Info pieces, option C*

The guild lead, on alpha 848, with screenshots:
- *"Go with C, change the name of the Timer Canvas to Canvas."* Also: *"we're going with C for Overlay
  screen."*
- *"When the Canvas has a background toggled it just greys out the whole screen instead of individual
  components within it."*
- *"We need more element types, sizes, formats like in the hud"*.
- *"The Target Info is missing all sorts of data. no drops no spells no fwv"*.
- *"The right click in the corner of an element completely covers the overlay. We need to adaptively find a
  spot where we can put it above or to the side depending on how far from the edge of the screen it is."*
- *"Selecting Chips in the target info's breakout 'its buffs' version doesn't expand to match the size of
  the overlay."*

**Picked: Overlays tab option C** (§106's mockups). The tab becomes layouts, what is on screen now, and an
Add drawer, and "Arrange on screen" launches the builder. The build is in the next entry once it lands on
beta.

**Built on the alpha (`ec8ad702`, 3.0.0-alpha.852):**
- **Renamed Canvas** on the tray, window title, overlay name list, toolbar and the overlay-sets note. Beta
  follows with the Overlays tab (`e07d75fa`, held for one build). Code comments keep the old name.
- **Background:** §106's per-panel plate reaches the alpha only on its next own push, because syncs do not
  rebuild. `ec8ad702` is that push. Checked headless: with Background on, the body stays transparent and
  each panel takes the 0.92 plate.
- **Target Info, every tab** — from the bot's catalog row (`mobInfo.mob`):
  - Stats tab: level, zone, HP (live cur/max when known), damage, AC, the AC-and-resists grid (coloured by
    how hard it is to land on), special attacks (dangerous ones red, immunities blue), sight ("Sees Invis"
    judged as the overlay does: undead → IVU only), and a PQDI link that opens the browser.
  - Other tabs: drops (drop-rate colours, ⭐ unique, LORE, "N× won"), spells (what it casts at you first,
    resist and cast time), and faction hits on kill.
  - Quest and Vendor from a new `npc` source. Its path is a function of the state source
    (`/api/npc-interact?id=<target npc>`); it waits while there is no target, drops the old answer on a
    new target, and asks again every 1.5 s while the bot is still reading the script.
  - Quest rows copy a `/say` or `/map` when clicked, locked or not (a `.ctl data-wp-interact` span).
  - The Target Info group gains a second column with the tabs. A separate "Target: drops, spells,
    F/Q/V" group has just those.
- **Formats like the HUD:** slim bar, upright bar, half ring, badge (the HUD's DS circle), one coloured
  line (the HUD's resist row; resists now carry its colours) and columns.
  - Every piece can also hide its label, and take a thin, normal or thick bar or ring, its own colour and
    left, centre or right text.
  - These settings go through sanitize, saved groups and placement.
- **The menu moves aside:** `menuSpot(W, H, box, mw, mh)` is pure. It tries right, then left, then below,
  then above, and takes the first side with room for the whole menu. Otherwise it takes the spot that
  covers the least of the piece. The box it keeps clear is the piece's whole group.
- **Pieces fit:** a mode change keeps the piece's width (rings excepted) and takes the height its content
  needs. "↕ Fit" does the same on demand. Checked headless: chips on "Its buffs" stayed 200 px wide and
  grew to 79 px, all shown.
- **Found while testing:** double-click on a piece never opened its settings. The first press raises the
  drag shield, so the browser's dblclick lands on the body. The canvas now counts two clicks on one piece
  within 450 ms itself.
- Tests: `test/canvas-pieces.test.js` round three (modes, look options, resist colours, every target piece
  on real-shaped data, the npc source, the preset, sanitize, fit, clicks, two clicks) and
  `test/timers-canvas.test.js` (menuSpot on five placements). Full suite green.

**The Overlays tab, option C, on beta** (`b8c6b98c`, agent 3.7.49; the Canvas rename `e2116fa2` rides with it).
Layout tiles, an Arrange bar, what is on screen now, an Add drawer of overlay cards, and one keycap
format everywhere with clashes in red. Every control of the old tab has a home in the new one; the list
is in HOW-ITS-BUILT ("Dashboard: the Overlays tab, option C").
- **A bug the old tab had**: its per-character layouts card read `charProfiles` from the agent's state,
  which never carries them. So its saved list was always empty, and the auto-switch box was never shown
  ticked. The new tiles read Mimic's own status.
- **Left out, on purpose**:
  - Sketches on the layout tiles: a saved layout records which overlays are on, not where they sit.
    Tiles list the overlay names instead of inventing positions.
  - Role filter pills: 12 of 18 overlays would land in "Everyone", and which overlay belongs to which role
    is the guild lead's call.
- **The alpha got it by a hand merge** (`703a6017`). The sync workflow failed, as expected: the tray label,
  the canvas hint line and their test changed on both branches. The alpha kept its own wording.

**The Pieces chooser, readable again** (alpha `7f239374`). The guild lead, on the chooser once the new
formats landed (one crowded line per piece, names cut off, a sideways scrollbar): *"i can't read this"*.
- Each piece shows its whole name and current value, with its ways to draw it on a wrapping line
  underneath, by name.
- The chooser went from 300 to 360 px and from 11 to 12 px text.
- Its right edge drags from 280 to 640 px, and the width is kept with the layout.

## §110 — Feedback round FB-38 to FB-42 (2026-09-30)
*2026-09-30 · DECISIONS-2026-09-21.md · Feedback round FB-38 to FB-42*

- **FB-38 (stable 2.7.4): XS not remembered after a restart.** XS is 200 px; twelve overlays had a 220–300 px
  minimum width. A locked window takes XS anyway (Electron pins a non-resizable window's minimum to its
  new size), so 200 was saved, and the next launch built the window at its own minimum. Every overlay's
  minimum is now `_OVERLAY_MIN_W` (200), the same number as XS. Beta `0d782606` (agent 3.7.50). Not
  reproduced on Windows; the report does not name the overlay, so the member should confirm after the
  update.
- **FB-41: "Reslow" spoken as REH-slow.** The built-in slow callouts now speak "Ree slow" and "Ree slow
  soon"; the text on screen still says reslow. Beta `0d782606`.
- **FB-42: a kill stayed on the HUD for 90 s.** The HUD kept a dead mob's hit tally as a dim ghost for
  90 s (`_ME_TALLY_DEAD_MS`); now 10 s. Beta `0d782606`.
- **FB-40 (alpha): Canvas target mana, move icons, labels.** Target mana was blank until the agent saw the
  mob cast; it now shows the catalog pool as a full bar ("no casts seen"), as Target Info does. A group
  shows one ✥ (its top-left piece), which moves the group. "Its …" labels read "Target …". Alpha `f7881fc3`.
- **FB-39: Extended Target did not tell two same-name mobs' debuffs apart.** The guild lead, after the
  first round: *"FB-39 is extended target. You can see the spawnids are varied and the buffs should have
  been associated but they weren't, even though both of us were using miMIC."* Three causes, all fixed:
  1. The bot never selected `buff_casts.target_id`; debuffs came from a NAME-keyed map.
  2. That map kept one entry per spell (the newest landing), so a slow on one of two same-name mobs
     vanished when the other was slowed.
  3. The overlay drew per-row debuffs only when a row carried position-clustering tank labels; rows
     split by spawn id went into the pooled "on one of these N" block.
  Bot 3.1.178 (main): `_extDebuffInstances` makes one entry per spell per mob, pooling a cast seen by
  several Mimics and trusting neither id when two disagree (a bystander's agent stamps its OWN target's
  id when the names match, `_provableTargetId`); `_extAttributeDebuffs` places by id first. Overlay: beta
  `dde2f702`. Evidence: two `froglok krup shaman` alive at once (spawn ids 1296 and 1329); the guild
  lead's agent sent id 0 on landings the partner's agent tagged. K=1 rows are unchanged.
  ⚠ Open, not fixed: `_provableTargetId` can stamp a wrong id when a bystander targets another mob of
  the same name. The bot now distrusts disagreeing ids; a lone wrong one still places wrongly.

## §114 — Target Info: mob info kept on the member's machine (2026-09-30, bot 3.1.179, agent 3.7.55 beta `effdc609`)
*2026-09-30 · DECISIONS-2026-09-21.md · Mob info cached on member's machine*

The guild lead, on Target Info loading slowly, picked the disk cache (option B of four) and widened it:
*"keep all of the PoP mobs cached on a user's machine, as well as zones that the user frequents"*.
- **What was slow, measured:** the bot's `mob-info` answer is flat over the week (median 110–240 ms, p95
  0.5–1 s, p99 up to 2.6 s, 10,691 calls in 7 days), so Railway did not get slower. Target Info reads the
  agent's whole `/api/state` twice a second to use two fields from it, and that payload now carries every
  guild trigger with its notes: **591 KB, 457 KB of it added by the PoP and Ring of Fire imports (§112–§113)**.
  That is the likelier cause and this change does not touch it (open item below).
- **Bot:** `_buildMobInfo` is the mob-info lookup lifted out of its handler unchanged. `GET
  /api/agent/mob-pack?zone=<id>` builds every NPC name in the zone's id block (`zoneid*1000 + n`, so
  scripted spawns come too) with that zone as the requester's, keyed by `_mobCaseKey`. A pack is built once
  a week, one zone at a time and three lookups at a time, kept in memory (up to 120 zones) and in `bot_kv`
  (`mob_pack:<zone>`, stored as the exact string served, so the ETag survives a deploy), and served gzipped
  with an ETag (304 on a match). Not built yet: 202, built in the background. A build where most lookups
  failed is not saved, so a database hiccup cannot pin a hollow pack for a week. `?pinned=1` lists zone
  ids 200–223, the Planes of Power: codecay and pojustice carry expansion 0 in our mirror, so the id range
  is used rather than the flag. `test/mob-pack.test.js`.
- **Agent:** `mobinfo-cache/` beside the agent, one file per zone. `fetchMobInfo` answers from it before
  any network call, and Target Info shows the hit on the same poll. Every 20 s the agent records each
  character's zone and fetches its pack, and fetches one pinned zone. A held pack revalidates daily.
  Eviction drops unpinned zones unvisited for 90 days, then the oldest past 80 MB. Mimic updates replace
  only the agent's three code files, so the cache survives them. `test/mob-pack-agent.test.js`.
- **Size:** PoP is about 1,800 distinct mob names across 24 zones. Deployment cost: DESIGN-selfhost-wizard §3.
- **Not built:** loading one tab at a time. It would show Stats sooner on a first lookup but make every tab
  click wait on the bot; with the pack on disk, one call is the better trade.

## §115 — Two things found in the guild lead's `/api/state` paste (2026-09-30)
*2026-09-30 · DECISIONS-2026-09-21.md · DPS HUD and player HUD totals differ*

- **The DPS HUD and the player HUD's Σ count different things.** The DPS HUD's damage (`currentEncounterThreat.perPlayer[].dmg`)
  includes damage-shield hits. The player HUD's Σ is the `out` lane of `_meMobTallies`, which puts DS in its
  own `ds` lane. On the screenshot's fight that is 4,072 against 3,938. The 134 difference is thorns plus any
  small hit the HUD judged to be DS. The second DPS HUD row, named after the mob, is the total row, not a
  mis-parsed attacker. No change made; the fix, if wanted, is to label the Σ as "your hits, DS apart" or add
  the DS lane into it.
- **The raid hold is on every Sun/Wed/Thu 19:00–00:30 ET, raid or not.** The paste showed
  `updateBlocked: raid hold — the bot reports an active raid` on a no-raid Wednesday. `_raidHoldNow` is
  schedule-driven; with no formal raids until 10/14 (§113), agent updates and background scans wait on those
  evenings unless an officer sets `flag_raid_hold = 0` in /admin/overlays, and clears it before 10/14.

## §120 — Quest tab: lines kept in a table; hand-ins that give a flag (2026-10-01, bot 3.1.183)
*2026-10-01 · DECISIONS-2026-09-21.md · Quest tab keeps lines, flag hand-ins*

The guild lead, on Askr the Lost's Quest tab: *"This is missing the actual instructions"* — the tab
listed three hand-ins with "GET nothing listed" and no dialogue.

**Why.** Quarm's `pofire`-era Askr script keeps every line in `local RESPONSES = { … }` and says them with
`e.other:Message(0, RESPONSES[11])` or `RESPONSES[state]`; the reader only knew string literals. His
rewards are `SummonCursorItem` (the bag) and `set_global` (the Thunder flag steps), neither of which the
reader counted as "gives", and his three giant-head hand-ins sit in one `or` condition, so two of them
got an empty branch.

**The fix (`utils/questDialog.js`, `_npcInteract`).** String tables are read; a fixed index resolves, and
a variable index gives one line per value the `if`/`elseif` above allows. `SummonCursorItem` and
QuestReward's exp count. `or`-joined hand-ins share the branch, carry the same `group`, and the bot shows
a group's identical hand-ins once. A branch that sets a flag lists "a character flag" under GET. No
overlay change: GET already prints whatever outputs carry. Checked against a trimmed copy of the script
(`test/quest-dialog.test.js`); not yet against the live row, which needs a fresh `npc-interact` (6 h cache).

## §125 — 3.0: every overlay reproduced exactly on the Canvas, then taken apart (2026-10-02, alpha `a29075d9`, beta `5eae2d53`)
*2026-10-02 · DECISIONS-2026-09-21.md · Every overlay reproduced on Canvas*

The guild lead: *"when we're done with the alpha 3.0 version every one of the overlays should be exactly
reproduced within the canvas so the people can disassemble them and use any element of them in the way
that they feel fits best on their screen. and in my mind we can take their exact layout with where their
windows are and arrange those pieces in a way that makes the most sense and takes up just the right amount
of screen real estate while getting out of their way so that they can play the game."* And: *"in its
current implementation the overlays as they exist outside of the canvas are not reproducible inside of the
canvas. that needs to be a priority before we can optimize anything else."*

**The call: parity first.** Every overlay reproducible inside the Canvas, exactly, before anything else is
optimised. Then any part of it can be pulled out and placed; later, Mimic arranges the parts around the
raider's actual EQ windows.

**The audit** (three read-only passes, every element a raider sees or uses, window chrome left out):

| Overlay | Elements | Exact as a parts.js piece | Data only (drawn differently, or no interaction) | Missing |
|---|---|---|---|---|
| DPS HUD | 21 | 0 | 7 | 14 |
| Tank | 22 | 0 | 13 | 9 |
| Threat meter | 12 | 0 | 4 | 8 |
| HUD (me) | 41 | 0 | 30 | 11 |
| Command Center | 24 | 0 | 13 | 11 |
| Target Info | 49 | 0 | 37 | 12 |
| Extended Target | 30 | 0 | 8 | 22 |
| Buff queue | 25 | 0 | 10 | 15 |
| CH chain | 27 | 0 | 8 | 19 |
| /who | 21 | 0 | 9 | 12 |
| Charm | 24 | 1 | 10 | 13 |
| Pets | 16 | 1 | 8 | 7 |
| Melody | 31 | 0 | 10 | 21 |
| Tick | 15 | 1 | 6 | 8 |
| PoP raid | 20 | 0 | 0 | 20 |
| **Total** | **378** | **3** | **183** | **192** |
| *Trigger overlay, loaded from its own page* | *19* | *18* | *0* | *1* |

The parts.js pieces (§103) redraw one value their own way, with no tooltips, no clicks beyond copy and
open, no per-row actions (dismiss, cure, rez), no speech, none of the page's own state (tabs, filters,
collapsed sections), different colour steps and number formats. The one overlay that was already exact on
the Canvas was the one loaded as its own page.

**Two ways to make every overlay exact:**
- **A. Cut each piece from the overlay's own page (shipped on alpha).** The page runs once per piece, with
  every other part made invisible and the panel cropped to its part. Same code, same look, same buttons, so
  exact by construction. Build low per overlay (a list of its parts; a mark only where a part has no class);
  maintenance low (one code path, and an overlay change reaches its pieces); runtime heavier (each piece is
  a page with its own poll); change low.
- **B. Rebuild every overlay from parts.js** (the 3.0 plan's end state, §102). Build very high (about 380
  elements with their interactions and speech); maintenance lowest in the long run (one engine); runtime
  lightest; change medium (every overlay hangs off the engine).
- **Taken: A now**, then B for single pieces only where the runtime cost is measured and matters. The two
  sit together in the chooser: parts exactly as drawn, and parts.js values drawn other ways.

**What shipped (alpha `a29075d9`; Target Info's marks on beta `5eae2d53`):**
- A Canvas piece kind cut from a page (`apps/mimic/sections.js`, `canvas.html` kind `sect`). It follows its
  part (grows, shrinks, steps aside with no target), keeps the card it sat on behind it, and A−/A+ and a page
  width size it.
- **✂ Take it apart** on a whole overlay: one piece per part showing, each where it was, moving together
  until one is Alt-dragged out. The chooser's **✂ Overlay parts** tab lists every part.
- One voice per overlay: copies of a page that speaks (Charm, CH chain) stay silent but one.
- **Target Info first:** 19 parts. Loot, Spells and F/Q/V pin their own tab; the other copies share the tab
  picked on the title-bar part.
- Checked in Chromium against a fake agent: the whole overlay and its parts side by side are identical.
- Limits:
  - an effect on the whole window (Charm's red flash) belongs to the whole page, not to a part;
  - the Command Center is served by the agent from another origin, so it cannot be cut until the Canvas
    loads the local `command.html`;
  - each piece is a page; measure on a raid night with the tray's Resource use.

**Next, in order:** section maps for the other 14: DPS HUD, Extended Target, Buff queue, Tank, Charm,
Command Center, CH chain, HUD, Tick, Pets, Melody, /who, Threat meter, PoP raid. Page state the parts must
share (the DPS/Tank/History tab, the buff class picker, the /who filters) follows Target Info's
sessionStorage pattern.

**Recorded for after parity: Target Info that keeps its context** (the guild lead, same message):
- *"as soon as you stop targeting that you lose the context"*: a history of recent targets with what they
  showed, and per-NPC quest steps you can tick off (*"a way to mark off or log the things that you
  specifically already did for that quest line with that NPC"*).
- Loot in context, without leaving the screen: hover an item for its stats; can this character use it
  (class, race, slot); could someone with you use it; vendor price; is it a tradeskill part
  (`eqemu_tradeskill_recipe_entries`), a quest item (`eqemu_quest_scripts`), a spell component, rare,
  worth a bag slot. Today the loot payload carries id, name, chance, raw chance, lore, the guild's win
  count, how many NPCs drop it and whether only this one does; items link nowhere and nothing checks
  can-use. Spell components are not mirrored (`eqemu_spells` has no component columns): a sync gap.
- Auto-arrange: read where the raider's windows are and place the parts to take *"just the right amount of
  screen real estate while getting out of their way"*.

**Found on the way:** Target Info's corpse "last fight" scoreboard read a key `/api/state` does not have,
so it never showed (fixed, beta `5eae2d53`). The threat meter's gold "your row" never lights for the same
kind of reason (queued as its own task).

## §126 — A targeted player's timers on Target Info; FB-46, FB-47, FB-48 (2026-10-02, bot 3.1.185 · web 1.8.71 · agent 3.7.66 beta `a100da84` · alpha `9e33af91`)
*2026-10-02 · DECISIONS-2026-09-21.md · Player ability timers on Target Info*

The guild lead: *"When we have a known timer, for someone's disciplines or mend or area taunt, we should
display those on target info. When we're targeting them"*, and *"check the latest feedback too"*.

**What can be known, and from where.** Checked against the server source (EQMacEmu `zone/aa.cpp`,
`special_attacks.cpp`, `client_packet.cpp`) and `eqemu_spells`:
- **Disciplines:** everyone near the player sees the disc spell's `cast_on_other` text ("Brackwyn assumes an
  aggressive fighting style", "…'s fists begin to blur"). All 35 are unique in the catalog, so a seen line
  names the disc exactly. The reuse is estimated from their /who level (or the longest, at the unlock level,
  when the level is unknown).
- **Mend, Lay on Hands, Harm Touch:** the messages go to the user only. A bystander sees nothing.
- **AAs (Area Taunt):** `ActivateAA` starts the timer silently, and Area Taunt makes the mobs say nothing.
  The only line is the refusal, when pressed before ready: "You can use the ability %s again in %u
  hour(s) %u minute(s) %u seconds." It is exact. Reuse times sit in `aa_actions`, which we do not mirror.
So the player's **own Mimic** is the one source for all of them, and a seen disc covers players without it.

**Built:**
- Agent: your own timers of a minute or longer (disc, Mend, LoH, HT, AAs) ride live-state as `cooldowns`
  with absolute ready times (`_liveCooldownsFor`). A timer starting is a change-signature term; the
  countdown is not, so this adds one upload per timer started, not a stream.
- Bot: `character_live_state.cooldowns` (migration applied), sanitised on the way in and returned by
  `character-live-state`, the route Target Info already calls for a player target.
- Target Info: a row under the health bar (`target_timers`): ✓ ready, else time left, `~` when estimated;
  the tooltip says where it came from (your own character, their Mimic, or a disc you saw).
- AAs: the refusal line is read for any AA. `/pipe at` (or `/pipe area taunt`, `/pipe aa <name>`) on the
  hotkey marks the press, as `/pipe fd` does for Feign Death; the first refusal after a press teaches the
  reuse, and later presses count down from it.
- Alpha: "Their timers (a player)" is a Target Info part on the Canvas.

**Not done:** Feign Death, Taunt and Kick are under a minute and are not uploaded (back before anyone could
act). A player without Mimic shows only a disc you saw. Extended Target rows do not show these yet (asked
in the open table).

**The latest feedback (FB-46 to FB-48), all on the beta, `Fixes` lines in `a100da84`:**
- **FB-46** (Zeal update notice should link to the updater): the desktop notice opens Settings scrolled to
  Zeal (`openSettings('zeal')`, `settings.html#zeal`), and is now held so its click is not lost to garbage
  collection; the dashboard's notice has an "Open Settings → Zeal" button.
- **FB-47** (Send feedback refreshes and loses the text): Recent Parses sat inside `#dash`, so each kill
  rewrote `#dash` and rebuilt the feedback card empty. It has its own card now, and the card keeps the
  words, the bug/idea choice and the pictures if it is ever rebuilt.
- **FB-48** (an overlay's scale is back to normal after close and reopen, at the larger size): the overlay's
  own size slider saved under the bounds-key name (`mobInfo`, `extTarget`, `chChain`, `popRaid`,
  `panelBounds_<x>`) while every reader used the overlay name (`mobinfo`, …). Fixed for the slider and for
  the opacity in Setup THIS (same mismatch); sizes already saved under the old name still apply.

**Also from the screenshot:** the alpha's Target pieces read "slowed null%" and "0 / 0 HP" because the
pieces' number helper turned a missing value into 0. Fixed (alpha `9e33af91`).

**Feedback housekeeping:** FB-45 (the threat meter and a resisted Concussion) was closed by the loot-call
commit's `Fixes FB-45`, a numbering slip: that commit answered a different report. The threat question
itself is answered by §117 (a resisted spell still applies its hate on the server, so the meter is right
to drop). FB-43 (a "RIP" callout for an NPC killed by a pet) and FB-44 (more vertical bars, text on any
side) are still open.

## §127 — HUD batch, auction timers, the main assist, XP events, back-to-back fights (2026-10-02, bot 3.1.186 + 3.1.187 · web 1.8.72 + 1.8.73 · agent 3.7.67 beta `d0a54a4d`)
*2026-10-02 · DECISIONS-2026-09-21.md · HUD batch, auction timers, main assist*

One message from the guild lead with a DPS meter screenshot, then two more mid-work. Each ask, quoted, and
where it landed:

- **"what area in planes of power have a lot of mobs that we could aoe farm? plane of innovation?"** —
  answered from the spawn tables: yes, the Plane of Innovation's junkyard (many low-HP clockwork mobs close
  together); the Plane of Disease's pusling rooms second. The higher PoP zones are packed too, but with
  level 62–66 mobs of 25–38k HP, which is not AoE work.
- **"Enrage timer and TTS should go off at 10%, not 8% … when it ends, it should no longer be red
  underneath the name."** The HUD's red zone covers the last 10%; a spoken "Enrage soon" plays once per mob
  as your target crosses 10% (only for a mob that can enrage — the mob-info flag or the boss list), re-armed
  for a fresh mob of the same name. "no longer enraged" clears the red; the Tank overlay and Command Center
  drop the box; a death clears it all. The Tank overlay's threshold moved to 10% too.
- **"We need to rename DPS/Tank Meter."** Done everywhere the name shows (tray, Settings, setup screens,
  dashboard, the window's process name, the site, /parsehelp).
- **"the Thorns amount should show as wrapped in a thorny green area if it's druid DS or glowing lava if
  mage ds."** The Thorns amount is the HUD's damage-shield button (the DPS/Tank Meter has no DS figure). It
  is wrapped in a ring of green thorns for a druid/ranger shield and a glowing lava halo for a magician's,
  read from the shield you wear (else the last shield hit); the shield's numbers take the same colour.
  Static on purpose — a glow that pulses would pull the eye mid-fight. One design, not options: the ask
  named the look.
- **"when there's a rampage, it can be listed next to the main tank on the side as an arc … characters
  that are approaching 20% or less HP on the left side of the top."** The rampage target is a thin arc to the
  right of its target's arc; raiders at 25% or under ("approaching 20%") stack as arcs top left, lowest
  first, three at most, from the Zeal raid window and your group's bars — never you, never the dead, never
  the one already shown. Both are ⚙ parts ("Raid").
- **"there should be clicky counters for each item you have."** The HUD lists your clickies from your last
  `/output inventory` with charges left; each "Your X begins to glow" after the export spends one. ∞ for an
  item that never runs out. The catalog's `maxcharges` (column added and applied; the weekly sync fills it,
  and the bot now serves it) is what tells a 1-charge item from an unlimited one; until it lands, a 1 shows
  with no number. Nothing about the inventory leaves the machine for this. **Follow-up the same morning**
  (the guild lead: "quarmy has the charges per item I believe"): agent 3.7.68 (beta `a9934e62`) reads the
  Quarmy export too — same Count column — and the newer of the two exports wins (`_quarmyLocalItems`).
- **"add in loot auction timers on the control center as well as in the timers window for each individual
  one … as people bid when it's low time left, it does extend it further out."** The bot's auction panel had
  never carried an end time (it read `EndTime`; OpenDKP calls it `EndTimestamp`) — fixed in 3.1.186. The
  agent polls it (20 s, 10 s while one is open) and keeps one timer per auction whose end is re-read each
  poll, marked "extended" once a bid moved it; the Command Center has an Auctions section. Deliberately
  silent: four auctions closing together must not be four spoken warnings.
- **"when someone is declared as main assist in raid chat, their target should be at the top of the extended
  target list. And it is typically the person that has more targets than anyone's."** Bot 3.1.186 reads the
  declaration (`utils/mainAssist.js`) and pins the MA's target first; the overlay marks the row "MA" and names
  the MA in its header. With no MA declared, the most-targeted mob stays on top.
- **"observe group composition and xp totals for groups that are together during the day …" · "Also track
  when we have an XP potion on."** FB-37 option B: each experience line becomes one `xp_events` row (bars
  before and after, level, zone, loc, group, the mob just killed, Maelin's Magical Concoction up or not).
  `xp_events` had not reached production — the GitHub integration does not apply migration files pushed
  straight to `main` (the history holds only MCP-applied versions) — so it was applied by hand, in five
  steps (`xp_events`, two indexes, the read policy, the comment), because the MCP times out whenever
  `drop policy if exists` or `enable row level security` share a call with other statements. The committed
  file is the same DDL. The board that answers the question needs a week of rows first.
- **"This fight was backtoback with the same name. Kept the damage History should be much longer and
  specific if it's local or synced."** Cause, found by reading the code: a fight closes on the slain line,
  which is range-limited, and nearby casts kept the 120 s idle from ever firing, so the second
  "A brann geistlig" joined the first (479 s). Your own target window now closes the fight when its mob
  dies — its name turning into its corpse, or its bar hitting 0 under the same name — 1.5 s later, so the
  killing blow lands first. History: 30 fights (was 6), kept across a restart, one entry per pull (the dedup
  window was 60 s, which also swallowed a real second pull), each marked **local** (never left this
  machine), **sent** (uploaded, guild numbers pending) or **synced** (guild numbers in). The guild numbers
  are now asked for by the fight's start (bot 3.1.187), not just the mob's name.

**Defaults picked, for the guild lead to confirm (open table):** XP events kept 30 days (the bars and the
mob, not a log); raid XP stored with its kind but kept out of the group-composition answer; the rows are
readable by signed-in members only, like every guild table. Clicky counters show no number until the
weekly sync fills `maxcharges`.

**Not done:** the XP board (needs data); a "RIP"-style split for a mob you did not have targeted (the slain
line still covers it when in range); clicky charges for items whose inventory export is older than the
glows we saw (counts start from the export).

## §133 — Buff queue headers take the click; an update no longer opens over the game (2026-10-02, beta `16bf4795` + `0bd27df1`)
*2026-10-02 · DECISIONS-2026-09-21.md · Buff queue headers clickable, update popup*

- **Buff queue (FB-49).** The guild lead: *"i do not see my mouse over the buff queue and can't click
  it"*, and FB-49 *"Buff queue is not clickable for opening these sections"*.
  - Sections start collapsed, so a header is the first thing clicked. A header is a `<div>`, and the
    preload's hover handshake arms the window only over `button, a, input, select, textarea,
    [role=button], [data-wp-interact]`. On a locked overlay the click went to EQ.
  - Why the cursor vanishes: the game draws its own cursor and blanks the Windows one over its window
    (§13). Over a click-through overlay the game's cursor is drawn UNDER the overlay. The Windows
    pointer shows only where the overlay takes the mouse.
  - Fix: the header carries `data-wp-interact`. The rest of the panel stays click-through, as every
    overlay's body does. Rule added to the CLAUDE.md parity checklist.
- **Crash on update (FB-50).** A member, stable 2.7.6: *"crash game when starting it up while already
  have game running"*. The guild lead: *"i believe they went to update and it crashed"*.
  - Evidence: the old build's last upload was at 01:57:35 UTC. The game log (attached to the report)
    stops mid-raid at 01:57:44. The same characters upload from the new version afterwards. No crash
    dump was uploaded.
  - Cause: only the unattended install-on-EQ-close path set `pendingSilentRelaunch`. A clicked "Restart
    to install update" relaunched with the main window shown and focused. That was deliberate (*"they
    asked for it and expect the window back"*), but a player who clicks it and goes back to the raid
    has the window land over the game. Taking focus from a fullscreen DirectX 8 game is the classic
    way to crash it. Most likely, not proven.
  - Fix, in the NEW build because the old build ran the update and sets nothing:
    - `createMainWindow` records `lastRunVersion`. A changed version, or an existing config without
      the mark, is the first run after an update.
    - On that run the window starts hidden. `_checkEqRunning` decides: EverQuest closed → the window
      shows; EverQuest open → tray plus a silent notification.
    - A brand-new install, autostart and the unattended path are unchanged.
    - This protects the update that delivers it: 2.7.6 → the next stable starts quietly.
  - Ruled out by a read of the startup path: nothing writes Zeal, DLL or UI files without a guard,
    nothing sends input or messages to the game window, and nothing kills it. Not changed, possibly
    related: the screen-setup prompt is a modal dialog with no parent, and a fullscreen game changing
    the display mode can raise it over the game.
  - `test/mimic-update-relaunch.test.js` runs both new blocks against fakes.
- **A test with a fixed date.** `test/suggested-triggers-more.test.js` (§129) wrote its log lines with a
  fixed "Fri Oct 02 21:10:01" stamp, and `{mytarget}` trusts a "You begin casting" line for 15 s only.
  It passed the day it was written and failed from the next morning. It now stamps lines with the
  current time.
- **Feral Avatar / Savagery timers, asked, not changed.** The guild lead: *"we need the timer on these
  feral avatar and savagery in the queue"* — the time left on targets.
  - Today a target already carrying the buff shows ⏳ on the Shaman or Beastlord's ⚡ queue.
    Auto-class follows the EQ window in front, so on a boxed monk the section is not there at all.
  - One real gap found: a raider not running Mimic is timed from the catalog, 65 ticks, but Zeal
    reported **102** ticks on a raider tonight (buff-duration AAs). So after about 6.5 minutes the
    queue moves them back to "needs it", with no timer, for the last ~3.5 minutes they still carry
    the buff.
  - Waiting on the guild lead to say which view and character showed no timer before changing either.

## §136 — Command Center: every raid's leader and player count (2026-10-03, agent 3.7.72 beta `1af59bd6`)
*2026-10-03 · DECISIONS-2026-09-21.md · Command Center shows every raid*

The guild lead: *"command center could use raid overview information (raid leaders and player counts)
for when we have multiple raids going."*

- With two or more raids, the Command Center's one-line note ("⚔ 2 raids at once · yours: …") becomes a
  **Raids card**: one row per raid with 👑 leader and player count, yours first (green, "yours"), then the
  biggest. The header reads "⚔ 2 raids · 43 players" and collapses like the other sections.
- **No new data or request.** The bot already names every raid on the buff-queue payload when there are
  two or more (§124); the overlay only showed yours. With one raid nothing renders, as before.
- Not added: zone or class mix per raid. The roster has no zone and no raid id; zone would need a join
  to live state that covers only Mimic users. Ask if wanted.
- A raid shows only if one of its members runs Mimic, and drops off two minutes after its last upload.

## §142 — Canvas presets are the real overlays; the HUD ring, and its builder, on the Canvas (2026-10-03, alpha `5adafea8` · agent 3.7.74 beta)
*2026-10-03 · DECISIONS-2026-09-21.md · Canvas presets match real overlays*

The guild lead: *"on alpha the canvas versions of existing overlays don't match the real overlays. they have
many of the elements but they are so spread out. the canvas elements themselves do not all have to be prim and
properly squared off with no overlay. the margins around the actual data is too large. the HUD overlay's circle
mode is unconstructive (or meant to be) but the canvas version is a bunch of small dials. we need the ability to
craft the circular HUD, but we also should have the default HUD circle view in canvas. when I look at an overlay
outside of the canvas or choose it as a preset within the canvas they should be extremely close to being
identical."*

- **Why they differed:** every preset in the chooser's Groups tab was a stack of re-made pieces (`parts.js`), not
  the overlay. The real pages were only under "Whole overlays".
- **Now a preset IS the overlay:** choosing one puts the real page on the Canvas (same code, so a change to an
  overlay reaches its preset). Each preset row keeps an "as pieces" chip for the old stack, and ✂ Take it apart
  still works. Fifteen overlays are mapped; group, timers and target tabs stay pieces (no overlay of their own).
- **Margins:** on the Canvas each overlay page drops its window padding and the gutters it kept for its own ✥/✕
  (the panel owns those), and an overlay panel has no plate, border or padding — the data sits at the edge. A
  preset is fitted to its content as data arrives (it only grows); the panel menu's "↕ Fit to content" is exact.
  The Command Center's half is on beta (agent 3.7.74) because the agent serves that page.
- **HUD ring:** "HUD (ring)" is the default HUD preset: the real ring, one piece. "HUD (box)" is the box. Both are
  the same page pinned to a look (`?wpstyle=hud|a`), and either can be on the Canvas once.
- **Craft the ring on the Canvas:** the panel menu's "⚙ Build the ring" opens the HUD's own builder; the panel
  widens beside the ring instead of the window resizing. It edits the same per-character ring as the HUD window.
- Not verified in Electron (only in tests and a headless load): how each trimmed page looks, the builder's widening
  and click-through on a locked Canvas. Two calls for the guild lead: should "＋ Overlay → HUD" also mean the ring
  (it does not yet), and fit-on-add only grows (an empty page would otherwise shrink to a sliver).

## §150 — Our own players' levels fill in on /who and Target Info (2026-10-04, bot 3.1.196 · agent 3.7.76 beta)
*2026-10-04 · DECISIONS-2026-09-21.md · Guildmate levels fill in on who*

The guild lead, with a /who overlay screenshot: *"We shouldn't have a gap in our own players levels."* Two
of ten guildmates, both /anon, showed an italic class and no level.

- **Why it was blank:** who-lookup's class came from the guild roster or an override, neither of which
  carries a level, and the history pass that does carry one ran only for names still missing a class.
- **History alone would have been wrong:** one of the two had last shown 59 in /who (September 28) and
  reported 64 from their own Mimic that day. Planes of Power raised the cap in between.
- **Bot 3.1.196 (live):** a new pass asks `latest_character_levels` (migration `20261004120000`, applied
  to production in the same session) for every name:
  - the newest level the character's own Mimic uploaded to `xp_events`;
  - the last non-anon /who level from `who_observations`.
  - The highest of those wins (levels only rise).
  - It reads `who_observations` on its own index, about 3 ms for 10 names, not through the
    `who_directory` view, which scans the whole table at about 1.4 s. That is why the history pass was
    left alone.
- **Agent 3.7.76 (beta):** `_zealLevelFor` takes the exact level from Zeal, no older than 2 minutes:
  - raid data always carries it;
  - group data only with `/pipeverbose` on.
  - It fills /anon rows on /who and outranks history.
  - On Target Info and the /who card it ranks after a live /who and before an even con, with no
    "(last seen)" tag.
  - Group mates' levels in the experience log fill the same way.
  - An /anon row that still carries a level from before the person went anon gives way to a newer one.
- **Verified on production:** all ten people in the screenshot now resolve: the two blanks to 60
  (history) and 64 (their own Mimic).
- **Privacy:** an /anon guildmate's level now reaches other guild Mimics, the same GUILD scope their
  class already had. Their own Mimic uploaded that level already (the group XP analysis reads it).

## §159 — The HUD's DS badge adds the shield from worn gear, only on top of a shield spell (2026-10-04, bot 3.1.202 · agent 3.7.80 beta)
*2026-10-04 · DECISIONS-2026-09-21.md · HUD damage shield counts worn gear*

The guild lead, with screenshots (badge "DS 10", shield hits "for 18 points", a Talisman of Vah Kerrath
with "Increase Damage Shield by 8"): *"Missing my additional DS from my neck slot. It only gets added when
you have other damage shield."*

- **The rule, confirmed upstream:** EQMacEmu `zone/attack.cpp` `Mob::DamageShield` returns early when the
  spell shield is 0 and adds the item part only inside that branch; item shields come from the worn-effect
  spell (`zone/bonuses.cpp`), never from the flat `eqemu_items.damageshield` column. So: spell shield +
  gear shield while a spell shield is up, nothing from gear otherwise. Quarm's own rules (a cap, say) are
  unknown; none is modelled.
- **Data:** view `item_worn_damage_shield` (migration `20261004223000`, applied and recorded) reads SPA 59
  from every slot of the worn-effect spell's `raw` (the Talisman's sits in slot 5, past the indexed
  columns). Two items today: Talisman of Vah Kerrath 8, Shroud of Eternity 5.
- **Bot:** `/api/agent/item-clickies` v2 adds `worn_ds: [{id, name, ds}]`, its own list so nothing that
  reads the clicky `entries` sees non-clickies. A failed read serves the catalog with an empty list.
- **Agent (beta):** `_wornItemDs(character)` sums `worn_ds` over worn slots of the newer of
  `/output inventory` and the Quarmy export; `_serializeMeState` adds it to `combat.ds.per_hit` only when
  `_knownDsPerHitFor` found a shield spell, and reports it as `combat.ds.from_items`. The last-hit fallback
  is unchanged (it already includes gear). A disk cache from before `worn_ds` drops its ETag so the next
  fetch is a full one.
- **Left alone:** `_knownDsPerHitFor` itself (the anonymous-hit settle already allows 30 points of unseen
  shield, `DS_UNLISTED_SLACK`), and the Tank window's shield sources for another tank (their gear is not
  known to this client).

## §163 — A lag meter in Mimic (2026-10-05)
*2026-10-05 · DECISIONS-2026-09-21.md · Always-on lag meter in Mimic*

- **Ask (the guild lead):** a member "is complaining about lag. can we help diagnose network lag?" Nothing on any
  surface measured a player's connection to the server (the buff queue's "lag?" button is about that overlay).
- **Offered:** A — check-now `pathping` button; B — always-on meter; C — lag inferred from the log. **Picked B**
  (*"Lets go with B"*).
- **Built (agent 3.7.82, beta `874ccbfd`):** two targets pinged once a second from the player's PC: the default
  gateway and the login server in `eqhost.txt` (read per install, never hard-coded; it is the route to the host,
  not an exact zone ping). The verdict splits home network from beyond it, which is the question a lag complaint
  needs answered. Samples are marked when a fight is live. Diagnostics card + one Tick overlay line.
- **eqhost.txt has two shapes (agent 3.7.83, `899b2ded`):** the guild lead's file is the Quarm/TAKP client's
  `[Login Servers]` block of quoted `"loginserver.takproject.net:6000"` entries, not the classic
  `[LoginServer]` + `Host=` the first parser expected, so 3.7.82 would have pinged only the router on a real
  install. The parser reads both; `[Registration Servers]` is ignored.
- **The login server is a fair proxy for the zone server (measured 2026-10-05):** Resource Monitor on the guild
  lead's PC showed eqgame.exe sending to 70.35.159.26 while in a zone; the login server
  (`loginserver.takproject.net`) resolves to 70.35.159.18, the same /24, so the route is the same until the
  last hop. No zone-server override needed for now. (Finding the address without admin rights is not possible
  for UDP: `netstat` shows no remote end, and Resource Monitor needs elevation.)
- **Local only, on by default, switchable off;** `PRIVACY.md` and `/privacy` say so (web 1.8.101).
- **Counted pings, not `ping -t`:** Mimic kills the agent with TerminateProcess on Windows, so an endless ping
  would outlive every restart. A counted run dies within 5 minutes at worst.
- **Not yet seen on Windows:** the parser was checked against hand-written English and localized output and a
  fake ping on Linux. Next: a beta tester (or the member who reported the lag) runs it and sends the Copy summary.

## §172 — Target Info's Faction tab says what a mob is on and who will help it (2026-10-06, bot 3.1.211 · Mimic beta)
*2026-10-06 · DECISIONS-2026-09-21.md · Faction tab shows faction and helpers*

The guild lead, on "an enforcer" in Plane of Justice: *"Faction should say the faction the mob is on and link to the
faction page. In this case the mob is on the faction KOS. But interestingly enough a High Guardian of Justice
assisted the creature to attack me. Faction should also list who the creatures will assist."*

- **Why the Guardian helped:** the enforcer's npc_faction (79) has primary faction 5017, KOS. The High Guardian of
  Justice (201446) is on npc_faction 563, "Guardians of Justice", whose entries list KOS with npc_value 1, so it
  assists any KOS mob. A second High Guardian (201079, npc_faction 1407) does not.
- **The rule used** (EQEmu): an NPC helps another when the other's primary faction is in its npc_faction entries with
  npc_value > 0, or both share a primary and the helper's npc_faction has ignore_primary_assist = 0. Scoped to the
  same zone by npc id range, so "Assisted by" means *can* help, not *was close enough to*.
- **Order:** helpers through ANOTHER faction come first (Gaoler, Guardian, Sentry, High Guardian of Justice), then
  mobs sharing the faction; otherwise the enforcer's 52 fellow KOS mobs pushed the High Guardian off a list capped
  at 12. Checked on production data: the module and an independent SQL of the rule agree on all 57 helpers.
- **Link:** wolfpack.quest/db/faction/<id> (our faction page), opened like the PQDI chip.
- **Zone packs are versioned** (`_MOB_PACK_VERSION` 2): a pack of the old shape is served once and rebuilt lazily on
  the next ask, so PoP mobs pick the fields up without waiting out the 7-day pack life. A rebuild of every PoP pack
  is ~40k catalog reads, serialized one zone at a time.

## §173 — Reverse Slow, and mob abilities read in Quarm's own numbering (2026-10-06, FB-54, bot 3.1.212 · web 1.8.109)
*2026-10-06 · DECISIONS-2026-09-21.md · Reverse slow and mob abilities on Target Info*

A member (FB-54): *"Some mobs are reverse slowable. This needs to be picked up on the target overlay"* (Laef
Windfall, pqdi.cc/npc/209070). The guild lead: *"make sure that's something that's specifically called out."*

- **The mechanic** (EQMacEmu `zone/bonuses.cpp`, `SE_AttackSpeed`): on an NPC with special ability **50 ReverseSlow**,
  a normal slow (base < 100) gets +100 and lands as **haste** of the same size; it also overrides Unslowable
  (`zone/spells.cpp`). Only `SE_AttackSpeed` slows flip. Five NPCs: Auliffe Chaoswind, Laef Windfall, Hibdin Cyclone
  (Bastion of Thunder), Magmaton, Fennin Ro the Tyrant of Fire (Plane of Fire).
- **The numbering was wrong.** `utils/mobSpecials.js` followed an older EQEmu/ProjectEQ table; Project Quarm runs
  EQMacEmu (`common/emu_constants.h`, `namespace SpecialAbility`), which differs at 7, 8, 34 and 41-54, and PQDI's
  labels on real rows agree with EQMacEmu. False chips removed: 44 "Immune Ranged Attacks" (is Use Warrior Skills,
  192 rows), 46 "Immune Damage (NPC/Pet)" (is No Loitering, 1,312 rows), 7 "Quad Attack" (is Dual Wield). 31 = Pacify
  Immunity confirmed, and every label a consumer matches on is unchanged. No code above 54 occurs in our data.
- **Where it shows:** Target Info chips (bot, mob packs → version 3), `/db/npc/<id>` (the web copy `web/lib/npcDecode.ts`,
  held to the bot table by `test/mob-specials-web-parity.test.js`), and on Mimic beta a red chip, HUD badge and a
  "don't slow it" callout.
- **Not stored yet:** `slow_mitigation` (Laef Windfall has 50, halving real slows) is not in our mirror; adding it
  needs a column + `scripts/sync-from-eqmac.js` pick. The guild lead's call.

## §178 — Three picks: a bard's mana slot counts what mana buys, the AE chip is decided by the spell's data, a dragged overlay height is a floor (2026-10-07, the guild lead: "A for all 3")
*2026-10-07 · DECISIONS-2026-09-21.md · Bard mana slot, AE chip, overlay height*

- **FB-56 — the bard's HUD mana slot (pick A, "Swap").** The arc/bar still fills with mana (it is the fuel),
  but for a Bard the label reads counts instead of a percentage: `DIRGE n · FM n · CHARM n`. Dirges =
  floor(mana ÷ 800), shown when Denon's Desperate Dirge is on the bard's gems (if the pipe sends no gem labels,
  for any bard 60+); Fading Memories = floor(mana ÷ 900) for bards 60+ — the pipe cannot say who owns the AA,
  so it is ASSUMED from the level (the guild lead's call, recorded here so nobody re-derives it); Charm = the
  existing "charm left" number when a charm song is memorized. Nothing to count → "MANA nn%" as before. The ring
  label is fitted to its arc (it never was, and long labels already ran off it). Agent `/api/me` `bard` block.
- **FB-57 — the Melody AE chip (pick A, "Gate on target type").** The bot's spell catalog marks area spells
  (`ae: true` for targettype 2, 4, 8, 20, 24, 25, 40; catalog version 9), and the agent registers the AE landing
  counter only for songs that carry it. Single-target songs (Assonance and 28 others) lose the `⚔n/12` chip,
  including single-target DoT songs (the damage-only variant, B, was not picked). Until the bot change reaches
  `main` the agent behaves exactly as before (it only gates once a catalog with the flag is loaded), so the
  two halves can ship in either order; the fix shows once both are live. The bot commit deliberately carries no
  `Fixes` word, so the report is not marked Implemented before the agent half exists.
- **Overlay sizes (pick A, "Height floor").** A height the user drags an overlay to becomes its floor: content
  grows the window above it and never shrinks it below. Only a hand drag writes it (Electron `will-resize`;
  every programmatic resize — a fit, the right-click menu's borrowed room, a scale change — leaves it alone).
  Stored unscaled, per screen setup, beside the saved bounds; right-click ✥ → "Fit height to content" clears it.
  No floor = exactly the old fit. Answers a beta tester's "i want them tiny and they are goliath" and FB-16.
- **Where it landed.** Beta: agent 3.7.98 with the FB-56 HUD counts, the FB-57 gate, the floor in
  `apps/mimic/main.js` + `preload.js`. Main-bound branch: the catalog flag (`3ad2fe47`). Docs:
  `HOW-ITS-BUILT.md`, `STATUS.md`.

## §179 — Clicky counters: pick which, root · dispel · stun first, and a Recharged button, because a recharge names no item (2026-10-07, FB-65, agent + Mimic beta)
*2026-10-07 · DECISIONS-2026-09-21.md · Clicky counters pick, priority, recharge*

A member (Mimic 3.0.0-alpha.937): *"Should be able to pick which clicky charges you track, and the names need to be
easier to see. Root/Dispel/Stun are prioritized. When we recharge I don't believe it says anything in the chat, it
just says you give a certain amount to the vendor. First recharge is double the recharge rate of every other one
after."*

- **What the log showed.** The report's 771-line excerpt has six lines from the recharge and none that names an
  item or says "recharged" or "charges": `You give 38 platinum 1 gold 9 silver 0 copper to <vendor>.`, then five
  of `You give 19 platinum 0 gold 9 silver 5 copper to <vendor>.`, two to three seconds apart. It is the line any
  hand-in of coin to an NPC prints. The first amount is exactly twice each later one (38,190 copper against 19,095),
  which fits a price per charge restored with the first item two charges short, but the log cannot say, so nothing
  reads it.
- **The call: no guessing, a button.** Attributing a coin amount to an item would set wrong counters silently. Each
  charged clicky in the picker has **Recharged**: `POST /api/me/clicky-recharged` `{ character, item }` →
  `_noteClickyRecharged` puts that counter back to the item's full charges from that moment (clicks after it spend
  one; two copies are each full again). An inventory or Quarmy export written after it is newer and wins again. The
  mark is kept in `logsync.hud-timers.json` for 30 days, so a Mimic update does not undo it. Refused (404) for an
  item that is not carried or has no charge count.
- **Picker.** ⚙ → Items lists every clicky on you with its kind (Root / Dispel / Stun), charges left of full and the
  button. Tick up to **four** (stored per character, `hudParts.clickyPick`); with nothing ticked the HUD takes the
  first that fit. Four is what the bottom arc holds: it is 80° at the ring's inside, about 30 characters at the new
  default size, and the DS button already sits at its right end. A second row would take the clear middle.
- **Root, dispel, stun first** (`_clickyKind`). The spell catalog's `cc` already tags a harmful spell's SPA 99 and
  SPA 21; a buff that carries SPA 99 (a tree illusion) is not tagged and is not a root clicky. The catalog has no
  dispel (SPA 27), so the eight clicky spells that carry it are listed by id in the agent
  (`_CLICKY_DISPEL_SPELLS`, from `eqemu_spells` joined to `eqemu_items.clickeffect`, 2026-10-07). Adding a dispel
  kind to the bot's `_ccKinds` would remove that list, but `cc` also feeds the suggested triggers, so it is its own
  change on `main`.
- **Names.** Bright instead of grey, their own size slider (they rode the Resists one), a name shortened to the part
  that tells it apart ("Ring of Shadows" is "Shadows", not "Ring…"), and what does not fit is counted ("+3"). A
  text path draws nothing past its arc's end, so an overfull line used to lose its first and last items.
- **Older agent, newer HUD (and the reverse).** `clickies` is still the first eight; `clickies_all` rides along only
  past eight. An old HUD draws what it always did, in the new order.
- **No dashboard twin.** The HUD builder lives only in `me.html`, so the tray/dashboard parity rule adds nothing.
- **Open.** One line of four may be too few for someone with many clickies; a second row, or a bigger share of the
  ring, is a layout pick for the guild lead.

## §180 — Canvas group hotkeys: a group is a SAVED group, and an overlay's own key moves its Canvas panel too (2026-10-07, Mimic alpha `9e87325e`)
*2026-10-07 · DECISIONS-2026-09-21.md · Canvas group hotkeys*

The guild lead: *"we should be able to assign hotkeys to show or hide canvas groups as well"*, then *"if you're using
an overlay as whole it should let you use that overlay's same hide key combo"*.

- **"A group" is a saved group** (★ Groups → My groups), not an overlay set: a set is the whole screen, and loading
  one swaps the layout, hidden state included, so the two never overlap. The key is stored by the group's id
  (`cfg.canvasGroupHotkeys`), so a rename keeps it and deleting the group drops it.
- **Defaults this session picked; the guild lead can flip either in one line:**
  - a press while the Canvas is OFF turns it on and **shows** the group (a toggle could hide what you came to see);
  - a press during a hide-all changes the group's saved state but **does not lift** the hide-all, the same as an
    overlay hotkey.
- **An overlay's key** sets its "as is" Canvas panels (every look; not pieces taken apart, which belong to groups)
  and its own switch to one state. No new key, so no new clash to check. The dashboard's ON/OFF and the tray's
  overlay toggles are still the plain toggle.
- **Known gap.** A group already on someone's Canvas from before this build has no link to its saved group, so its key
  says "not on this screen's canvas" until it is saved or dropped again. Not backfilled: there is nothing to match
  the pieces by that would not be a guess.
- **Parity.** The tray lists the groups under the Canvas entry; the dashboard's Overlays tab gets the same list on beta
  (feature-detected, so beta Mimic shows nothing).

## §185 — The HUD's clickies get a second row, inside the first (2026-10-07, Mimic beta)
*2026-10-07 · DECISIONS-2026-09-21.md · HUD second clicky row*

The guild lead: *"add a second clicky row to the HUD"* (§179 had left one line of four as the open question).

- **Where:** the same 140°–220° bottom arc, one line (1.1 × the font size) INSIDE row 1. Outside is the resists line,
  six units away, with no room for a line between. Inside only the clear middle and the damage-shield button's corner
  are near; both rows clear the button by about 23 units.
- **Cost:** at full size row 2's letter tops reach about 3.5 units into the clear middle; squeezed to 70% they do not.
  The bottom tracking arrow's tail (shown only while tracking) now sits under row 2 as well as row 1.
- **Fill:** row 1 first, then row 2, in the same order (picks, else root · dispel · stun · worn · name); `+N` only for
  what fits on neither. With nothing picked, eight defaults show and may shrink to 70% to fit. One row (⚙ → Items →
  "Two clicky rows" off) is exactly the old line.
- **Picks:** up to 7 on two rows (computed: at the 70% floor a worst-case pick, a six-letter name plus a two-digit
  count, fits 4 on row 1 and 3 on the shorter row 2), 4 on one.
- **Open, the guild lead's pick:**
  - **A — 7 picks, 70% floor:** as shipped; nothing gets smaller than today's smallest.
  - **B — 8 picks, 65% floor:** one more clicky; the smallest text gets about 7% smaller.

## §196 — Target Info buff bars count down, and the time says how long and who cast it (2026-10-08, Mimic beta `2eb8796e` · bot 3.1.225 · agent beta)
*2026-10-08 · DECISIONS-2026-09-21.md · Target Info buff bars count down*

The guild lead, on a guildmate's card with every buff bar full green: *"This should record how long it was to
start and not just show all green. it should count down like everything else"*, then *"MOUSING OVER the time
left should show you how long it lasted and who cast it"*, then *"we should know it since we have the timer and
the person casting it when they start, the target, the target's group if they're using mimic"*.
- **Bars** (`mobinfo.html`, `_tbuffSeenTotal`): a live Zeal buff has time left but no length, so the overlay
  remembers the longest time it has seen per target + buff and draws against it; a refresh raises it, a buff
  that leaves the list is forgotten.
- **Hover on the time left:** "Lasts M:SS · M:SS gone · cast by <name>", or "caster unknown (only Mimic users'
  casts are named)". EverQuest's landing lines never name a caster and `buff_casts` has no caster column.
- **Caster** (bot): the casting relay now remembers the last caster per target + spell for 3 h (in memory,
  5000 cap; a restart reads as "unknown", never a wrong name), served as `last_casters` on
  `/api/agent/target-casts` under the same zone and spawn-id scope as live casts. A GROUP spell (targettype 3 /
  41) is recorded for every member of the caster's group from the live raid roster (`group_num`), off the reply
  path. A fizzled or interrupted cast is still recorded (only a failed cure says so).
- **Length** (agent): when a caster is attached and the buff has no length, the agent fills it from the spell
  catalog at the era-cap level, never below the time left, so the bar measures against the real duration.

## §203 — Target Info says when a mob does not equip (2026-10-08, bot 3.1.230 · web 1.8.124)
*2026-10-08 · DECISIONS-2026-09-21.md · Target Info flags mobs that don't equip*

**The ask** (the guild lead): *"We need to see if a mob does not equip or not in target info"*.
- **What it is:** Quarm special-ability code 8 ("Do Not Equip"; the table already had it as 'Disallow Equip', hidden).
  The mob never wields what it carries, so the gear on its model is not its loot. 1,847 of the 18,033 catalog rows have
  it (about 1 in 10; 8 of 201 raid targets), few enough that a chip still means something.
- **Where it landed:** `utils/mobSpecials.js` code 8 is now `show: true`, label **Does Not Equip**; the bot's mob-info
  already ships every shown label, so Mimic's Target Info (a neutral chip) and the Mob Info web decode (`web/lib/npcDecode.ts`,
  kept equal by `test/mob-specials-web-parity.test.js`) pick it up with no Mimic release. No consumer matched the old
  label. A mob without the flag simply has no chip: the absence is the "equips" answer, not a second chip.
- ⚠ Mimic caches mob info on the player's machine (6 h), so an already-seen mob shows the chip after the cache turns over.

## §222 — Every class's active abilities catalogued; a home for `/pipe` commands proposed (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Class abilities catalogued, pipe commands home*

**The ask** (the guild lead): the full active ability set for every class (trained skills, AAs, long-recast spells),
"like we have with monks", and a spot where a `/pipe` line triggers UI for actions with no success message (Pacify,
Harmony, Hide/Sneak for non-rogues).
- **Where it landed:** `docs/DESIGN-class-abilities.md` + `docs/data/class-abilities.json` (281 abilities, all 15
  classes). AA reuse comes from Quarm's own `aa_actions` table in the 2026-09-27 dump (77 AAs; it corrected seven
  research values, e.g. Mend Companion 36 min, Divine Resurrection 36 h, Mana Burn 8640 s).
- **Bugs it found in today's HUD** (fix with the build) — ⚠ the Taunt claim was WRONG and is withdrawn: the guild
  lead confirmed in game that a successful Taunt prints "You taunt <mob> to ignore others and attack you!", so the
  existing Taunt timer is right; `/pipe taunt` adds presses that do not land. The rest stand: Hand of Piety starts the Lay on Hands slot (same landing text); Necromancer / Shadow Knight Feign
  Death is a 15 s spell, not the monk skill; `/pipe` lines are only read while the HUD is open; AA timers must clear
  on "Your ability failed. Timer has been reset."; the monk FD 10 s vs the server's 8 s needs an in-game check.
- **Lull line closed:** "Your target looks unaffected." is the whole Pacify/Harmony/Lull family's failure (too high
  level or Immune Pacify; once per mob on an AE cast). Harmony has no success line at all.
- **Pipe-commands spot:** options A (pipe as a trigger source), B (a Pipe commands card on the Triggers tab, built on
  A — recommended), C (user words as HUD chips) put to the guild lead; open.
- **Also found:** `eqemu_spells` stops at id 4678, so Quarm's own spells above it (Mass Group Buff 5228 and others)
  are missing from the mirror — check the weekly import's filter.

## §223 — Command Center: quests by zone, tank cooldowns, mana tabs; Feign Death varies by AA, Mend is constant (2026-10-10)
*2026-10-10 · DECISIONS-2026-09-21.md · Command Center quests, cooldowns, mana tabs*

**The calls** (the guild lead):
- *"command center can start supporting quest details based on which zones we're in and who needs each step based on
  what the database knows. collapsed in a section then collapsed more.."* — a Command Center section, two collapse
  levels (section → quest → steps), driven by the zones the raid/group is in and the per-character progress the
  database already holds.
- *"feign death timer is variable and depends on AAs. mend is constant."* — FD reuse follows the monk's Rapid Feign
  rank (server: 8 s base, 7/6/3 s at ranks 1/2/3 per §222); Mend keeps one fixed timer.
- *"taunts done via pipe are good to watch for. area taunt timers are worth having on command center along with
  defensive."* — `/pipe taunt` is the taunt signal (the log line belongs to Area Taunt, §222); the Command Center
  shows each tank's Area Taunt and Defensive discipline timers.
- *"other mana users can be displayed as well at casters via tabs by type, healers int and hybrid."* — a mana panel
  with tabs: Healers (Cleric, Druid, Shaman), Casters/INT (Necromancer, Wizard, Magician, Enchanter), Hybrids.
- **Also (same day):** *"taunt shows a success message. successful or resisted casts add to hate"* — the §222 Taunt
  claim is withdrawn (the existing timer is right); the threat meter already credits resisted casts (flat
  `RESIST_HATE_DEFAULT` 120 + per-spell overrides).
- **Scoped (three agents, 2026-10-10):**
  - **Feign Death:** the Quarmy export carries the Rapid Feign rank (AA index 100); the agent parses it in
    `parseQuarmyExport` but `_quarmyLocalItems` drops it. Client lockout 10 / 9 / 7.5 / 5 s at rank 0–3. Of 8
    exported monks, 4 are not 3/3 — today's "59+ = 5 s" guess is wrong for them. No export → 10 s. Mend 289 s flat.
  - **Tank cooldowns:** every Mimic already uploads its own timers (`character_live_state.cooldowns`, incl.
    `aa:area_taunt` and the disc); only Target Info reads them. Smallest add: a `tank_cooldowns` array on the bot's
    `/api/agent/di-status` payload every Mimic already polls. Two gaps: `/pipe` is read only inside the HUD build,
    and timers under 60 s are never uploaded (so `/pipe taunt` never leaves the machine). Stale rows must show stale,
    not ready (`live_state` is sheddable).
  - **Mana:** the Zeal raid pipe has no mana for others; exact mana comes only from Mimic raiders' own uploads, plus
    the chat "N% mana" macros (`mana_reports`). `di-status` filters to Cleric/Druid/Shaman today; widen it for tabs.
  - **Quests:** the Command Center (`apps/mimic/command.html`, agent `/api/command-center`, collapse store
    `wp_cmd_collapsed`) gains a section fed by a new bot route `GET /api/agent/quest-needs?zone=&names=` returning
    quest → steps → `needed_by` with a source (flag / tick / who / loot). v1 covers the 29 PoP flag steps
    (`pop_flags`, 23.8k rows); item/loot proofs need the web rules (`popGuideAuto.ts`) ported to JS.
  - **Options put to the guild lead:** quests A zone ladder (current zone's quests) vs B who-first grid; tank strip
    A rides `di-status` vs B per-tank poll; mana A class tabs vs B stacked sections. Recommended: A, A, A.

## §240 — A corpse written with a backtick resolves to its NPC (2026-10-12)
*2026-10-12 · DECISIONS-2026-09-21.md · Backtick corpse names resolve to NPC*

- **The report** (the guild lead, screenshot): Target Info on "Laef Windfall\`s corpse" said "no published
  drop table", though the NPC has 11 drops. The guild lead suspected the new Zeal corpse code.
- **Cause:** every name key stripped "'s corpse" with a straight apostrophe only, so a backtick possessive
  became `laef_windfall_s_corpse` and matched nothing. Whichever client path writes the backtick, the keys
  must accept it.
- **Fix:** bot 3.1.247 (main `6654e1cd`, `_normMobName` / `_mobCaseKey`) and agent 3.7.132 (beta `18f247df`:
  the same two keys plus the "your target died" check) strip backtick, apostrophe and curly apostrophe, and
  a number after "corpse". Tests: `test/corpse-name-key-bot.test.js`, `test/corpse-name-key-agent.test.js`.

## §246 — A mouse pointer over every locked overlay (2026-10-12, Mimic beta `11a42051`)
*2026-10-12 · DECISIONS-2026-09-21.md · Mouse pointer over locked overlays*

- **Ask** (the guild lead): *"we should show a mouse when we mouseover the map window, otherwise we lose it behind in
  the EQ window. the same should apply with any of the overlays."*
- **Why:** a locked overlay is click-through, so the mouse belongs to EQ, which hides the Windows pointer and draws its
  own inside the game scene, underneath every overlay window.
- **Shipped** (shared preload, so every overlay at once): a stand-in arrow at the mouse position over SOLID parts of a
  locked overlay (canvas, image, a background ≥35% opaque, or the solid-backdrop setting). Not over controls (Windows
  shows its own pointer there), not on unlocked overlays, not over see-through parts (EQ's pointer shows through).
- **Known edge:** with EQ in the background (alt-tabbed) the Windows pointer is visible too, so the stand-in can show
  beside it over a solid overlay. Untested in game.
- **First in-game report, same day** (*"mouse drawover in our overlays will sometimes leave an artifact"*, a
  screenshot of a white arrow left on the HUD ring next to EQ's own pointer). Two causes, both fixed (`f145e562`):
  leaving a click-through window sends no mouseout, so the arrow stayed; once the mousemoves stop the preload now asks
  main whether the mouse is still inside the window (`overlay-cursor-inside`) and hides it if not. And a bare
  `<canvas>` counted as solid, while the HUD ring is a window-sized see-through canvas: only a background colour
  counts now.

## §254 — Mouse pointer over overlays: a switch, never on the HUD, Canvas panels only (2026-10-13, agent 3.7.141 beta `2c22540d`)
*2026-10-13 · DECISIONS-2026-09-21.md · Mouse pointer over overlays becomes a switch*

- **The ask** (the guild lead): *"make mouse over configurable, and remove it from the HUD. for Canvas it should only
  show over the elements."*
- **Shipped:** one switch for every overlay, `cfg.standInPointer` (default on), in the tray ("Show a mouse pointer over
  overlays") and the dashboard's Overlays tab → More… (tray ↔ dashboard parity). Main pushes it live to every overlay
  and to each frame inside it (the Canvas's panels are iframes); overlays pull it at load. Never drawn on the HUD
  (`me.html`). On the Canvas only over a panel, never the open screen between panels, backdrop on or off
  (`_wpOverSolid` in `apps/mimic/preload.js`).
- **Not done:** a per-overlay switch. Say if one overlay besides the HUD should never show it.

## §258 — ◢ Resize corner on every overlay window, no setup needed (2026-10-13, Mimic beta `dbb007b2`)
*2026-10-13 · DECISIONS-2026-09-21.md · Resize corner grip on every overlay*

- **The ask** (the guild lead): *"Map needs a resize drag corner at the bottom right, as do all of the windows, to
  resize without having to setup."*
- **Shipped:** the shared preload adds a small grip to the bottom-right of every overlay window that has the ✥ chrome,
  locked or not (`data-wp-interact`, so a click-through window arms under it). Main's `_startWindowResize` reuses the
  ✥ drag session: the top-left stays put, the size follows the cursor inside its screen, `_stopWindowDrag` saves the
  bounds, and each step goes through `_noteUserResize`, so a fit-height overlay keeps the dragged height as its floor.
- **Left out on purpose:** docked panes (the dock is one window), the Canvas (screen-sized; its panels resize
  themselves) and the HUD ring (it sizes its own window around the screen centre).

## §340 — Chat overlay: Loot, Random and Other channels (2026-10-15, agent 3.7.181 beta)
*2026-10-15 · DECISIONS-2026-09-21.md · Chat overlay Loot, Random, Other channels*

- **The ask** (the guild lead): *"CHAT OVERLAY NEEDS THE REST OF THE CHANNELS AVAILABLE, LOOT, MONEY, OTHER, ETC"*.
- **Built:** three opt-in groups (off until switched on in the ⚙ drawer, like Melee/Spells/Skills): **Loot** (your own
  `--You have looted …--`), **Random** (both lines of a /random), **Other** (ChannelMap 22: any game line no other
  group claims — XP, faction, death, enrage, snare, zone messages). Other runs last, re-asks every classifier whose
  switch is off, and never takes chat of any channel, Zeal bracket lines, /tag broadcasts or combat; the
  tells/group/officer/custom gates are unchanged, and none of it reaches an upload path (local `/api/chat` only).
- **Not built:** Money — no real coin line ("You receive … from the corpse", "You split …") exists in the repo, so none
  was invented; coin lines fall into Other until the guild lead pastes one. Others' loot does not reach your log.
  Pet say, emotes, /who and Zeal spam have no sourced shapes or are deliberately dropped.

## §341 — Target Info: the snare-immune chip says so in the game's words (2026-10-15, Mimic beta `59e13ed1`)
*2026-10-15 · DECISIONS-2026-09-21.md · Snare-immune chip uses game's wording*

- **The report** (the guild lead, with a screenshot of Target Info on a PoP lieutenant): *"This mob is immune to
  runspeed changes but it doesn't say it anywhere until you cast on him."* The flag WAS on screen — the chip read
  "Unsnareable" (special ability 16) — but that word does not read as the game's "Your target is immune to changes in
  its run speed".
- **Built:** a display-only map in `apps/mimic/mobinfo.html` (`SPEC_SHOW` / `specChip`): the chip reads "Snare / run
  speed immune" with the game's message as its tooltip, on both chip rows. The catalog label stays "Unsnareable"
  because the bot (`utils/mobSpecials.js`), web (`web/lib/npcDecode.ts`) and the regression tests key on it. Other
  "Un…" labels are unchanged; add a `SPEC_SHOW` entry if another one reads wrong.

## §342 — The guild's /gu and /rs in the Chat overlay while you're out of game (2026-10-15, bot 3.1.277 + agent 3.7.182)
*2026-10-15 · DECISIONS-2026-09-21.md · Guild and raid chat in overlay when out of game*

- **The ask** (the guild lead): *"can we offer raid and guild chat in the overlay when out of the game via other
  mimics? we're already capturing this"*; picked **A** (live relay from the bot's memory, not a database feed — reads
  bill egress); **X** (only while not in game) was the session's default, not a pick. Then: *"it should note when
  nobody is in game as well"* / *"with mimic running"*.
- **Bot (main, 3.1.277):** `utils/guildChatFeed.js` keeps the last 300 guild + raid lines (allow-list of exactly those
  two channels; cross-uploader dedupe), fed from the chat ingest after its dedup, preloaded from the last 60 min of
  `chat_messages` at boot. `GET /api/agent/guild-chat?since=&boot=` is bearer-gated, no-store, sheddable
  (`flag_shed_guild_chat`), budgeted 120/min. `ingame` = distinct PLAYERS whose reporter heartbeat is under 60 s old,
  not camping, with a log line under 3 min (cached 15 s; `null` only in the first 90 s after a restart). An AFK player
  with no log line for 3 minutes reads as out.
- **Agent + Mimic (beta, 3.7.182):** polls every 5 s only while the Chat overlay is open, its "Guild and raid chat from
  the guild while I'm out of game" switch is on (default on), and the game is NOT running (Zeal state < 60 s or a log
  line < 90 s means in game). Relayed lines use the normal guild/raid colours with a dim "via guild" mark; the title
  shows "away · guild feed · N in game with Mimic"; 0 shows "Nobody is in game with Mimic running right now — no guild
  or raid chat to relay." Display only: never uploaded, never fed to triggers or history. Logging in stops the poll and
  clears the relayed lines.
- **Privacy:** the same lines the bot already posts to Discord; officer, tells, group and custom channels are never
  uploaded and never enter the ring.
- **Same day, "the chat should show guild chat when you aren't logged in on a character, you can be at character select
  or earlier in the login process" (agent 3.7.184 beta):** "in game" now means logged in on a character. A camp
  announcement ("prepare your camp") ends it at once (cleared by "abandon your preparations to camp", "Welcome to
  EverQuest!" or any line 60 s later); a Zeal entry counts only when it has a zone or a position and does not belong to
  a camped character; a log line counts only for a log that has not camped. What Zeal sends at character select is not
  known from the repo.

## §345 — Chat overlay: a tell search shows the whole conversation, and names your character (2026-10-15, agent 3.7.185, beta)
*2026-10-15 · DECISIONS-2026-09-21.md · Chat tell search shows whole conversation*

- **The ask** (the guild lead): *"when i search for someone in tells i should see conversation with them and know which
  character i sent it from"*. The search matched the speaker, and your own tell's speaker is "You", so a name search
  showed only their half.
- **Built** (`apps/mimic/chat.html`): a tell you sent matches the name it went to; every tell row names your character
  both ways ("Aldenmar → Corvale" sent, "Corvale → Aldenmar" received), and the copied line reads the same. A line with
  no known character still says "You". Overlay-only: the agent already stamped each line with its character.

## §346 — Chat overlay Loot channel: your loot AND others' (2026-10-15, agent 3.7.186, beta)
*2026-10-15 · DECISIONS-2026-09-21.md · Chat loot channel includes others' loot*

- **The ask** (the guild lead, after the raid): *"Loot filter should be my loot AND others"*.
- **The line, from the server code Quarm runs** (EQMacEmu `zone/string_ids.h` 466, beside 467 for your own):
  `--<Name> has looted a <item>--`, sent to the looter's group, or to the whole raid when the looter has no group,
  never for a player corpse. Not yet seen in one of our logs, so the match takes it with or without the period.
- **Built:** `classifyLootLine` takes both shapes (dashes, one-word name, start of line); others' rows carry
  `self: false` and no longer fall into Other. The #91 loot upload still reads only "You have looted".

## §350 — Silence card on Target Info; two database changes the database never ran (2026-10-16, bot 3.1.286, agent 3.7.188 beta)
*2026-10-16 · DECISIONS-2026-09-21.md · Silence card on Target Info*

- **Silences** (the guild lead: *"ADD IN A CARD for SILENCES or SILENCES(AOE) for mobs that silence"*). The bot reads
  the mob's castable spells; a detrimental spell with effect 96 adds "Silences", or "Silences (AoE)" when its target
  type hits an area. Every NPC silence in the catalog is AE today (6 point-blank, 3 targeted, on 24 spell lists). It
  rides `specials`, so every Mimic shows it now; beta colours it as a warning with a tooltip.
  `mobSpecials.silenceLabel`, `test/mob-silence-chip.test.js`.
- **"Save for the guild" on name pronunciations always failed**: `name_pronunciations` (migration
  `20261014120000`, bot 3.1.261) was never created in the database. The unused-index drop
  (`20261015080000`, §334) never ran either; three other 10/15 migrations are live but unrecorded. So "the GitHub
  integration applies migrations on merge" is NOT holding. The guild lead said go ahead on both; every write from
  the session's database tool timed out before reaching the database (no lock, nothing running), so the guild lead ran
  both in the SQL editor the same day (verified after).

## §357 — The Chat overlay's feed is cached encrypted on the machine, wiped on logout-grace and before revoke (2026-10-18)
*2026-10-18 · DECISIONS-2026-09-21.md · Chat overlay feed cached encrypted locally*

The guild lead, 2026-10-17: *"cache the filled in chat overlay data encrypted locally and invalidate it on logout if a
fresh session isn't established within a reasonable timeframe, and wipe before revoking access"*. Shipped on **beta**
(agent 3.8.0 / Mimic 2.10.0, the Security Metapod and Live Optics line).
- **What is kept:** the Chat overlay's own rings (chat/melee/spell/skill/loot/random/other + the relayed guild feed)
  and the guild-feed cursor, so a restart shows the feed at once and asks the bot only for what is new. Only what the
  overlay could show now (its Officer/Custom/Group/Tells/Away switches), newest 200 per ring, nothing older than 24 h,
  at most 256 KB of JSON. File `logsync.chat-cache.bin` next to the agent, atomic write coalesced to one per 8 s.
- **Encryption:** AES-256-GCM, fresh 96-bit IV per write. **Mimic makes a random 32-byte key once**, keeps it under
  the OS keychain (`safeStorage` — DPAPI / Keychain) and hands it to the agent in `WOLFPACK_CHAT_CACHE_KEY`, with
  `WOLFPACK_CHAT_CACHE_ID` = the session's Discord id. **No keychain / standalone agent / signed out = no key = nothing
  written** (there is deliberately no plaintext mode). A wrong key, a torn or tampered file, or a different identity
  inside it: the file is deleted and the feed starts empty.
- **Mimic owns when it may live** (it holds the key and the session): on **logout** the cache stays sealed and unread
  for a 24 h grace; the same id signing back in finds it, a different id wipes it, no session by the end deletes it.
  24 h because the cache only holds 24 h of lines anyway. A **different Discord identity** signing in wipes it before
  the new token is taken — one person's chat is never carried to another.
- **Revoke:** a *definite* 401 (revoked session, `/token revoke`, member lockout) on the heartbeat, an upload, or the
  guild-chat poll → the agent wipes the file + the live rings and refuses all writes for the process, prints
  `[chat-cache] revoked`, and **Mimic drops the key from its config** so any leftover file is unreadable. A 5xx/429/dead
  network is NOT a revoke (the bot answers a store blip with 503). Uninstall wipes it too.
- **Kill switch / version floor is NOT a revoke** — it stands the agent down but overlays keep working on local data
  (the control plane's own rule, §354/#74), so the on-screen chat must not go blank. That path calls
  `chatCacheWipeFileOnly`: the on-disk copy goes and writes are held, but the live rings and guild feed stay.
- Code: `packages/wolfpack-logsync/index.js` ("Chat cache": `chatCacheWipe` / `chatCacheWipeFileOnly` / `chatCacheRevoke`
  / `chatCacheOnSessionPush`), `apps/mimic/main.js` ("Chat cache": `_chatCacheDecide` / key box / `_chatCacheWipeAll`).
  Tests `test/chat-cache.test.js`.

## §368 — "Keepers of the (Overlay) Arts": Mimic 3.0's name and the Masterpiece program (2026-10-18)
*2026-10-18 · DECISIONS-2026-09-21.md · Mimic 3.0 name and shared-layout Masterpiece program*

The guild lead named the 3.0 line **"Keepers of the (Overlay) Arts — AKA: truly customizable canvas and gallery"**, with
**Masterpieces** (shared layouts) made by **Tastemakers**. (The pun: "Keepers of the Art" is an EverQuest casters'
faction, "the Art" meaning magic.) Roadmap entry added on main (web 1.9.3, beta-flagged). The program, in the guild
lead's words where it matters:
- **Masterpieces named for their makers.** Punny titles on a player's signature abilities — e.g. a bard's Boastful
  Bellow layout, a warrior's enrage plan, a cleric's Divine Aura setup, a monk's fists, an enchanter's mana tools — each
  carrying a layout, hotkeys/shortcuts and gear/clicky advice, "all built for our users around what their characters
  have access to … to emulate some of the greatest players on our server, and in our guild."
- ⚠ **Attribution stays out of the repo (it is public).** Titles and author credit are member-authored data in the
  DATABASE, published by the author themselves (opt-in, revocable, same consent model as Profiles). Never hardcode a
  member's name or a credited title in source, docs or fixtures-as-content.
- **Recruit the Tastemakers from real use.** Ask the platform's heaviest users (counted in PLAYERS, by breadth of
  streams + uploads over 30 days) to publish their full setup as the first Masterpieces. Every example the guild lead
  named was already in that top 20 (measured 2026-10-18). The request goes out when a one-click **Publish** exists —
  there is nothing to import into before then — and the wording is the guild lead's to approve before any DM is sent.
- **Convert existing overlays into the Canvas** to cut RAM (one window instead of many), in a format that scales onto
  any machine regardless of its UI files or resolution.
- **Sets per character per mode** — PvP, charming, raiding, guild group, pug, power leveling, leveling, "dad-camp lazy
  farming", and more; copy between characters; offer into the catalog with screenshots or rendered versions and a
  preview with live data.
- **Add without ruining modality** — a Masterpiece goes into a user's setup non-destructively (its own set, or merged
  with Undo), never over what they have.
- **Hotkey socials, voting and class A/B tests** — common socials refined by vote; members of a class who have the
  items/spells/abilities try an A/B and give feedback. Privacy first: socials can carry free text, so nothing leaves a
  machine unless the member shares that specific social.
- **The boundary:** overlays replace display, not targeting — clicking to target stays EQ's own window (or Zeal).
- **Status:** scoped the same day by four research passes; the synthesis, options and suggested order are in
  `docs/DESIGN-keepers-of-the-arts.md`. Found on the way: a live privacy gap in the socials library (it counts
  characters, not players, and ignores `exclude_from_stats`) — proposed as slice 0.

## §374 — The Masterpiece Gallery goes as recommended, and it gates Mimic 3.0 stable (2026-10-19)
*2026-10-19 · DECISIONS-2026-09-21.md · Masterpiece Gallery built per recommendations*

The guild lead: *"for masterpiece gallery we'll go with the recommendations. that needs to be there before 3.0 goes
live"*. Every open decision in `docs/DESIGN-keepers-of-the-arts.md` and the gallery scope page is taken as
recommended:
- In Mimic, a Gallery tab in the Pieces chooser.
- On the web, the class-first playbook with fit per row.
- Members only in v1.
- The author chooses whether a byline shows.
- Pieces and groups only.
- Any member publishes, with invitations to seed it.
- Set modes B.
- Social aggregates are opt-in, with a floor of 3 players.

**Mimic 3.0 does not cut stable until gallery slice 1 is on beta.**

**Same night, widened** (the guild lead: *"make it so overlays are exportable into file and importable if people want
to share privately but also encourage people to share publicly and then they can have their name on the overlay. the
templates would be good to have in both the Wolfpack version and the one that's available for everyone else"*):
- **Private sharing is a file.** Export a Canvas set or group to a portable layout file and import one as a new set,
  with Undo. It works in local mode too. The file format is the redone slice 0.
- **Public sharing is encouraged:** an export offers the Gallery, and a published layout carries its author's name.
- **The gallery reaches both editions.** This replaces "members only in v1".
- **Who publishes, decided** (the guild lead: *"I like the idea of window shopping, sorting by most uses, and also making
  curated content"*):
  - **A, window shop:** anyone browses and adopts with no account. Wolf Pack members publish, and switch each layout to
    public themselves (private by default).
  - **Sorted by most uses** by default.
  - **Plus C, curated:** officers pick layouts into a featured "Hall" shown first.
  - Bylines are typed by the author, never filled in. A server-set "Wolf Pack member" badge cannot be faked by a byline.
  - Thumbnails are drawn from the layout itself, with no image uploads. Report and officer hide.
  - Local-mode Mimic contacts us only on an explicit "Browse the gallery".
  - The schema keeps room for public submissions later (B): `submitter_kind`, `pending`, `edit_key_hash`, unused in v1.
  - The 3.0-gate slice:
    1. the tables;
    2. public read routes (`/api/public/gallery`, copied from the public catalog route);
    3. member Publish with a public switch;
    4. the Mimic Gallery tab: browse, Hall first, most used, add as a new set with Undo;
    5. a read-only `eqmimic.quest/gallery`;
    6. report and officer hide or feature.

⚠ **The slice-0 foundations draft is lost.** Branch `claude/keepers-foundations`, commit `b1789d77` (`portableLayout.js`, `overlaySets.js` fork-on-save, the `main.js` one-token remove fix and their tests) was never pushed, and the container reset since. Slice 0 is redone first.

## §376 — Overlays as files: export, import, and the portable layout format (2026-10-19, Mimic beta, agent 3.8.6)
*2026-10-19 · DECISIONS-2026-09-21.md · Overlay export and import as files*

The guild lead: *"make it so overlays are exportable into file and importable if people want to share privately but
also encourage people to share publicly and then they can have their name on the overlay. the templates would be good
to have in both the Wolfpack version and the one that's available for everyone else."* This is the PRIVATE half, plus
the format the public Gallery (`docs/DESIGN-keepers-of-the-arts.md`, Workstream 1) will reuse. The Gallery is not built.
- **The format** (`apps/mimic/portableLayout.js`, pure; `format: "mimic-layout"`, `version: 1`, `kind: "canvas"`):
  `meta` (title, description, `author` byline, class and mode tags), `ref` (EQ's window or the display, aspect only),
  `needs` (the data pieces and overlay pages it uses, worked out from the pieces, never read from a file), and
  `groups`: each group of pieces (those sharing a `grp`, or one piece alone) is pinned to the nearest of nine anchors
  (`tl tc tr / ml mc mr / bl bc br`) of EverQuest's client rect, falling back to the display when EQ's rect is unknown
  or mostly off this display. Every length (offsets, sizes) is in units of the reference HEIGHT, and text scale is
  normalised to a 1080-tall screen. Import multiplies by the importer's own reference height, so a left column stays
  left on an ultrawide, a centred cast bar stays centred, and 1440p lands at 0.75 on 1080p. A group that would hang
  off the display slides whole; it is never squashed. Not yet done (Gallery slice): nudging off overlaps and off open
  EQ windows.
- **Private by construction, not by filter:** `names` (a timers panel's name filters) and every free-text panel name
  are dropped, as are panel and group ids, the saved-group links and hotkeys, window rects, file paths and the chooser's
  state. A one-group timers panel is renamed after its group (Charm, Lulls…) on the way back in. The byline is blank
  unless the person types one. The title defaults to the set's name, which the person typed: it is shown in the preview.
- **A file is untrusted:** `validate()` rebuilds the document from a whitelist (unknown keys are never copied), checks
  every number and string, caps the file at 256 KB and 150 pieces, and refuses the WHOLE file on anything malformed
  or from a newer format. Nothing in it is evaluated.
- **In Mimic:** Settings → Overlay sets has 📤 per set, "Export the current layout…", "Import a layout…" and four
  optional fields (name, byline, note, mode); the tray's 🗂 Overlay sets has the same two actions; the dashboard's
  Overlays tab has a "Share a layout" strip (tray parity). Import shows title, byline and piece count in a native
  window, then saves the current setup as "Before <title>", adds the file as a NEW set (a taken name counts up, never
  overwritten), loads it, and offers one Undo (puts the old setup back and removes both sets). Sets cap at 40, so it
  asks for room first. Only Canvas pieces travel: standalone overlay windows' rects are this computer's.
- **Both editions:** file-only, no token and no network, so the local edition (eqmimic.quest) has it exactly as the
  guild edition does; a test fails if either function reaches for a token, the bot URL or the network.
- **The nudge:** after an export, one line: "Share it in the Gallery and your name goes on it. The Gallery is coming soon."
- **Not built:** exporting a saved group on its own (a saved group has no place on the screen to pin; its pieces travel
  inside a set), the Gallery itself, the fit badge and the "needs" check beyond listing it.
- Tests: `test/portable-layout.test.js` (round trip at 1080p, 1440p and an ultrawide, windowed EQ, privacy, validation,
  wiring), each assertion mutation-checked.

## §378 — The morning's reports, all on beta (2026-10-19, agent 3.8.8–3.8.11)
*2026-10-19 · DECISIONS-2026-09-21.md · Morning bug batch, smoother server tick*

- **FB-85, the server tick was jumpy** (agent 3.8.8). The overlay re-anchored the countdown to every poll's estimate, and
  that estimate carries 0–300 ms of noise. Now `smoothAnchor`, in `apps/mimic/triggers.html` and `zealhealth.html`,
  works on the error taken modulo the 6 s cycle:
  - under 250 ms: ignored;
  - up to 1.5 s: closed by a quarter each poll;
  - beyond 1.5 s: snapped.
- **FB-87, HP on the Map's timers page** (agent 3.8.8). Living rows get an "NN%" chip from the Extended Target cache,
  joined by spawn id, or by name only when that name is unique. No guess on duplicate names and nothing when stale
  (`_mapSeenHp`).
- **FB-86, the Feedback window on the taskbar** (the guild lead picked A). The dashboard and Feedback window are the
  only two windows on the taskbar; FB-61's rule holds for everything else. `test/mimic-taskbar.test.js`.
- **FB-89, an "⚔ Engaged" section at the top of the Map's timers list** (agent 3.8.9). Up to 12 mobs raiders are on,
  each with HP and "N on it", most-targeted first (`_mapEngaged`).
- **FB-88, Extended Target "Self"** (the guild lead picked A, agent 3.8.10). Your own tab-through list, kept by your
  agent:
  - keyed by spawn id; 0 is never recorded;
  - a "keep for" choice of 30s / 60s / 2m / 5m, with 5 minutes and 200 rows held;
  - served at `/api/extended-target?scope=self`, so no bot call.
  - B (a shared, bot-kept roster) stays possible later.
- **FB-90, regen per tick** (the guild lead said yes to the observed version, agent 3.8.11):
  - HP and mana are measured between server ticks on clean ticks only: no damage, heal, cast, combat, zone change,
    max change or drop.
  - The value is the median of the last 4 clean ticks, shown after 2 and hidden in combat.
  - "+N / tick" sits on the HUD and Canvas bars, with a pulse in the last second before the tick.
  - The per-source split (spell / AA / gear) is not built.
- **Process note:** two agents slipped to `sed`/heredoc edits despite the Edit/Write rule, and docs drafted on beta
  branches were moved to main before shipping each time. Gallery tables: see the Open row.

## §381 — Overlays fit to content up or down; Canvas items own their background; FB-92, FB-93 (2026-10-19, agent 3.8.18, Mimic beta)
*2026-10-19 · DECISIONS-2026-09-21.md · Overlays fit content; per-item Canvas background*

The guild lead: *"we should always fit vertically to content with overlays, whether growing up or down. Canvas should
be able to grow up as well. Canvas items should be able to individually set background, or avoid the all-toggle"*.
- **Fit to content** (`709693c4`). The shared IPC (`overlay-auto-height`, holds the top edge growing down and the bottom
  edge growing up) already existed. New:
  - no fit while a window is being dragged; one refit on release (`__wpDragging`, `wp-refit`);
  - a preload content watcher re-runs the same fit when a fitted element changes (ResizeObserver + MutationObserver,
    150 ms, stops itself after 6 buffer-sized creeps);
  - pages that call `overlayAutoHeight(h)` directly are not watched.
  - Excluded, with reasons: Map, Map timers pop-out, Chat, the Canvas, the HUD ring, the Dock, `panel:*` overlays, and
    /who and Pop Raid in their fixed-height modes.
- **Canvas** (same commit): every item whose height follows its content fits it and offers ↑ grows up / ↓ grows down
  (reusing `anchor`; absent stays as before). A hand resize of the height turns fitting off; ⚙ turns it back on.
- **Background per item** (same commit): each panel, piece and group has its own Background; the whole-Canvas switch is
  now "Default background" for items that never chose. A layout's first load stamps each item from the old switch
  (`backV = 1`), so nothing changes visually.
- **FB-93, Target Info on the Canvas missing buffs** (`6f05c65b`): the buffs were there; a whole Target Info panel was
  a fixed 320×200 box and cut them off. It now grows to fit (`wpCanvasFit(win, true)`). Not pet-specific. Separate,
  unchanged: a pet's buffs known only to its owner's Mimic (`petBuffsForOwner`) never reach Target Info.
- **FB-92, Canvas timer ✕ and colours** (agent 3.8.18, `8956b301`):
  - The Canvas now arms the window itself when the pointer is over a control inside a panel iframe (hit-test in the
    page, 150 ms re-assert). The cause is not proven; earlier in-page fixes failed (§317).
  - Spell-row colours, first match wins: purple Avatar/Ferocity, red mez/lull/charm or harmful on a mob, green buffs,
    orange harmful on our players or pets, blue unclassified on friendlies (`_builtinSpellBarColor`). Trigger-author
    rows, server tick, recharm and Bellow keep their colours: asked whether they should turn blue.

## §413 — The Canvas stays off until the person turns it on (2026-10-22, Mimic beta draft `draft/canvas-off`)
*2026-10-22 · DECISIONS-2026-09-21.md · Canvas stays off until turned on*

A raider on 3.0.2 stable, mid-raid, by tell: *"all the overlays are on the screen and I can't turn them off"*, *"what is a canvas?"*,
*"they go away when you exit the app"*, *"clicked on shit in the blue box and everything would not go away"*. The guild lead: *"Canvas needs
to not turn on by default."* 3.8.57 already wrote the Canvas OFF in `defaultConfig()` and made it a tour choice, so a new install was
never the path.
- **Root cause (probable, not reproduced; the raider's screen was not seen).** Two things are in memory only, which is exactly what a
  restart clears: Setup ALL (`setupMode`) and Arrange (`_canvasArrange`). The blue boxes are the Canvas's arrange outline
  (`body.edit .panel`), which only draws while the Canvas is ON. Three code paths could have put the Canvas on without a choice:
  (1) `_setCanvasArrange(true)` turned it on and SAVED it, and was reached from the third row of EVERY overlay's right-click menu
  ("🧩 Arrange the canvas (pieces)", right under "Setup ALL overlays"), from the tray's Arrange item (live while the Canvas is off) and
  from `/pipe mimic edit`; (2) a config saved with it on by an earlier Arrange or a profile/hide-all snapshot kept it on across the
  3.0 upgrade; (3) a saved character profile or hide-all snapshot with `showCanvas` true re-applies it on a character change or unhide.
  Setup ALL itself was not turning it on (`_overlayWanted` gates the Canvas on its own flag), but force-showed a hidden leftover window.
- **Calls.** (a) One-time pass in `loadConfig`: any config without `canvasDefaultOffApplied` gets the Canvas OFF (and cleared in the
  hide-all snapshot and every character profile), logged once; we cannot tell a chosen "on" from an accidental one, so a person who
  chose it in the tour is switched off once and turns it on again (their layouts are kept). Beta/alpha testers get the same pass.
  (b) Arranging with the Canvas off asks first ("Turn the Canvas on and arrange it" / "Not now", default Not now); `/pipe mimic edit`
  refuses; the overlays' right-click row appears only while the Canvas is on. (c) Setup ALL never shows a leftover hidden Canvas
  window. (d) Esc leaves Setup ALL / Setup THIS (preload, any overlay) and leaves arranging on the Canvas.
- **Left alone on purpose:** a saved overlay SET or an imported layout that carries the Canvas turns it on when the person loads it
  (they approved it in a dialog with Undo); a Canvas group hotkey turns it on (they bound it).
- Tests: `test/canvas-stays-off.test.js`. Docs: `STATUS.md`, `HOW-ITS-BUILT.md`.

## §458 — Press a window's name to minimize; every overlay folds; picker from the name (2026-10-28)
*2026-10-28 · decisions/inbox/2026-10-28.md*

The guild lead: *"add minimize buttons to everything to switch to the mini mode"*, then *"Make it so you can click on the
name and release to minimize actually, and highlight the name of the window when you do. for full windows, for canvas
have a minimize tab if the window is wide enough, otherwise hover it either over or to the side of, dependent on other UI
element position. Make sure you can always read a label of what the button is, even if you have to move it. You can
always put a little matching colored line in between if you must. Overlay picker should be built in too, all of the
standard ones, then >MORE and >CANVAS"*, then picked **3A** (the picker opens from the window name: right-click or
long-press) *"with the top overlays the ones used previously on that character as default sort, also allow alpha sort on
more"*, and *"make sure we're saving state for the character's last"* (read as: each character's last minimize state and
overlay use; the message was cut off there).
- Press-and-release on the name toggles mini (gold highlight while held; a drag cancels). The nine designed minis keep
  their design; the other overlays fold to their title row (the session's default, offered and not objected to). The
  minimize-all hotkey still covers only the nine, so the alerts window never folds mid-raid by a hotkey.
- Canvas panels: a labelled "▭ Minimize" in the panel's tab when it fits; otherwise floated beside / above / below the
  panel where it overlaps nothing, joined by a line in the panel's colour; the label is never shortened.
- Picker: standard overlays (most recently used on this character first), ▸ MORE (with A–Z), ▸ CANVAS.
- On Mimic beta `37f988e9` (agent 4.0.33), 2026-10-28; mockup and real-page screenshots sent the same night. Not yet seen
  in a real Electron window: fold height and the name's hover handshake are the things to check.
