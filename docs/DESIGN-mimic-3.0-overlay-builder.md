# Mimic 3.0 — the open overlay builder: research and plan

**Status: planning, opened 2026-09-27.** This is the life-cycle document for Mimic 3.0 — what is
being asked for, what exists to build on, what access the machine will need, the architecture, the
phases with honest sizes, and the questions only the guild lead can answer. The inventory it builds
on is `docs/DESIGN-overlay-catalog.md`. Decisions land in the DECISIONS file as they are made and
get folded back here.

## 1. The ask, in the guild lead's words (2026-09-27)

> "every component of the overlays (data sources and outputs and displayed surfaces or dependencies
> or raid impact) need to be cataloged in a master overlay design doc and then prepared for an open
> overlay builder system that I want to develop for a 3.0 release for mimic."

> "the overlay should feel both Taylor-made for the user but configurable in every aspect of the
> displays that matter. scaling, awareness of screen resolution and UI elements in the game."

> "this will require more access most likely, be it the ability to see the output on the screen or a
> direct tie in to the EQ game. start a full life cycle research and planning cycle to accomplish
> this. the 3.0 release is a big audacious goal that would be ideal to complete before October 1st,
> the planes of power release."

> "this can be an extension of the UI builder, but it needs to be a lot smarter than it is now.
> elements should have displayed sample data in them, and options for how much to display when
> building. but we should also be able to build out overlays on the fly, have it optionally snap to
> other windows inside the EQ client from native or zeal. usability and adaptivity to a specific
> character's abilities, clickies, levels, etc all need to be accounted for"

Earlier (DECISIONS §36, 2026-09-26): *"a HUD/overlay builder engine where we could combine
everything into a single transparent freeform view, or be able to have it see the screen and move
windows accordingly … in fact that will be 3.0."*

## 2. Requirements, numbered so the phases can point at them

| # | Requirement | Where it comes from |
|---|---|---|
| R1 | Every display element is a **part** that can be placed, sized, scaled and styled on its own | "configurable in every aspect of the displays that matter" |
| R2 | Parts show **sample data while building**, and offer **how much to display** (density: full / compact / number-only) | "elements should have displayed sample data … options for how much to display" |
| R3 | **Build overlays on the fly** — compose parts into a new overlay without a release | "build out overlays on the fly" |
| R4 | **Snap** to EQ's own windows (native UI) and Zeal's windows, optionally | "snap to other windows inside the EQ client from native or zeal" |
| R5 | **Resolution and screen awareness**: layouts keyed to the display and the game resolution; DPI; multi-monitor | "awareness of screen resolution and UI elements in the game" |
| R6 | **Tailor-made per character**: parts appear, hide or change with the character's class, level, spells, discs, clickies | "adaptivity to a specific character's abilities, clickies, levels" |
| R7 | The existing 17 overlays keep working through the transition, and each becomes a **preset** in the builder | the catalog; every raider's saved layout |
| R8 | The builder is an **extension of UI Studio**, not a fourth doc root or a parallel tool | "extension of the UI builder" |
| R9 | Mid-raid cost stays where it is: no new per-frame work while EQ has the screen | CLAUDE.md's overlay rules; "read mid-fight" |
| R10 | Ships on an **alpha channel** first, to volunteers, with the LKG rollback the beta channel has | DECISIONS §36 |

## 3. What exists to build on (from the catalog)

- **UI Studio** already: parses the character's ini bundle, draws EQ's window rectangles on a
  resolution-sized canvas, drags/resizes/snaps them (10 px to edges), rescales between resolutions,
  saves atomically with backups, defers a save until logout when the character is live, backs the
  bundle up to the bot and restores it. It lacks: sample data, Mimic's own overlays on the canvas,
  live geometry of the EQ window, and any notion of parts.
- **The HUD's parts builder** (`me.html`): a ring made of parts, per-character part sets, per-part
  text-size sliders, an "All text" slider, per-line reset, three sizes. It is the only place Mimic
  already treats a display as a set of parts. It is the seed of R1/R2.
- **Panel overlays** (`createPanelOverlay`): any dashboard panel becomes a window by key. Proof
  that "an overlay is content + a window" is already separable.
- **The Dock**: hosts overlays as iframe panes with a column grid, spans, backgrounds and named
  layouts — the compat path for R7 (an existing overlay can be a "part" that is an iframe).
