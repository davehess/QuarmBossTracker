# Mimic overlay catalog — every overlay, what feeds it, what it shows, what breaks

**Status: written 2026-09-27 from the code at beta `07a4765c` / stable Mimic 2.7.2 (agent 3.7.31).**
The guild lead: *"every component of the overlays (data sources and outputs and displayed
surfaces or dependencies or raid impact) need to be cataloged in a master overlay design doc and
then prepared for an open overlay builder system that I want to develop for a 3.0 release for
mimic."* This is the catalog. The builder plan that consumes it is
`docs/DESIGN-mimic-3.0-overlay-builder.md`.

Three read-only sweeps of `apps/mimic/*.html`, `apps/mimic/main.js` and the agent produced the
entries; each fact was read in the code, and where one could not be found the entry says so. Line
numbers are from that commit and will drift; the file and function names will not.

How to keep it current: when an overlay gains a data source, an output or a surface, update its
entry in the same change (the `HOW-ITS-BUILT.md` rule applies here too).

---

## 0. The shape every overlay shares

Read this first; the per-overlay entries only list what differs.

**Window.** One frameless, transparent, always-on-top, resizable `BrowserWindow` per overlay
(`main.js` — `frame:false, transparent:true, alwaysOnTop:true, skipTaskbar:true, focusable:true`,
then `setAlwaysOnTop(true,'screen-saver')`, `setVisibleOnAllWorkspaces(true)`). `webPreferences`
come from `_wpPrefs` (the preload, context isolation, a `--wp-window=<key>` argument). Windows exist
only while wanted: `_OVERLAY_WINDOWS` + `_overlayWanted` materialise and reap inside
`applyAllVisibility`. The EQ gate (`_eqGateOk`) hides everything when EQ is not running, polled by
`tasklist` every 10 s (45 s when EQ is absent).

**Data.** Every overlay polls the local agent over HTTP (`127.0.0.1:<port>`; the port is handed in by
`agent-port` IPC). Most read `/api/state`, which the agent serialises once per 400 ms and serves to
every poller (`_serializeForDashboard`). A few have their own endpoint (`/api/me`,
`/api/tank-state`, `/api/command-center`, `/api/extended-target`, `/api/buff-queue`,
`/api/pop-objectives`). Nothing renders from Zeal directly: Mimic's `zealPipe.js` reads the named
pipe and POSTs `/api/zeal-event` to the agent; the agent owns the state.

**Zeal pipe types** (`zealPipe.js`, `_zealAbsorb` in main.js, decoded per character into
`_zealState[character]` in the agent):
| type | carries | who reads it |
|---|---|---|
| 1 label | buff slots 45–59 + 135–140, casting label 134, char info (HP 17/18, mana 124/125, level 2, class 3, resists 12–16, weight, XP/AA, gems 60–67) | HUD, Melody, Tank (HP), Buff queue (via live-state), Target Info (own characters) |
| 2 gauge | slot 1 self HP, 6 target, 16 pet, 24 **server tick**, 26–33 gem recast, group slots | Charm, Pets, Target Info, Tick, HUD, Tank, Extended Target (own row) |
| 3 player | zone, autoattack, spawn/target/pet ids, target-of-target, hit-by, location | HUD, Target Info (zone + target id), Extended Target, Buff queue (range) |
| 5 raid | raid roster with class + HP | CH chain, Tank, Buff queue (auto class), /who target card |
| 6 group | group composition; HP only with `/pipeverbose` | Extended Target (outside a raid), Tank |
| 0 tick | heartbeat | Tick overlay's liveness row |

**Chrome every overlay must have** (the parity checklist in `CLAUDE.md`): ✕ hide (top-right, with a
`hide-overlay` branch in main.js), ✥ move (top-left, manual-drag IPC, right-click → shared menu with
resize presets + Setup THIS/ALL), the **hover-interact handshake** on every clickable control (a
locked overlay is click-through; without it the click lands in EQ), a `WP_OVERLAY_ROWS` row on the
dashboard, an `apply*Visibility()`, its flag in `_HIDEALL_FLAGS`, an `_overlayEntries()` entry.

