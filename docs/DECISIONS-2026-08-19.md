# Decisions — 2026-08-19 (Tuesday-night / Wednesday-morning beta session)

A long live-iteration session with Hitya testing the overlay-size feature on
beta (beta.8 → beta.13), plus a melody parser fix, a /who class fix on main,
and a new durable UI rule. `DECISIONS-2026-08-14.md` holds the CH-chain and
raid-night write-ups; this file carries the **Open — read this first** table
forward.

---

## Tray ↔ dashboard parity is now a RULE (Hitya)

**The call:** *"Anything that's available from the taskbar should be available
from the dashboard as well."* Named instance in the same breath: *"Overlay
layouts should be saves and in the overlay tab."*

**Why:** the tray menu is where features go to be forgotten — the per-character
layout saves existed since v1.2 and Hitya met them tonight. The dashboard
Overlays tab is where people actually look.

**Where it landed (agent 3.5.91 + mimic, beta):** 💾 Per-character overlay
layouts card (auto-swap toggle, save-for-active-toon, saved chips with forget
✕), Lock/Unlock + Setup-mode + Hide-all buttons on the actions row, and a Dock
row in BUILT-IN OVERLAYS (Hitya: "Dock isn't available from the built in
overlays page"). All drive the SAME internals as the tray items — never a
parallel path. **Remaining tray-only items are a queued audit** (STATUS):
quiet mode, tells mode + DM pause, melody bard-only / AE-damage toggles,
auto-arrange-on-show, start-with-Windows, check-for-updates.

## Overlay size — the shape that survived three rounds (Hitya, live)

1. **Where sliders live:** dashboard Overlays tab ("Size — all overlays") +
   one per overlay in its setup bar (override, ↺ follows global) + Settings.
   Settings-only was rejected on sight.
2. **A scale change resizes the WINDOW with the zoom** (center-anchored,
   work-area clamped) — zoom inside fixed bounds broke card edges/centering.
3. **Sliders apply on release and the overlay GLIDES (~180ms).** "Smooth
   slider" checkbox = the glide itself, **default ON** (Hitya: "being off to
   glide doesn't make sense"); off = snap. The earlier live-follow mode is
   gone — it's what made the checkbox read backwards.
4. **The dock does NOT follow the global scale by default** (Hitya: "don't
   change the [dock] with the scale by default") — "Scale the dock too"
   checkbox opts in. The dock's fit loop also needed the CSS→painted unit
   conversion (the 130% grow/shrink churn).
5. **Setup chrome counter-zooms** (Hitya: "the actual slider sizing shouldn't
   change on the overlays — it should be the width of the window"): main
   pushes the live zoom (`wp-zoom` → `--wp-zoom`), preload CSS cancels it on
   the setup bar + drag controls, so setup UI keeps one painted size spanning
   the window at every scale.

## "Wireframe overlays" is the UNLOCKED state, not a build difference

Hitya's machine showed every overlay as a colored outline + ✥🔒 buttons while
Fittir's looked normal: `cfg.overlaysLocked=false` PERSISTS, and unlocked
**force-shows every overlay** for placement (`_overlayForcedOn`). That also
explains "it says hideall is on but its not" — hide-all's flags were off, but
unlock overrode them visible. Two responses: the dashboard now has the
Lock/Unlock + Show-overlays buttons to land the state in one click, and
`_healMootHideAll` clears a hide-all whose snapshot has nothing left to
restore (flags re-enabled one-by-one bypassed `toggleHideAllOverlays` and left
the persisted `hideAllActive` lying to the tray + dashboard banner).

## Melody AE badge counts one pulse; damage rides the chip (Fittir via Hitya)

⚔123/12 was pulses merging: burst boundaries used wall-clock arrival and the
EQ client flushes the log in multi-second batches under swarm-kite load.
Bursts now clock off the LINE's own timestamp (`SONG_AOE_PULSE_GAP_MS`,
`test/song-aoe-pulse.test.js`). The asked-for display shipped with it:
per-hit damage + Σ running kite total per song (resets after 30s quiet), tray
toggle "Show AE song damage", **default ON** (agent 3.5.88).

## /who shows base classes, never level titles (bot 3.1.55, main)

"Warlock" on an anon row = the level-60 Necromancer TITLE served raw from
who_observations history via who-lookup. Folded through
`utils/classTitles.normalizeClass` at the serve boundary;
`test/who-lookup-class-titles.test.js` pins the bot map ↔ agent CLASS_TITLES
mirror to each other (both said "keep in sync"; nothing enforced it).

---

## Open — read this first

| Item | State |
|---|---|
| **Tray↔dashboard parity audit — remainder** | Rule ratified today (above). Shipped: layouts card, lock/setup/hide-all, dock row. Still tray-only: quiet mode, tells mode + DM pause, melody bard-only / AE-damage toggles, auto-arrange-on-show, start-with-Windows, check-for-updates. Port them to the Overlays/Settings surfaces of the dashboard in one pass |
| **Beta line needs a field pass on today's batch** | beta.13-ish carries: size sliders ×3 surfaces + glide + counter-zoomed setup bars, dock scale opt-in, melody kite chips, layouts card, hide-all heal. Hitya + Fittir are live-testing; watch for reports before graduating anything. Fittir's 5K at 200% still needs a real-hardware hover-target check |
| **P1 recovery tail (bot 3.1.52)** | 4 backfill requests (Chadivarius/Bardtholemu/Dafeet/Lowang) recover **The Final Arbiter** — all still `pending` (none has relaunched Mimic). Hitya's own re-run heals Progenitor + Master of the Guard. Verify cards as they land. Stage branch `claude/sharp-lamport-dC0TW-stage-web-1-1-62` still needs deletion from a local session (cloud 403s ref deletes) |
| **3-tick short raids until PoP (Hitya, 2026-08-16)** | Alt raids and Seru+misc nights run 3 ticks / 2 hours until PoP. Tick math unaffected; deploy freeze deliberately full-length. Tonight (Wed) is a raid night — freeze 19:30–00:30 ET |
| **Architect's rebuild — O1 remains** | Ratchet backlog (ARCHITECT doc Part II), Discord-projection migration order (state.json → roster → hate → parses), O1 review 2026-12-01 (task #41) |
| **Data Sentinel — designed, awaiting go** | Two loops (invariant battery in the bot + post-raid judgment sessions), `docs/DESIGN-sentinel.md`. Needs officer-thread choice + go (task #42). Founding invariant: "combat uploads arriving, zero encounters persisted" |
| **Guild membership in front of personal tooling?** | Hitya's call on shape: guest role vs personal tier vs Mimic-only (task #40) |
| **Task #27 — the 8 muted trash triggers** | Gate is "the fleet is on the fix". Restore on Hitya's word — raid-noise call |
| **Dead-triggers runbook needs re-measuring** | Agent 3.5.46+ auto-heals bare-`^` anchors at compile; the Aug-4 "37 of 109 dead" measurement predates it. Re-measure before acting on `docs/RUNBOOK-dead-triggers.md` |
| **`dot_stacking_exempt` backfill** | Local session: `SELECT id, dot_stacking_exempt FROM spells_new;` from the peq DB, spot-check vs PQDI (Immolate=0 / Breath of Ro=1) |
| **Item icons DISABLED — needs the EQ machine** | Atlas maps to wrong ids (633 = boots → shovel). Repack + verify before re-enabling (task #36) |
| **Zeal `EPERM` → ask about compat mode FIRST** | XP compat mode on eqgame.exe kills the pipe; the guide we recommend suggests turning it on |
| **#204–#207** | Graduate to stable after beta test + one raid cycle (task #31) |
| **Caustic Mist on Zlandicar's shared Putrefy line** | Fires on the shared text; no text-level fix exists — scoping is Hitya's call |
| **Mob Info DoT grouping (task #44)** | Group DoTs by class, collapsible, per-tick per line + class totals — beta |
| **`docs/DESIGN-eql-support.md`** | Stranded on `claude/sharp-lamport-dC0TW` — land it or drop it |