- **Auto-arrange**: reads `UI_<Char>_*.ini`, takes the dominant `XPos<W>x<H>` block, projects the
  game's rectangles onto the home display, packs overlays into free space. It is R4/R5 in embryo,
  with two known holes: Mimic does not know where the EQ *window* is, and it assumes the game runs
  at the ini's resolution on the home display.
- **Character knowledge already on the platform**: class + level (Zeal labels 2/3, /who), spellbook
  and known spells (`character_missing_spells`, the spellbook file split), inventory + clickies
  (the Quarmy export / `/output inventory`, `item-clickies` catalog), discs (`logsync.hud-timers`),
  raid role (type 5). R6 has its data; it lacks the wiring.
- **Class-set seeding + charProfiles**: a one-time per-class default set of overlays, and per-
  character visibility flags. R6's ancestor; it carries no positions, opacity or scale.
- **Sample data, today**: the web `/mimic/mini` mocks and `/about` OverlayDemo (static), and the
  trigger window's ▶ Rehearse. Nothing in Mimic itself.
- **Screen awareness, today**: Electron `screen.*`, a screen signature on saved bounds, display
  change handling for eight windows.

## 4. The access question — what more the machine needs, and what each option costs

Costs are the four numbers the guild lead asks for: **build** (time to get right), **maintenance**
(how it breaks as things change), **runtime** (what it costs mid-raid), **change** (how hard to
revise later).

### A. No new access: EQ's own ini files + display info (what auto-arrange does)
EQ writes every window's rectangle per resolution to `UI_<Char>_pq.proj.ini` on camp/zone/quit;
`zeal.ini` carries Zeal's windows. Project those at the game's resolution onto the display the game
is on.
- Build **low** (the parser and projection exist). Maintenance **low**. Runtime **none**. Change **easy**.
- Limits: positions are as of the last write, not live; no EQ *window* position when the game runs
  windowed and is moved; nothing about the game's actual on-screen scale if it is not fullscreen.
- **Verdict: the alpha ships on this.** It covers the fullscreen and borderless cases, which is
  how the raid plays.

### B. Live EQ window geometry through a small Windows helper
`user32.GetWindowRect` for the `eqgame.exe` window (and its client area), polled every 1–2 s only
while the builder is open or a layout is being applied. Two ways to call it: PowerShell (Mimic
already shells to PowerShell for exact memory) — zero dependencies, ~100 ms per call; or a prebuilt
FFI addon (`koffi`) — a dependency on the desktop app only, never the zero-dep agent.
- Build **low–medium**. Maintenance **low** (Win32 does not move). Runtime **small** and only when
  arranging. Change **easy**.
- Gives: exact projection when windowed or moved, DPI-correct scale, multi-monitor certainty.
- **Verdict: phase 2.** PowerShell first; the addon only if the latency bites.

### C. Seeing the screen: capture + recognise
`desktopCapturer` exists (feedback screenshots). Locating EQ windows by *looking* would mean
template matching against UI skins (which vary per player), OCR for labels, and a capture per
second while arranging.
- Build **high**. Maintenance **high** (every skin, every Zeal UI change). Runtime **high** if ever
  used mid-raid. Change **hard**.
- **Verdict: not for layout.** Worth one narrow tool: a self-check that captures the screen once
  and shows the raider "here is what Mimic thinks is where, over what is actually there", so a
  wrong projection is obvious. That is validation, not sensing.

### D. A direct tie-in to the game: Zeal
Zeal is already inside the process; it holds the `CXWnd` tree with every window's live rectangle,
visibility and the UI scale. A new pipe message type ("ui windows": name, rect, visible, per
window, on change) is a small C++ addition on the fork the guild already maintains, and the
cleanest possible data.
- Build **medium** (C++ on the fork, then the agent side). Maintenance **low**. Runtime **none**
  (pushed on change). Change **medium** (an upstream surface).
- Limit: **fleet adoption**. Spawn ids on the pipe took a week to reach 11 of 19 uploaders; a new
  message reaches only raiders who update Zeal. So it can never be the only source.
- **Verdict: file the upstream ask now, build on A+B, take D when it lands.** Rewrite it against
  `named_pipe.cpp` the way CLAUDE.md says the spawn-id ask should have been.

**Decision proposed:** A now, B in phase 2, D as the standing upstream ask, C as a one-shot
self-check only. Nothing here reads game memory from Mimic itself, and nothing injects into EQ —
the platform's line (Zeal is the only in-process code) does not move.