**Look.** Content opacity `cfg.overlayOpacity[key]` and background alpha `cfg.overlayBgAlpha[key]`
(0.15–1.0; the renderer gets `bg-alpha` / `content-alpha`, the window's own opacity stays 1.0);
backdrop `cfg.overlayBackdrop`; scale `overlayScale` / `overlayScaleByKey` (0.5–2.0 via zoomFactor);
themes including three colour-blind sets; **auto-height** (`overlay-auto-height`: zoom-corrected,
capped at the work area, 4 px hysteresis, grows upward only for the trigger window by default).

**Placement.** `_resolveBounds` uses saved bounds only when the screen signature still matches and
they are on-screen; `_persistBounds` writes `cfg[<key>Bounds]` + `Sig` 400 ms after a move.
Auto-arrange (`_parseUiWindowRects` → packing) reads the newest `UI_<Char>_*.ini`, takes the
dominant `XPos<W>x<H>` block, projects the game's window rectangles onto the home display, and packs
visible overlays into the free space, right edge first, centre 52% a soft no-go zone. **Mimic does
not know where the EQ window is** ("we can't ask Windows where the EQ window is without native
deps"); the "home display" is stamped from the cursor on 🧲 Rescue, else the primary display.

**Modes.** Setup mode (global or per window) unlocks, force-shows and makes resizable; locked =
`setIgnoreMouseEvents(true,{forward:true})`. Mini mode for nine overlays (`_MINI_KEYS`: hud, tank,
mobinfo, chchain, charm, exttarget, pets, popraid, buffQueue) via `cfg.overlayMini` +
`overlayMiniPinned`, Ctrl+Shift+M for all. The **Dock** (`dock.html`) hosts any catalogued overlay
as a same-origin iframe pane (never a forked copy), 1–3 columns, named layouts; the HUD and the
trigger window are excluded. Hide-all Ctrl+Shift+H snapshots and flips `_HIDEALL_FLAGS`.

**Per-character.** `charProfiles` store visibility flags only (`_CHAR_PROFILE_FLAGS`: HUD, triggers,
charm, pets, mobinfo, buffQueue, who, melody, zeal, threat, chchain, exttarget) — no positions, no
opacity, and not `showMe`, `showPopRaid`, `showDock`, `showCommand` or `showTank`. Class-set
seeding runs once per character. The active character is *whichever Zeal stream reported last*
(the flip-flop flagged in DECISIONS §52).

**Screen awareness today.** `screen.getAllDisplays`, `getDisplayNearestPoint`, `getPrimaryDisplay`,
`getDisplayMatching`, `getCursorScreenPoint`; `display-removed` / `display-metrics-changed` snap
back only eight windows (HUD, trigger, charm, pets, mobinfo, who, melody, chchain) — not zeal,
popraid, me or the dock. Renderers read `window.screen.avail*` themselves (me.html, triggers.html).

---

## 1. The catalog at a glance

| Overlay | file · key · flag | reads | Zeal | bot needed | mini | dock | speaks |
|---|---|---|---|---|---|---|---|
| DPS HUD | overlay.html · `hud` · showHud | /api/state | indirect | History guild numbers only | ✓ | ✓ | — |
| Tank | tank.html · `tank` · showTank | /api/tank-state | 1,2,5,6 | cross-client parts | ✓ | ✓ | — |
| Threat meter | threatmeter.html · `threat` · showThreat | /api/state | — | — | — | ✓ | — |
| CH chain | chchain.html · `chchain` · showChChain | /api/state | 5 | DI chips only | ✓ | ✓ | ✓ (page + agent) |
| Extended Target | extarget.html · `exttarget` · showExtTarget | /api/extended-target | 2,3,5,6 | **required** | ✓ | ✓ | — |
| Command Center | command.html · `command` · showCommand | /api/command-center | via Tank | queue, DI, ext target, live state | — | ✓ | — |
| Charm | charm.html · `charm` · showCharm | /api/state | 2 (16, 24) | — | ✓ | ✓ | ✓ |
| Pets | pets.html · `pets` (`pet` in hotkeys) · showPets | /api/state | 2 (16) | — | ✓ | ✓ | — |
| Target Info | mobinfo.html · `mobinfo` · showMobInfo | /api/state | 2,3,1 | catalog + relays | ✓ | ✓ | — |
| Buff queue | buffqueue.html · `buffQueue` · showBuffQueue | /api/buff-queue | via others' live state | **required** | ✓ | ✓ | — |
| /who | who.html · `who` · showWho | /api/state | 2,5 (target card) | de-anon, fail-open | — | ✓ | — |
| Melody | melody.html · `melody` · showMelody | /api/state | 1 (134, buffs, 124/125) | catalogs at start | — | ✓ | — |
| Trigger alerts | triggers.html · `trigger` · enableTriggerTts (+showTriggerOverlay) | /api/state + /api/fires/wait | 2 (24) for built-ins | guild triggers, relay | — | — | ✓ |
| HUD ("Me") | me.html · `me` · showMe | /api/me | 1,2,3,6 | target extras | — | — | — |
| Tick | zealhealth.html · `zeal` · showZeal | /api/state | 2 (24), 0 | clock offset | — | ✓ | — |
| PoP raids | popraid.html · `popraid` · showPopRaid | /api/pop-objectives, /api/pop-mob-info | — | **required** for shared objectives | ✓ | ✓ | — |
| Dock | dock.html · `dock` · showDock | IPC only | — | — | — | is the container | — |
| Timers canvas (beta) | canvas.html · `canvas` · showCanvas | IPC; its panels /api/timers | via the trigger rows | via the trigger overlay | — | — (a host itself) | — (the trigger window speaks) |

Windows that are not overlays: Settings (`settings.html`), UI Studio (`ui-studio.html`), Resource
use (`resources.html`), loading. Panel overlays (`createPanelOverlay`, `?overlay=<key>`) turn any
dashboard panel into a window — DEEPS, Damage Done, Top Damage, Incoming Damage, Threat Detail.

---

## 2. The entries

Each entry: **Identity · Data · Outputs · Surfaces · Dependencies · Raid impact · State · Caveats.**
Invented names in examples are conventions, not people.

### DPS HUD — `overlay.html`
- **Identity.** key `hud`, flag `showHud`; `createOverlayWindow`; bounds `hudBounds`. Window title "HUD overlay" (the same as the Me overlay's — a trap when debugging).
- **Data.** `/api/state` every 1 s: `currentEncounterThreat` (the active character's copy), `activeCharacter`, `fightHistory`. Per-fight `perPlayer` dmg / took / tookMax / pet_owner / pet_charm come from the encounter builder's `_publishLiveThreat`. Boss name = a death event or the most-damaged target (not bosses.json). History's *guild* numbers come from the bot's `/live-damage`, fetched 40 s and 100 s after a fight, and depend on every client's `threat_snapshot` uploads. Live `guildDamage` is fetched but deliberately not read (it double-counts).
- **Outputs.** Title row (connection dot, boss, "· N clients" / "· settling…", 📋 /rs copy, row stepper 3–50, History / DPS / Tank tabs); rows of rank · name (+pet, (owner), (charmed), ·max hit in Tank mode) · % · Damage/Taken/Guild · Obs (board ≥370 px) · DPS or DTPS · Sec; your row appended below the cutoff; mob-total footer; History list of up to 6 fights. No speech. Writes: the /rs line to the clipboard.
- **Surfaces.** Mini "Me and my neighbours". Dock. Dashboard: session cards only (DEEPS, Damage Done, Top Damage, Incoming Damage), each also a panel overlay. Web: `/parses/[id]` post-fight; a `/mimic/mini` mock.
- **Dependencies.** None of catalog / bosses.json / who / prefs. Bot only for History guild numbers.
- **Raid impact.** No per-fight damage or damage-taken ranking, no /rs line. The local view alone "saw 0.1–8.3% of a fight" on the worst client — the guild number is what makes it honest.
- **State.** localStorage `wp.damageTabMode`, `wp.deepsRows`; cfg `showHud`, `hudBounds`, opacity, mini, dock.
- **Caveats.** DPS/Sec are relative to fight length, not each player's active time. **Found in code:** "me" is computed from `s.character || s.uploaderCharacter || s.self`, none of which `/api/state` sends at the top level — so the "you" highlight, the always-show-YOU row and mini's centring on you never happen (mini falls back to the top 3). Logged in STATUS.

### Tank — `tank.html`
- **Identity.** key `tank`, flag `showTank`; `createTankOverlay`; opt-in.
- **Data.** `/api/tank-state` every 500 ms (`_serializeTankState`, last-good fallback). Zeal: 2 (target slot 6, self slot 1, group slots for others' HP), 1 (buffs with ticks, HP cur/max labels 17/18), 5 (roster HP heartbeat), 6 (`/pipeverbose` groupmates). Log: rampage lines, `recentTankHits` → MT pick, DS reflects, heal casts, CH chain, DA broadcasts in raid chat, Death Touch from trigger timers. Bot: `/extended-target` (main target, 3 s cache), `/character-live-state` (MT + rampage target HP/buffs, 2.5 s), `/target-buffs`, `/target-casts` (inbound heals), relayed Death Touch triggers; off-heal thresholds tunable remotely.
- **Outputs.** MT card (HP bar, cur/max when max ≥ 500, projected-HP ghost, up to 6 inbound heal bars), Divine Aura card with "start CH on <name>!" when critical, target card + "Enrage near" (warn ≤15%, threshold 8%), Death Touch countdown, Rampage card (HP or the gold INV bar → green in the last 5 s), CH chain due line, damage-shield card (total, ~per hit, hits, top 3 abilities, known sources), buff list (8, soonest first, "fell off"), hurt off-tanks. No speech.
- **Surfaces.** Mini "One strip". Dock. Dashboard: Incoming Damage + 🛡️ Damage Shields cards. Web: static reproductions on `/about` and `/mimic/mini`.
- **Dependencies.** Spell catalog (DS per hit, cast seconds, heal estimates). Enrage uses a hardcoded `ENRAGE_BOSSES` list, not bosses.json. Bot for everything cross-client; local fallback otherwise.
- **Raid impact.** DA countdown critical at ≤12 s with the "start CH" callout; the INV bar means "don't panic-heal" and green means "get ready"; Death Touch "both tanks need to see it coming".
- **State.** cfg `showTank`, `tankBounds`, opacity, mini.
- **Caveats.** Header: cross-raid sync (Tier 4) deferred — the badge is always "local" (`fast_sync:false`). HP plausibility floor `MIN_HP_POOL` = 500. **Found in code:** the CH-chain urgency colour uses the *local* character's HP, not the chain target's.

### Threat meter — `threatmeter.html`
- **Identity.** key `threat`, flag `showThreat`; opt-in.
- **Data.** `/api/state` every 700 ms: `currentEncounterThreat.perPlayer` (swing, proc, spell, heal, total, pet_owner, pet_charm, pet_threat_total). Log only, flat hate tables `PROC_HATE` / `CAST_HATE` ("community-sourced PoP-era ballparks"); pet threat rolled into the owner; kept 2 min after a fight. No Zeal, no bot.
- **Outputs.** Header (dot, boss/target, elapsed, "· ended"); up to 8 rows of rank · name · pet tag/charmed · +pet N · total (negatives blue) · stacked swing/proc/spell/heal bar; legend; stale data dimmed. No speech.
- **Surfaces.** No mini. Dock. Dashboard: Threat Detail (also a panel overlay). Web: none.
- **Raid impact.** "Tanks see where their hate is coming from; non-tanks see when they're about to pull."
- **State.** cfg only.
- **Caveats.** Negative spell threat is left out of the bar but kept in the total. **Found in code:** the same missing-"me" problem as the DPS HUD — the gold "you" row never appears.

### CH chain — `chchain.html`
- **Identity.** key `chchain`, flag `showChChain`; `focusable:false` because clicks used to steal focus from EQ and "cost real CH heals"; opt-in.
- **Data.** `/api/state` every 600 ms, redrawn every 150 ms: `chChain`, `offHealCandidates`, `diStatus`, `diCallout`, `raidPipe`, `watchedLogs[].lastSeen`, `currentEncounterThreat`. POSTs `/api/chchain/go-tts`, `/ddr`, `/remove`. Log (shout/say/raid/guild): numbered calls "004 - CH - X - Mana: 52%", "NNN GO GO GO", roster posts, "Inc to X - N% Mana Left" spot-heal macros, interrupt lines. Zeal 5 for roster matching, mini MT HP, DI roster pruning. Fully local except DI chips (bot `/di-status`, 4 s cache).
- **Outputs.** Banners: ORDER CONFLICT (the platform's loudest element), integrity amber/red ("OVERLAY BLIND … GO MANUAL"), CH GAP SOON / CH GAP, D.I. DOWN nomination with two names + evidence, pivot, spot heal. Slot rows (number, name + kind, mana %, status: cast seconds / ✕ / GO! / countdown / DUE / NEXT / ago, cast bar, DDR grade sticker, ✕ remove; contested slots one row per claimant). NEXT footer, off-heal list, DI chips. Buttons 🎯 📣 ⚙ 🔊 ✕. **Speech in the page** (muted by default + Mimic-wide mute): "CH gap soon/on <tank>", pivot and spot-heal calls, "C H overlay blind — go manual" / "data stale", "only X has D I up". **Speech from the agent** via the trigger window: "0N GO", DI DOWN. DDR grades are never spoken.
- **Surfaces.** Mini "Timeline lanes" (banners stay). Dock. Web: static reproductions only.
- **Dependencies.** No runtime catalog (CH cast 10 s fallback; the agent sends `ch_cast_ms`). Bot only for DI chips + threshold tuning.
- **Raid impact.** "A quiet stale overlay reads as 'chain fine' and gets a tank killed" — red means clerics go manual now. Remove is deliberately narrow: "a chain with a missing cleric kills the tank".
- **State.** localStorage `chchain_mute` (default muted), `chchain_go_tts`, `chchain_ddr`, `chchain_lead_auto`, `chchain_lead_sec`; the GO/DDR flags live in agent memory and reset to ON on restart (the page re-POSTs on load).
- **Caveats.** The cast bar may finish early under focus items; mini's "landed" is inferred and the queue past NEXT extrapolated; rows dim after 60 s, the agent clears the chain at 5 min; the pivot TTS used to call an undefined `speak()`.

### Extended Target — `extarget.html`
- **Identity.** key `exttarget`, flag `showExtTarget`; opt-in.
- **Data.** `/api/extended-target` every 2 s — the agent proxies the bot's `/api/agent/extended-target` (3 s cache per character; `same_zone=0` when that pref is off). The bot aggregates every raider's Zeal slot-6 target. The agent adds locally: live type-2 HP for your own target's row, mob victim / DPS / time-to-kill from the log + HP trend, type-3 target-of-target and hit-by, same-name tracks, and outside a raid limits rows to your group (type 6 + type-5 freshness).
- **Outputs.** Header (dot, 🛡 off-tanks toggle, 👥 players toggle, "N online" / "N in group", "🛡 N off-tanked"); rows with raider-count badge (or 🛡), ★ named, MEZ/SLOW pills, #spawn_id or * (ambiguous), #n/N, "@ tank", Zeal /tag, owner, ⚠ hurt, off-tanked, last seen, per-row ✕, HP % + bar (cur/max on players), sub-line victim / hit-by / DPS / time to kill, "→ who is targeting it", debuff chips pooled across same-name mobs; footer caveat + "hidden · show all"; rows animate on re-sort. No speech.
- **Surfaces.** Mini "CC letters + count". Dock. Dashboard: only the options card. Web: `/mimic/mini` mock.
- **Dependencies.** **Bot required** (`{targets:[],loading:true}` without it). SLOW/MEZ lists hardcoded in the page. Pref `extSameZoneOnly`.
- **Raid impact.** The same cache feeds the Tank and Command Center target + main-tank pick even with this overlay closed; blank means those fall back to the local target, and the raid loses mez/slow status ("Don't break the mez") and off-tanked adds.
- **State.** localStorage `wp_ext_show_offtank`, `wp_ext_show_players`, `wp_ext_hidden`; cfg.
- **Caveats.** Same-name mobs are told apart only by spawn id (Zeal 1.4.6+) or differing HP; debuffs are pooled when unattributable; absolute HP fields optional.

### Command Center — `command.html`
- **Identity.** key `command`, flag `showCommand`, `agentPath: '/overlay/command'` — it prefers the copy the **agent** serves (embedded verbatim as `COMMAND_HTML`; `check-agent-dashboard.js` enforces byte-identity), falling back to the app file. Opt-in.
- **Data.** `/api/command-center` every 1.5 s (`_serializeCommandCenterState`) = everything Tank has plus: bot `/raid-buff-queue` debuff queue (cures), needs-rez (deaths + rez callouts in guild/raid chat), raid-chat DA/invuln macros, your own "You can use a new discipline in…", healer mana from four sources (mana-% macros, CH-call mana, `/di-status` piggyback, local type-1 labels 124/125), `/random` rolls, DI status. POST `/api/rez-dismiss` (local drop + a `rez_dismiss` upload).
- **Outputs.** Target + enrage; Death Touch; MT HP; Rampage/INV; defensives (UP / seconds / DOWN·cooldown); your discipline; healer mana bars with DI chips; 🎲 rolls (6, expandable, deathroll steps, ✕ / clear all); curse/cure chips; ⚰ needs rez (glows while someone is rezzing; ✕ clears raid-wide); collapsible sections. No speech.
- **Surfaces.** No mini. Dock (loads from the agent path). Dashboard: the 🎲 Rolls card. Web: `/raid` mana bars mirror it; `/about` demo.
- **Dependencies.** Spell catalog (through Tank data); hardcoded enrage list; /who + type-5 roster for healer class; bot for the queue, DI, ext target, live state, rez relay.
- **Raid impact.** One-window glance board; needs-rez is "the only section where somebody is waiting on a human to act".
- **State.** localStorage `wp_cmd_collapsed`; dismissed cures / rolls per session.
- **Caveats.** Compact by design — not a replacement for Tank + Buff queue. A DI "?" means unknown, not ready. **Found in code:** nothing applies *other* clients' rez dismissals (the only caller is the local one); `hpValText` lacks Tank's `MIN_HP_POOL` check.

### Charm — `charm.html`
- **Identity.** key `charm`, flag `showCharm`; opt-in; auto-shown in blind mode (`_BLIND_FORCED_KEYS`).
- **Data.** `/api/state` every 500 ms: `charmPets`, `activeCharacter`, `petHealth[].target`; POST `/api/charm-pet/dismiss`. `charmPets` = `_charmTickTracker` + Zeal slot 16 (name/HP, gauge-sourced land/break via `_reconcileGaugeCharms`) + gauge 24 (server tick, `_serverTickAtFor`) + the mob-tick learner (DoT ticks, log breaks) + `/pet health` and pet-buff landings. Log: charm land ("tells you … Master." on a/an-named mobs, "X regards Y as an ally"), breaks ("snaps out of charm / is no longer charmed / has been freed of charm", "Your charm spell has worn off"), Dire Charm. Durations from the inline `CHARM_SPELLS` table. No bot.
- **Outputs.** Per-pet card: name, badge (charm / DIRE / BROKE), owner, "tick n/max · up m:ss" (red at 54 s), "breaks m:ss" (~ when estimated), HP % + bar, **server-tick and mob-tick rows**, duration bar, pet buff bars with "fell off — rebuff", ✕ dismiss / remove. The overlay flashes when a break is imminent. **Speech:** "charm break" (600 ms defer), "recharm pet" at the warn threshold, "charm breaking" / "…in 30 seconds", bard-only "recharm now" at ≤3.1 s.
- **Surfaces.** Mini (two rows: HP%/name → target; timer with S/M ticks). Dock. Dashboard: Charm Pets panel + the 🐺 diagnostic card. Web: none.
- **Dependencies.** `CHARM_SPELLS`, spell catalog (pet buffs), Zeal slot 16 + 24 (row reads "needs Zeal" otherwise); only `watchedLogs` characters.
- **Raid impact.** The break callout is built from all pets, not the focused window, because "not looking at that window is exactly when you need to hear it". A late callout on a bard's ~3 s recast already misses.
- **State.** localStorage `wpCharmWarnAt`; agent tracker in memory only.
- **Caveats.** Unknown duration falls back to 60 s (spoken warnings suppressed on estimates); mini has no MR (no resist data on the feed); pet HP only for the local uploader's own pet; the overlay window lacks `backgroundThrottling:false` (only the trigger window has it).

### Pets — `pets.html`
- **Identity.** key `pets` (but `pet` in the hotkey and class-set maps — a mismatch), flag `showPets`; opt-in; blind-forced.
- **Data.** `/api/state` every 500 ms: `petHealth`, `activeCharacter`; POST `/api/pet/dismiss`. Built from Zeal slot 16, active charms, the `/pet health` report ("I have N percent…" + bare buff-name lines gated against the catalog), buff landings, pet melee hits (`recordPetCombat`), "Attacking X Master." (60 s TTL). Rows only for owners with **fresh Zeal** (45 s).
- **Outputs.** Per-pet card: name/owner, HP % + bar, "Ns ago", "→ target Ns ago", buff bars (green buff, red debuff, grey untimed, purple fell-off), combat chips (max, avg, hits, dmg, per-skill, DUAL), ✕. No speech.
- **Surfaces.** Mini (HP/bar/name → target; haste buff as a draining bar). Dock. Dashboard: Pet-buff diagnostic card + a line in Buffs & Zone. Web: none.
- **Dependencies.** Spell catalog; Zeal required; `logsync.pet-state.json` persists pet state; `/pet health` TTL 30 min.
- **Raid impact.** A pet class loses pet HP, buff expiry + rebuff cue, and the pet's target.
- **State.** cfg only; agent `logsync.pet-state.json`.
- **Caveats.** No 6 s tickdown, no alarms (that is Charm); mini shows the haste buff's name, not %; bard songs excluded from the haste set; data older than 5 min renders faded.

### Target Info — `mobinfo.html`
- **Identity.** key `mobinfo`, flag `showMobInfo`; blind-forced.
- **Data.** `/api/state` every 500 ms: `mobInfo`, `stats.currentEncounterThreat`. `buildMobInfo` uses the freshest Zeal state with a target: gauge 6 (name, HP%), type 3 (zone id, target id), type 1 (buffs when the target is one of our characters). Bot relays: `/mob-info` (eqemu_npc_types stats, loot, spells, factions; 6 h cache, zone-scoped), `/target-casts` (cross-client casting), `/target-buffs` (6 s TTL), `/character-live-state` (a raider target's buffs + HP), `/who-lookup` (player card). Local: slow (`_bestSlowForTarget`), NPC mana + last cast, SK Harm Touch, observed landings (**now on the mob's own tick where known — §57**).
- **Outputs.** Header (name, class / sex variants, HT ✓/✗ timer, PQDI link, zone, HP / dmg / % line, level badge, buff/song slot counts for PCs), HP bar, slow badge, estimated mana bar + "est" chip, last cast. Stats tab (casting rows, pacify rows first, debuffs, buffs, resist grid, sight + special-attack chips, player card). Loot tab (rate tiers, LORE, ⭐ unique, "N× won" from OpenDKP). Spells tab. Factions tab. Corpse target: "last fight (top 5)". No speech. Writes: `openExternal(pqdi)`.
- **Surfaces.** Mini (HP row + HT chip, SLOW timer row). Dock. Dashboard: none. Web: catalog pages under `/db/npc/[id]` (not live).
- **Dependencies.** Bot reachable + linked (no lookup otherwise); spell catalog; Zeal required; /who + type 5 for player class.
- **Raid impact.** The SK HT chip is "the one thing about it that can kill the tank"; pacify first because the raid needs "is this mob still safe to walk past"; slow status must "stand out next to the HP header".
- **State.** localStorage `wpTargetMana`; tab choice in memory.
- **Caveats.** Mana is a floor (resisted/interrupted casts are silent); ambiguous slows show "SLOWED" without a %; mini has no ROOT row; never a blanket "safe to pull past"; casting names only raiders running Mimic; same-named bodies differ by sex, and the pipe has no sex; Spells tab empty until `npc_spells` syncs; player level from /who only.

### Buff queue — `buffqueue.html`
- **Identity.** key `buffQueue`, flag `showBuffQueue`; opt-in. Uses `autoFitOverlay` rather than auto-height.
- **Data.** `/api/buff-queue[?class=]` every 1.5 s — the agent proxies the bot's `/raid-buff-queue` (2 s TTL; the header says 3 s). POST `/api/debuff-clear` (raid-wide) and `/api/buff-lag-report` (500 ms TTL for 60 s). The bot builds the queue from `raid_roster`, `character_live_state` (every raider's uploaded type-1 buffs; type-3 location → out-of-range) and `buff_casts` (3 h); "inferred" rows from observed cast logs. Auto class: /who, then type 5. `recent_casts` from the local `_bardMelody` tracker; `sections` from the dashboard's `bq-pref`.
- **Outputs.** 🩸 Debuff queue first (name, group, class, state chips, curse chips with time, cure type, buff slot ✂, "✓ curer Ns", "✓ cured" on inferred rows); 🛡 Buff queue by category, collapsed, with a 🔮 "likely memmed" hint; ⚡ Burst queue (Feral Avatar / Savagery); a "casting" line under each row; class picker + "lag?" in the title bar. No speech.
- **Surfaces.** Mini (two-column ledger of counts; click to expand). Dock. Dashboard: Buffs / Raid tab. Web: `/raid`, `/buffs`.
- **Dependencies.** **Bot required**; other raiders running Mimic (else "inferred"); /who or type 5 for the auto class.
- **Raid impact.** So "a buffer can work the list without alt-tabbing"; debuffs first because "cures are time-critical"; the casting line so a second cleric "sees the queue is already covered and skips it".
- **State.** localStorage `wp:bufferClass` (shared with the dashboard), `wp:bq:collapsed`; agent `_optinState.bqShow*`.
- **Caveats.** Out-of-range is advisory, stale up to the heartbeat; "✓ cured" only meaningful on inferred rows; ✕ has a 250 ms stray-click guard; in mini the class picker is hidden but still filters.

### /who — `who.html`
- **Identity.** key `who`, flag `showWho`.
- **Data.** `/api/state` every 500 ms: `whoSnapshot`; POST `/api/who-class`. `buildWhoSnapshot` = /who log rows + run boundaries + bot `/who-lookup` (de-anon, main, 🐺 Mimic flag, Zek; 5 min TTL, fail-open). Target card from Zeal 2 + 5. Zeal not needed for the list.
- **Outputs.** Target card with guild; "Current N · ago" + "Recently gone" (4, toggle); rows: name, 🐺, (main), guild, anon/GM/ZEK flags, class + level (italic when de-anon'd), class picker + ⧉ copy on unknown-class rows; ZEK / CLASS / GUILD filters, sort cycle, height grip. No speech. Writes: `who-class`, clipboard.
- **Surfaces.** No mini (deliberate). Dock. Dashboard: none. Web: `/who` history (related, not live).
- **Dependencies.** The user must type /who; bot for de-anon; Zeal for the target card.
- **Raid impact.** Loses Zek flags and guild identification of who is present; the target card was added "in a raid shared with other guilds".
- **State.** localStorage `wp:who:height`, `wp:who:filters`, `wp:who:zekOnly`.
- **Caveats.** Repaints pause while the class `<select>` has focus (capped at 8 s after the #137 freeze); rows fail soft individually; class picks reach other clients only through `who_overrides` → `who-lookup`, minutes later.

### Melody ("Casting tracker") — `melody.html`
- **Identity.** key `melody`, flag `showMelody`; sub-toggles `melodyBardOnly`, `melodyDmgTotals`; opt-in.
- **Data.** `/api/state` every 600 ms, painted every 150 ms: `bardMelody`, `activeCharacter`, `castCounts`. `_bumpBardMelody` from "You begin singing/casting X", "You begin playing a melody.", and **Zeal label 134 transitions** (the per-song signal under /melody). Song buff timers + utility strip from type-1 buff slots + the raw label dump. Dirge board: buff names, Puretone disc timers, mana labels 124/125. AE counter from landing lines (stale after 30 s). Cast times from the item + spell catalogs (fetched from the bot at startup).
- **Outputs.** Rows in twist order (▶ casting fill / ✓ / ⏹ / queued, ×N cast count, buff chip, ⚔hits/12 AE chip with per-hit damage + kite Σ); utility strip (Amplification, Harmonize/Resonance, Selo's Accelerating Chorus, Niv's, Nature's); "now casting"; title "🎶 Melody" / "🔮 Spell Casting"; the DIRGE board (6-step checklist, Puretone key, one button per Dirge mana allows, DISC indicator). No speech. Writes: none.
- **Surfaces.** No mini (deliberate). Dock. Dashboard/web: none.
- **Dependencies.** Zeal (134 + buff slots) effectively required; catalogs; `logsync.hud-timers.json` for disc timers.
- **Raid impact.** ⏹ freezes on the last song so a bard sees "I'd resume on this one"; a blank overlay loses the twist state, the Selo's/Amp timers and the Dirge pre-buff/mana board.
- **State.** localStorage `wp.melodyBardOnly`, `wp.melodyDmgTotals`, `wp:melody:dirge`; cfg.
- **Caveats.** Default cast times 3 s songs / 4 s spells without a catalog value; idle characters dropped after 45 s; Selo's step needs ≥2:00 left; "the board is a reminder, not a gate".

### Trigger alerts — `triggers.html`
- **Identity.** key `trigger`; its lifetime hangs off `enableTriggerTts`, not a show flag — the window exists whenever TTS is on, even with EQ closed, so voice survives; hide-all uses `showTriggerOverlay`. Not dockable, no mini. `backgroundThrottling:false` and a one-time user gesture so speech is allowed. Grows upward by default.
- **Data.** `/api/state` every 700 ms (`activeTimers`, `recentTriggerFires`, `blindEvents`) + the `/api/fires/wait` long-poll (20 s; a fire is pushed by `_pushOverlay`). Definitions: guild triggers from the bot `/guild-triggers` + `personal_triggers.json`. Cross-Mimic relay `/trigger-relay` up, `/recent-fires` down. Log: trigger regexes, blind/self-hit lines, rampage. Zeal only for built-in rows: `server_tick` (gauge 24), `recharm_tick` (learned mob tick), **spell timer bars now on the mob's tick where known (§57)**.
- **Outputs.** Centre flash (3.5 s, 🧪 on rehearsals); red pulsing blind flash; vote buttons « Earlier / ✓ Good! / » Too early (8 s); sticky 📌 rows (5 min); countdown stack (MM:SS, "target - effect", thin or filled bars, pulse in the last 5 s, ✕ per row, 6 rows + "+N more", loot chips exempt); 🗑 clear-all. **Speech:** `speechSynthesis` queue ("CH GO" priority, 5 s TTL, max 3 queued, watchdog), pre-end warnings, optional sound URL; mute silences sound only. Writes: `/api/triggers/playback` (checkpoint journal), `/api/triggers/feedback` (→ bot `trigger_feedback`), `/api/timers/cancel`.
- **Surfaces.** Dashboard: Triggers tab (journal, ▶ Rehearse, the Zeal pipe card). Web: `/admin/triggers` (officer management, not live).
- **Dependencies.** Bot for guild triggers, relay, feedback (token). Prefs `enableTriggerTts`, `quietMode`.
- **Raid impact.** No visual callouts, countdowns, loot chips or Death-Touch rows; if the window is destroyed there is no voice at all.
- **State.** cfg `enableTriggerTts` (default on), `showTriggerOverlay`, `triggerBounds`, opacity, `overlayGrowUp.trigger`.
- **Caveats.** Centre is reserved (the stack is bottom-anchored); the speech watchdog is load-bearing; against an older agent `/api/fires/wait` 404s and that loop stops.

### HUD ("Me") — `me.html`
- **Identity.** key `me`, flag `showMe`; blind-forced; **not** dockable (loadConfig strips it), not in charProfiles, missing from the web `/admin/overlays` class-set list. Window title "HUD overlay" (same as the DPS HUD).
- **Data.** `/api/me` every 500 ms, repainted every 100 ms (`_serializeMeState`). Zeal 1 (level, class, resists, mana% 20, end% 21, weight, XP/AA, AA banked 71, gems 60–67, casting 134), 2 (mana 2, end 3, XP 4, AA 5, target 6, cast 7, group 11–15, pet 16, **server tick 24**, gem recast 26–33), 3 (zone, autoattack, target-of-target), 6 (group class). Log: melee/spell hits, the swing timer from "You hit/slash…" rounds, tracking lines, encounter threat for fight DPS. Bot: `fetchMobInfo` for enrage, summon, unslowable, resists, level.
- **Outputs.** Box layout (HP/mana/end/XP/AA bars, level/weight/pet, cast bar, target, class focus, fight + tonight DPS, group HP, gems with casts-left). HUD ring (target arc with enrage outline + summon 97% marker, target's target, resists, slow, HP + mana-or-end arcs, damage in/out, cooldowns, tick/swing/cast bars, hit lanes incl. damage shield + procs, tracking arrows, BLINDED ring). No speech. Writes: `overlaySetBounds` (sizes and centres its own window).
- **Surfaces.** No mini, no dock, no dashboard/web equivalent.
- **Dependencies.** Spell catalog (mana, recast, cast time); `whoData` + `_raidClassByName`; bot for target extras; `ENRAGE_PCT` hardcoded 8.
- **Raid impact.** Your own HP/mana/target/cast/cooldowns — the substitute UI while blinded.
- **State.** localStorage `wpMeStyle`, `wpMeCardBounds`, `wpHudParts` + `wpHudParts:<char>`, `wpHudPreBuild`; cfg `showMe`, `meBounds`.
- **Caveats.** Two layouts of one data set (Box, HUD; C retired); cooldowns unknown until used this session; cast time is an estimate until the gauge has a rate; sized to its window, not auto-height. **Its parts builder** (per-character parts, per-part text-size sliders, "All text" slider, per-line reset) is the closest thing Mimic has to an overlay builder today.

### Tick (was Zeal health) — `zealhealth.html`
- **Identity.** key `zeal`, flag `showZeal`; key, flag, file and bounds kept from Zeal health so nobody's placement moved (§56).
- **Data.** `/api/state` every 1 s: `serverTicks` (gauge 24 per character, `_serverTicksNow`), `charmPets` (mob ticks), `zeal.{byType,connectedPids,lastEventAt,total}` (from `/api/zeal-event` counts), `clockOffsetMs` (bot heartbeat `server_now`, four-stamp NTP), `ntpOffsetMs` (SNTP).
- **Outputs.** One server-tick row per character (a lone one reads "Server tick"), one mob-tick row per active charm ("?" / learning / ~ rough), bars or dials; status line "📡 Zeal ok · ⏱ clock 2.4s slow" (green <1 s, orange <5 s, red); detail panel = the old Zeal type table (types 1–3 critical), pid line, admin-mismatch hint, clock sentence with the `w32tm /resync` fix. No speech.
- **Surfaces.** No mini. Dock. Dashboard: the Zeal pipe card + the clock-fix button. The same ticks also appear on Charm, the HUD tick bar and the trigger window's built-in rows.
- **Dependencies.** Zeal with types 1–3; bot token for the clock offset; a charm for mob rows.
- **Raid impact.** Low: the standalone countdowns and the at-a-glance Zeal/clock check.
- **State.** localStorage `wp:tick:layout`, `wp:tick:detail`.
- **Caveats.** Two layouts on beta for the pick; the admin page still labels it "Zeal health".

### PoP raids — `popraid.html`
- **Identity.** key `popraid`, flag `showPopRaid`.
- **Data.** Static `POP_RAIDS` from `pop-raids.js`; `/api/pop-objectives` every 3 s (→ bot `/raid-objectives`), POST toggle/reset + `/api/pop-anomaly`; `/api/pop-mob-info` (→ bot `/mob-info`). No Zeal or log dependence.
- **Outputs.** Encounter header, 📣 callouts, 🎯 target stats + abilities, 💰 live drop table, ☑ shared objectives (who checked), ↺ reset (officer only), 🔗 links, hot-linked diagrams, ⚠ Quarm notes, ⚑ anomaly form; framed multi-column mode. No speech. Writes: objective toggles (raid-wide), anomalies (QOL thread), `openExternal`.
- **Surfaces.** Mini "Checklist rows". Dock. Web: `/mimic/mini` mock only.
- **Dependencies.** Bot token + reachability (unlinked: objectives local-only, POSTs 503); the mob-info catalog.
- **Raid impact.** The in-game guide and the shared objective checklist; the board still lives on the bot.
- **State.** localStorage `wp:pop:enc`, `wp:pop:framed`.
- **Caveats.** Guide numbers are estimates until verified on Quarm (PoTime phases 2–3 pending); when unlinked the drop table retries every 2.5 s forever (`loading:true`). **Found in code:** "Setup THIS" builds the key `popRaid` while every other path uses `popraid`, so per-overlay opacity/scale set from Setup THIS likely does not apply.

### Dock — `dock.html`
- **Identity.** key `dock`, flag `showDock`; `nodeIntegrationInSubFrames`; kept whenever any pane is docked; catalog `_DOCK_CATALOG`.
- **Data.** No agent fetch; IPC `dock-state` every 2 s, fit loop every 1 s; each pane is the real overlay HTML in an iframe doing its own fetching (`WP_IS_DOCKED` in the preload redirects ✕, auto-height and bounds calls).
- **Outputs.** Nameable title, pane count, ＋ panes, ▥ columns 1–3, 💾 layouts (save/load/delete/rename); per pane ▦ size (c×r up to 3×4) + background, ✕ undock, corner grip; setup mode drag-to-reorder + ↑ Grow up.
- **Raid impact.** One window holds every docked overlay: hiding or losing it blanks all of them.
- **State.** cfg `dockedOverlays`, `dockedPrev`, `dockCols`, `dockSpans`, `dockPaneBg`, `dockGrowUp`, `dockAutoFit`, `dockName`, `dockLayouts`, `dockBounds`, `overlayScaleDock`.
- **Caveats.** Trigger and HUD excluded; excluded from the global scale unless opted in. **Found in code:** `_boundsKeyForWindow` has no dock entry, so "Setup THIS" and per-overlay scale on the dock silently return false.

### Timers canvas — `canvas.html` (beta, agent 3.7.42; DECISIONS §79)
- **Identity.** key `canvas`, flag `showCanvas`; one transparent window covering a whole screen (`canvasDisplayId`, else the trigger overlay's screen, else the primary); `nodeIntegrationInSubFrames`. The first piece of the 3.0 builder (§5.3's "one freeform window", option A).
- **Data.** IPC `canvas-state` / `canvas-save` / `canvas-edit` / `canvas-next-display`. Each panel is `triggers.html?part=timers|callouts&panel=<id>` in an iframe: timers parts poll the slim `GET /api/timers` (activeTimers + recentTriggerFires + blindEvents, falls back to `/api/state` on an older agent); the callouts part also runs the fires long-poll. Routing is `window.wpCanvasRoute(t)` in the canvas: a name claim beats a group claim (`t.group`: charm / tick / lull / spell / trigger / loot) beats the catch-all.
- **Outputs.** Callouts panel (flash, votes, pinned rows), a catch-all Timers panel, a Charm panel, up to 12 panels in all; while arranging: tabs (✥ name · what it shows · ⚙ · ✕/👁), ◢ sizing, snapping, sample rows, toolbar (＋ Timers panel, ⇆ Next screen, ↺ Reset twice, ✕ Turn off, ✓ Done). **No speech:** parts never speak; the trigger window stays running hidden as the voice and, while the canvas is on, only speaks (`canvasOwnsTriggers`).
- **Surfaces.** Tray "Timers canvas" + "↳ Arrange the canvas…"; dashboard Overlays row with ✥ Arrange; own hotkey. No mini, no dock.
- **Raid impact.** When on, it IS the trigger overlay's visuals; turned off, they return to the trigger overlay. Screen-sized transparent layer: not yet measured on a raid machine.
- **State.** cfg `showCanvas`, `canvasLayouts[<W>x<H>]` (positions as screen fractions, sizes px), `canvasLastRes`, `canvasDisplayId`.
- **Caveats.** Click-through always (unlocked too) — panels take the mouse by the hover handshake; never force-shown by setup/unlock; skipped by rescue and auto-arrange. Main's pushes reach the top frame only, so a callouts part re-reads status every 5 s.

### UI Studio — `ui-studio.html` (a window; the base a builder would extend)
It edits **EverQuest's own ini files**, not Mimic overlays. Window geometry for every `[Section]` with
`XPos<W>x<H>` / `YPos<W>x<H>` across the character's bundle (`eqclient.ini`, `zeal.ini`,
`UI_/Sock_/Socials_/<char>_pq.proj.ini`, spellsets), on a black canvas at the target resolution
(colour-coded rectangles, labels, W×H, category filters; drag/resize, 10 px edge snap, clamp,
numeric X/Y/W/H). Rescale source→target (positions scale, sizes stay; skin XML design sizes only for
windows the ini gives no size). Save writes only the target-resolution block through
`_backupAndWriteFile` (`.bak-<ts>`, atomic rename); a **deferred save** applies after logout when
the character is live in Zeal (`userData/ui-studio-pending.json`, checked every 8 s). Hotbar pages /
UI inspector (hotbutton keys, socials, chat `ChannelMap` routing, macro suggestions; blocked while
EQ runs). Spell-set bulk swap. PvP sets (bundled templates, class prompt, preview, import as a `.md`).
☁ Backup uploads the plaintext bundle to the bot (`/api/agent/ui_layout`, encrypted there) with
source resolution, label and machine; 📥 Restore loads a snapshot for rescale-then-save. **No sample
data, no preview beyond the rectangle canvas, no named local layouts.** Agent fetches hard-code port
7779. Quarm has no `/saveui`; positions apply at login.

---

## 3. Findings the catalog turned up (not fixed here; logged in STATUS)

1. **DPS HUD + Threat meter never know who "you" are** — they read `s.character || s.uploaderCharacter || s.self`, none of which `/api/state` sends at the top level. The "you" highlight, the always-show-YOU row and mini's centring on you never happen.
2. **Tank's CH-chain urgency colour uses the local character's HP**, not the chain target's.
3. **Command Center rez dismissals are not applied from other clients** — only the local caller drops the row.
4. **Command Center's `hpValText` lacks Tank's `MIN_HP_POOL` check.**
5. **PoP raids: Setup THIS uses the key `popRaid`**, every other path `popraid`.
6. **The dock has no `_boundsKeyForWindow` entry**, so Setup THIS / per-overlay scale on it silently no-op.
7. **Pets is keyed `pets` in the dock/window tables but `pet` in hotkeys and class sets.**
8. **`display-removed` snaps back only eight windows** — not Tick, PoP raids, the HUD or the dock.
9. **charProfiles carry no positions, opacity or scale**, and skip five overlays.
10. **Buff queue header says a 3 s agent cache; the default is 2 s.** Charm's header still says the max duration is "not yet wired".
11. **UI Studio hard-codes port 7779**; the agent binds the first free port from 7779.
12. **The Charm overlay window has no `backgroundThrottling:false`** — only the trigger window does, and a throttled Charm window can call a break late.

---

## 4. What the builder needs from each overlay (the data contract)

The 3.0 builder (`DESIGN-mimic-3.0-overlay-builder.md`) treats an overlay as **parts bound to
signals**. The catalog above is the inventory of both. In builder terms:

| Signal family | Today's source | Cadence | Per | Sample data exists? |
|---|---|---|---|---|
| Self vitals (HP/mana/end/XP/AA, level, class, weight, gems, casting) | `/api/me` from Zeal 1+2 | 500 ms | character | no — `/mimic/mini` mocks cover some |
| Target (name, HP%, id, ToT, hit-by, level, resists, slow, mana est., HT, pacify, debuffs/buffs) | `/api/state.mobInfo`, `/api/me` | 500 ms | target | partial (`OverlayDemo`) |
| Ticks (server per character; mob per entity) | `/api/state.serverTicks`, `charmPets.mob_tick_at`, learner | 1 s + local countdown | character / entity | no |
| Timers (buff/debuff expiry, cooldowns, discs, swing, cast) | `/api/state` landings, `/api/me`, trigger `activeTimers` | 500–700 ms | entity | no |
| Fight (per-player dmg/taken/threat, boss, history) | `currentEncounterThreat`, `fightHistory` | 700 ms–1 s | fight | mocks |
| Raid (roster, targets, live state, buff/debuff queues, CH chain, DI, rez, mana) | `/api/extended-target`, `/api/buff-queue`, `/api/command-center`, `chChain`, `diStatus` | 1.5–2 s | raid | mocks |
| Pets + charm (HP, buffs, target, breaks, ticks) | `petHealth`, `charmPets` | 500 ms | owner | no |
| Zone roster (/who, target card) | `whoSnapshot` | 500 ms | zone | no |
| Casting (melody twist, casts, dirge) | `bardMelody`, `castCounts` | 600 ms | character | no |
| Alerts (fires, countdowns, votes, sticky) | `/api/fires/wait`, `activeTimers` | push | — | ▶ Rehearse exists |
| Health (Zeal types, pids, clock) | `zeal.*`, `clockOffsetMs` | 1 s | install | no |
| Guides + objectives | `POP_RAIDS`, `/api/pop-objectives` | 3 s | encounter | static |

Every row above is what a "part" would subscribe to; **none of them has a sample-data mode today**
beyond the web mocks and the trigger rehearsal — that gap is the first item in the 3.0 plan.