## 5. Architecture

### 5.1 An overlay is a spec
```
overlay:  { id, name, version, displayKey, resolution: "1920x1080",
            anchor: { to: "screen" | "eqwindow:<Name>" | "zealwindow:<Name>" | "overlay:<id>",
                      edge: "top-left" … , offset: {x,y} },
            parts: [ { id, type, signal, density: "full"|"compact"|"number",
                       pos: {x,y}, size: {w,h}, scale, style: {...},
                       visibleWhen: { class: [...], minLevel, hasSpell: [...], hasClicky: [...], inRaid: bool } } ],
            look: { opacity, bgAlpha, backdrop, theme } }
```
Saved per character and per resolution the way EQ keys its ini (`XPos1920x1080`), backed up with
the UI Studio bundle so ☁ Backup / 📥 Restore carry overlays too.

### 5.2 Parts bound to signals
A **signal registry** in the agent: one named, typed, documented stream per row of the catalog's
data contract (self vitals, target, ticks, timers, fight, raid, pets/charm, zone roster, casting,
alerts, health, guides). Each signal declares its cadence, its Zeal/bot/log dependencies, and a
**`sample()`** generator (R2). The existing endpoints stay; the registry maps onto them, so no
overlay breaks while parts are added.

A **part** is a renderer for one signal at one density: a bar, a ring arc, a number, a countdown, a
list, a chip row, a lane. The HUD's parts are the first library; Tank's cards, Target Info's
header, Charm's tick rows, Extended Target's rows follow. **Compat part**: an existing overlay's
HTML in an iframe (the dock already does this) — every overlay is usable in the builder on day one
(R7), and is replaced by real parts one at a time.

### 5.3 The window question (needs the guild lead's call)
- **Many windows** (today): one `BrowserWindow` per overlay. Click-through and always-on-top are
  per window and work; each window costs a compositor surface; the dock shows it composes.
- **One freeform window**: one transparent full-screen window holding every part. Fewer surfaces,
  free-form placement, parts can overlap the centre deliberately. But click-through is per
  *window* in Electron (`setIgnoreMouseEvents`), so a freeform window needs `forward: true` plus
  JS hit-testing per part to decide when to take the mouse — the same handshake every button does
  today, generalised. And one window means one crash takes every part.
- **Recommendation:** parts render into **overlay windows the spec defines** — a spec may hold one
  part or thirty — so both are the same engine. The alpha keeps one window per overlay preset;
  the freeform view is a spec whose anchor is the whole screen.

### 5.4 The builder (UI Studio, extended)
The same canvas, with three layers: the game's windows (from A, later B/D), Zeal's windows, and
Mimic's overlays as draggable rectangles. Snapping (R4) to any rectangle's edges and centres, and
to a grid; snap targets are toggles. A part palette on the side with **live-or-sample** preview
(R2) and a density switch. "Build new overlay" starts an empty spec (R3). Save writes the spec
per resolution; "Apply" pushes it to the running windows without a restart. Per-character
recommendations (R6) come from the character profile: class and level decide the default part
set, and `visibleWhen` hides what the character cannot use (a cleric sees no Rampage lane; a
level-20 alt sees no discs).

### 5.5 Sample data
Every signal ships a `sample()` that produces the shape the live stream produces, seeded from
real captured shapes (the `/mimic/mini` mocks, OverlayDemo, and one recorded raid minute per
signal, names replaced by the convention names). The builder runs the overlay against samples
when the live signal is silent, and says so in the corner. The trigger window's ▶ Rehearse is
the model.

### 5.6 Resolution awareness
Layouts are keyed `displayId × WxH` like the ini blocks. Rescale between resolutions the UI Studio
way (positions scale, sizes stay, then clamp). DPI from `screen.getDisplayMatching`. A display
change re-projects instead of snapping back to the primary (the catalog's finding #8 closes with
this).

## 6. Phases, sized honestly

Sizes are working sessions, not calendar days; a raid night removes an evening.

| Phase | Delivers | Requirements | Size |
|---|---|---|---|
| 0 | This plan + the catalog | — | done 2026-09-27 |
| 1 | **Alpha channel** (updater channel, opt-in, pruned releases, LKG rollback); **signal registry** with `sample()` for every catalog row; the two identity bugs fixed first (the "me" key the DPS HUD/threat meter never get; the active-character flip-flop made focus-based) | R2, R10 | 3–5 sessions |
| 2 | **Builder canvas v1** on UI Studio: EQ + Zeal window rectangles from the ini (A), Mimic's overlays as rectangles, snapping, per-resolution save, "Apply" without restart; Win32 geometry helper (B) behind a toggle | R4, R5, R8 | 4–6 sessions |
| 3 | **Parts library v1**: the HUD's parts generalised; Tank, Target Info, Charm and Tick as parts; compat parts for the rest; density per part; the first "build new overlay" flow | R1, R3, R7 | 6–10 sessions |
| 4 | **Adaptivity**: character profile (class, level, spells, clickies, discs) → default sets and `visibleWhen`; per-character, per-resolution layouts in the cloud backup | R6 | 3–5 sessions |
| 5 | **Zeal "ui windows" upstream ask** (D) and the one-shot screen self-check (C, narrow) | R4, R5 | 2–3 sessions + upstream time |
| 6 | Graduate: every raider's saved layout migrated to a spec; the old per-overlay code paths retired | R7, R9 | 3–5 sessions |

**Total: roughly 21–34 sessions.** At this session's pace that is five to eight weeks of evenings.

### October 1 — what is and is not possible
It is 2026-09-27. There are four days, one of them a raid night (Sunday) with its deploy freeze.
**The full 3.0 is not achievable by October 1**, and saying otherwise would be the wrong kind of
optimism. What *is* achievable, and worth doing so PoP opens with something real in raiders'
hands:

- **3.0-alpha.1 by October 1:** phase 1 in full (the alpha channel, the signal registry with
  sample data, the two identity fixes), plus the first cut of phase 2 (the builder canvas showing
  EQ's windows and Mimic's overlays together, snapping, per-resolution save, sample data in the
  existing overlays while arranging). That is "arrange every overlay you already have around your
  actual EQ windows, at your resolution, with fake numbers showing so you can see the shapes" —
  a visible step raiders can feel, and every later phase builds on it.
- Phases 3–6 follow PoP, one beta at a time, the same way the HUD went through eight rounds.

## 7. Risks and the rules that stay

- **Mid-raid performance (R9).** A part that repaints every 100 ms times thirty parts is the DPS
  HUD problem again. Parts repaint on signal change only; countdowns tick locally from absolute
  times (the Tick overlay's pattern). Byte-stable HTML across polls stays the law.
- **Click-through.** Every clickable part does the hover-interact handshake, or its clicks land in
  EQ. The builder generates it; a hand-written part that forgets is the checklist's oldest bug.
- **The trigger window's lifetime.** Speech lives in a window that must exist even when nothing is
  shown. The alerts part must not break that.
- **Two doc roots.** This doc and the catalog are the 3.0 authority under `CLAUDE.md`; `/impeccable
  init` stays un-run; no `PRODUCT.md`/`DESIGN.md`.
- **UI gets options.** Each builder screen goes to the alpha as two genuinely different designs
  when it is a design question; a data panel is not one.
- **Zeal adoption lag.** D is additive; A+B must work without it.
- **Sample data drift.** A `sample()` that no longer matches its live shape is a test failure, not
  a surprise: each signal's test runs the renderer against both.
- **The fixture rule.** Sample names are the invented convention names, never members.

## 8. Questions for the guild lead (the plan cannot proceed past phase 1 without them)

1. **One freeform window, many windows, or both** (§5.3)? The recommendation is both from one
   engine, alpha ships many.
2. **Snap targets**: EQ windows and Zeal windows only, or also other Mimic overlays and a screen
   grid?
3. **Which overlays become real parts first** after the HUD's? The proposal: Tank, Target Info,
   Charm, Tick, then Extended Target.
4. **The Zeal "ui windows" ask** — file it upstream now (it needs the fork's maintainer time), or
   after the alpha proves the builder?
5. **Alpha testers**: who gets the alpha channel first? A handful of raiders on different
   resolutions and window modes is worth more than everyone.
6. **"See the screen"** — the plan reads it as geometry (where the windows are), not vision (what
   the pixels say). If it meant OCR of game text, that is a different project and should be said.
7. **Is 3.0-alpha.1 by October 1 (§6) the target**, or should October 1 stay a stable-2.7.x date
   with 3.0 work starting after PoP settles?
