# Mimic overlay motion, just-in-time overlays, and overlays attached to the game's own windows — design

**Status: DRAFT, written 2026-10-24 from `main` `835390ff` (Mimic stable 3.0.4, agent 4.0.20). Nothing here is built.**
Target: the next Mimic **minor** (3.1). The picks the plan needs are in section 9; sections 2-5 each carry
their own options with the four costs.

The guild lead, 2026-10-24: *"plan fill [sic] overlay motion for our next minor release and start working on some cool
animations. laser beam entering from the side, a gold outline slicing into the screen, them off when not needed."*
and *"just in time overlays, on demand overlays that are responsive. expand with more data and details based on
what's happening. put the pet information attached to the in game buttons, chat locked into the chat entry point
providing tabs that aren't available now on the main client. no automations come back into the client."*

Read with: `CLAUDE.md` (the overlay rules and the parity checklist), `docs/DESIGN-mimic-3.0-overlay-builder.md`
(R12-R14 are the anchoring requirements this doc picks up), `docs/DESIGN-overlay-catalog.md` (every overlay's data).

---

## 0. Framing, and the one rule that does not bend

Mimic's overlays today are 21 frameless, transparent, always-on-top windows (`_OVERLAY_WINDOWS` in
`apps/mimic/main.js`; plus panel overlays and chat breakouts) that appear when a flag, the EQ gate and the lock state say so, and are otherwise
silent. This asks for four things on top: the overlays **arrive with a short, deliberate piece of motion**; they
**show themselves only while something is happening** and grow detail as more happens; the **pet** overlay
sits against EverQuest's own pet window; and **chat** sits at EverQuest's chat entry point with tabs the stock
client cannot offer. The platform already has most of the parts (section 1). The new work is mostly joining them,
plus one genuinely new thing: a small motion layer.

> **RULE — nothing goes back into the client (the guild lead, 2026-10-24).** Mimic reads EverQuest (the log
> files, the Zeal pipe, EQ's window rectangles and its ini files) and **displays**. It never sends a keystroke, a
> mouse click, a chat line or a command into the running game, never drives a macro or a hotbutton, and never
> writes to the Zeal pipe. A tab, a chip, a pet readout or a docked strip changes what **Mimic** draws and
> nothing else. Features in this doc are designed so that holds by construction, not by promise.

Where the code already upholds it (grepped on `835390ff`; expect these to stay true, and re-grep before a release):
- **No input synthesis.** `apps/mimic/*.js`, `apps/mimic/package.json` and `packages/wolfpack-logsync/index.js`
  contain no `robotjs`, `nut-js`, `SendInput`, `SendKeys`, `keybd_event`, `PostMessage`, `uiohook`, FFI addon, or
  keyboard-automation dependency. The one `sendInputEvent` (`main.js`, the `tooltip-refresh` handler) sends a
  synthetic mouse-move **into the overlay's own web page** to clear a stuck tooltip; it cannot reach EQ.
- **The pipe is read-only.** The header of `apps/mimic/zealPipe.js`: "It NEVER writes to the pipe (Zeal opens it
  PIPE_ACCESS_OUTBOUND anyway)". The agent says the same in words next to `clientVersionsSnapshot()`:
  "we never inject commands into the game".
- **Windows calls are reads.** The PowerShell Mimic spawns reads EQ's window rectangles
  (`_EQ_GEOM_PS`: `GetWindowRect`/`GetClientRect`/`ClientToScreen`/`IsIconic`), the foreground window's pid
  (`_focusScript`: `GetForegroundWindow`), process lists and drive lists. None of it calls `SetForegroundWindow`,
  posts a message to EQ, or touches its input queue.
- **`/pipe mimic ...` flows the other way.** The raider types it, Zeal forwards it to the pipe as a custom
  message, Mimic reads it. The player is the one acting.
- **The nearest neighbour, stated so nobody is surprised:** UI Studio and the Zeal/UI-pack updater **write files**
  in the EQ folder (`iniKeyEdits.js`, `uiLayouts.js` `switchTo()`). Those are explicit, user-clicked edits that are
  **queued until after logout** when EQ is running (EQ rewrites its UI ini on camp/zone/quit anyway). They are not
  live control of a running client. This doc adds **no** new writer to EQ's files: the anchoring in sections 4-5
  only reads the ini.

Two corollaries the features below respect: an overlay beside EQ's chat or pet window must **never take keyboard
focus from EQ** (a stolen focus is the nearest thing to an input back into the game), and an overlay that sits near
EQ's clickable buttons must be click-through while locked, so a click meant for a real button lands on the real
button.

---

## 1. What exists, so we extend it instead of rebuilding it

| Need | Already in the repo | Where |
|---|---|---|
| A show-when rule per overlay piece | **Canvas "show-when" rules** (DECISIONS section 187 rule A; Charm's "When charming" piece is in section 410): `WHEN` = combat / out of combat / have a target / NPC target / in a raid / when charming, plus a class filter; a false rule hides the panel (`.panel.wh{visibility:hidden}`), an unknown signal keeps it shown, arranging shows everything; combat pieces linger `COMBAT_HOLD_MS` = 8 s | `apps/mimic/canvas.html` (`WHEN`, `whenSignals`, `whenHolds`); test `test/canvas-show-when.test.js` |
| The same idea on a standalone overlay | **Charm "Show: Always / When charming"**: the agent answers `charmSession` on `/api/state` (held `CHARM_SESSION_HOLD_MS` = 10 min); the page toggles `body.wp-idle` (display none) **while the window keeps polling** | `charm.html` (`charmIdle`, `applyIdle`), agent `_charmSessionStep` / `_charmSessionNow`; registered for Sets in `setupBundle.js` (`wpCharmShowWhen`) |
| Smaller / larger renditions | `body.wp-mini` (a per-overlay compact rendition), `overlay-auto-height` (the window fits its content, both directions, zoom-corrected), parts "density" (full / compact / number-only) | `preload.js` `_WP_MINI_CSS`; `main.js` `overlay-auto-height`; `parts.js` |
| Where EQ's window is | `_eqWindowGeometry()` (PowerShell + user32, DPI-aware, **on demand and cached 3 s, never polled**), `_eqMainWindow()`, IPC `eq-window-geometry` | `main.js` ~4637-4710 |
| Where EQ's own windows are inside it | `_parseUiWindowRects()` reads the freshest `UI_<Char>_*.ini`, projects the per-resolution `XPos<W>x<H>` / `YPos` / `Width` / `Height` onto EQ's client area; `uiClearRects.js` `visibleUiRects()` does the same for shown windows with skin sizes | `main.js` ~5721-5830; `apps/mimic/uiClearRects.js` |
| Chat window geometry and the "always chat here" window | `[ChatManager]` `ChatWindow<N>_AlwaysHere`, `[MainChat]` / `[Chat N]` geometry blocks, already parsed for UI Studio | `main.js` ~6820-6910 |
| Chat as tabs | Chat overlay: one feed, **a chip per group**, right-click to **break a group out into its own window** (`chatBreakouts`, `_syncChatBreakouts`); the agent says "a tab is a group plus a filter" (`CHAT_GROUPS`). Groups today: Guild, Raid, Say, OOC/Shout, Auction, NPC, Zones, Tells, Group, Officer, Custom, Melee, Spells, Skills, Loot, Random, Other and its splits (Money, Emotes, Pets, Who, Deaths, Broadcast, Zeal) | `chat.html`; agent `CHAT_GROUPS`, `GET /api/chat` |
| Pet data | Pet HP and name (Zeal gauge 16), the pet's buffs (`pet_buffs`), pet target, attack signature (`#petstats`), charm ticks, on `/api/state` | `pets.html`, `charm.html`; agent |
| One-shot animation precedent | `pop`, `timer-pop`, `nudge` (triggers.html), `go-pulse` / `pivot-pulse` (chchain.html), `locpulse` (canvas.html); `prefers-reduced-motion` guards in `chchain`, `command`, `me`, `melody`, `parts.js` | the html files |
| A way to keep clicks off EQ's keyboard focus | `focusable: false` (Windows `WS_EX_NOACTIVATE`) on the CH chain window, with a comment saying it is "safe to extend to the other read-only overlays once we've validated this one in a live raid" | `main.js` `createChChainOverlay` |
| Software-drawing fallback | `cfg.disableGpu` -> `app.disableHardwareAcceleration()`, read at start | `main.js` ~139 |

What does **not** exist: any entrance or exit motion for a window appearing (the animations above are all
in-content), a shared place for "when is this overlay wanted" on standalone windows beyond Charm, any link between
an overlay and a specific EQ window other than the Map's keep-clear rectangles, per-tab unread counts in Chat (only
the single "new below" counter `_unread`), and a live rectangle for any EQ window other than the outer one.

---

## 2. Feature 1 - Motion: the laser beam and the gold outline

### 2.1 What it is, concretely
When an overlay **appears** (a window shown, or a piece going from idle to wanted) it plays one short entrance, once:
1. a thin **beam** enters from the screen edge nearest the overlay and sweeps across the overlay's width;
2. a **gold outline** traces the overlay's border in the beam's wake (*"slicing into the screen"*);
3. the surface **fills** (background and content fade up under the outline) and the outline fades out.
Total target **<= 450 ms**, never looped. The reverse is a short fade, only where a CSS exit is possible (2.4).

### 2.2 Where it would live
- **One shared motion layer injected by `apps/mimic/preload.js`**, next to `_WP_MINI_CSS` (the preload already
  injects shared overlay CSS at ~line 400-440, driven by `--wp-content-alpha`). Every overlay gets it from one
  place; an overlay opts out with an attribute, the way `wp-mini` is opt-in by class. No per-overlay edits for the
  base effect.
- **The trigger** is main's existing `win.on('show')` hook in the `browser-window-created` handler (it already
  runs `_applyOverlayZ(win)` on every show) -> `webContents.send('wp-appear', { edge })`. `edge` ('left' or
  'right', and 'top'/'bottom' for tall-narrow windows) is computed from `win.getBounds()` against
  `screen.getDisplayMatching(...).workArea`, so the beam always comes from the side the overlay is nearest to.
  A renderer-level change (feature 2's `wp-idle` going off) calls the same entry point locally.
- **Settings:** `cfg.motion` = `full` | `calm` | `off`, pushed to renderers the way `bg-alpha` / `content-alpha` are
  (`applyAllOverlayOpacities`). **Tray <-> dashboard parity rule:** a tray item **and** a control on the dashboard's
  Overlays tab in the same change, driving the same internals.
- **Not animated:** anything while unlocked, in setup, arranging or dragging (a moving target plus a beam is noise);
  the trigger overlay's alert chips (they have their own `pop` / `timer-pop`); the Map in Full mode; the Canvas
  window itself (only its panels, option B); a window that reappears after hide-all, a set load or the EQ gate
  flipping (one beam per overlay, twenty at once, is a light show over the game). **Loudness budget** (DECISIONS
  section 187 lists "loudness budget" as a Canvas rule still to do): at most one entrance at a time, 250 ms apart,
  and none within 3 s of the same overlay's last one, so a flapping rule cannot strobe.

### 2.3 The constraints it must respect (all from `CLAUDE.md` and the frontend-design skill)
- **Click-through stays click-through.** The effect is drawn inside the window's own DOM and never calls
  `setIgnoreMouseEvents`, so a locked overlay stays `setIgnoreMouseEvents(true, {forward:true})` the whole time.
  The ✥ move button stays present and on the hover handshake; the effect layer is `pointer-events:none`, sits under
  `#move-btn` / `#hide-btn`, and the parity checklist is untouched (no new overlay, no new clickable thing).
- **Hide-all and the EQ gate win.** The effect is cosmetic; it does not change `_HIDEALL_FLAGS`, `_overlayWanted`
  or `_eqGateOk`. A window hidden by any of them plays nothing.
- **Never animate the window.** Sliding the BrowserWindow itself with `setBounds` per frame is rejected: 60
  native moves a second over EverQuest, and the `moved` / `resize` listeners (`_persistBounds`) would save
  mid-animation positions as the overlay's home, and `_holdForMove`, Rescue and the screen-change prompt would all
  see a window in motion. Everything moves **inside** the window.
- **Cost on a machine running EQ.** Overlays are layered windows composited over a DirectX game; an idle one is
  cheap, a continuously repainting one is the DPS-HUD problem again (R9). So: one-shot only (no `infinite`), no
  looping glow, `transform` and `opacity` for everything that moves (compositor work, no layout), a static
  `box-shadow` (never animated), and no animated `filter`. Honest unknown: the cost of one entrance on a raider's
  actual machine is **unmeasured** (as `_eqWindowGeometry`'s per-call cost still is). Slice 0 builds the measurement
  before the effect ships on by default: sample `app.getAppMetrics()` (GPU and renderer CPU) across 20 entrances
  on a loaded machine.
- **`prefers-reduced-motion` and a motion setting.** Reduced motion -> no beam, no trace, just a 120 ms fade. Chromium
  is expected to follow Windows' "Show animations" setting; **unverified on our Electron build**, so `cfg.motion`
  is the authority and the media query is the default's input. `disableGpu` (software drawing) defaults motion to
  `calm` for the same reason. `off` is a real setting, one click from the tray.
- **Motion is a cost, not a delight** (the frontend-design skill; overlays are read mid-raid in peripheral vision).
  The guild lead asked for this on purpose, so it is built, but kept to arrival moments; the screen centre stays
  quiet (the beam runs along the overlay's own row, from the nearest edge, never across the middle of the screen
  unless the overlay is there).
- **Colour is semantic.** `gold` (`#d29922`) is the platform's "roll values, highlights". A transient gold
  outline adds a second, short-lived meaning, "this just arrived", which does not collide with a roll value that
  stays on screen. It is used only for the entrance. The beam takes the overlay's own title accent (Pets `#79c0ff`,
  Chat `#7ee7c7`, ...) so it is not a second loud colour; red is never used (red means danger). One decision point.

### 2.4 Exit ("off when not needed")
Two different kinds of "off", and only one can animate cheaply:
- **Renderer-level idle** (feature 2): the window stays shown and click-through, the page hides its content with a
  120-160 ms fade then `display:none`. Free in CSS.
- **Window-level hide** (`win.hide()` from an `apply*Visibility()` function): instant today. An exit animation here
  needs `wp-leave` out and an ack back before hiding, and races with `_holdForMove`, hide-all and `will-resize`.
  **Recommendation: no exit animation on window-level hides.** The two cases that matter (a JIT overlay going
  away; a piece going idle) are renderer-level.

### 2.5 Options

Sample pictures are sketches of the overlay's border over EQ; a rendered preview goes with the pick (section 9).

```
A - inside the window              B - across the screen (Canvas)        C - effects window
 beam from nearest edge,            beam runs from the screen edge        a 2nd screen-sized
 across the overlay only            to the panel, then the outline        click-through window
 |==>                              ==============>[ panel ]               draws any overlay's
 +----------+  gold trace,                         gold trace             entrance, long travel
 | PET  hp  |  then fill                                                  (2 windows to keep honest)
 +----------+
```

**A - Inside the window: the beam and outline are drawn inside each overlay's own window.** Every overlay gets it
from the one injected layer. *(Cheapest and most uniform; can grow into B for Canvas panels.)*
- Build **low-medium** (about 2-3 days: the layer, the `wp-appear` IPC, the setting, the tests).
- Maintenance **low** (one stylesheet; a new overlay inherits it; it breaks only if the preload's injection point moves).
- Runtime **very low** (one 300-450 ms compositor-only effect, only on appearance, at most once per 3 s per overlay).
- Change **easy** (durations, colours and shape are CSS variables in one place; replacing the whole effect is one file).

**B - Across the screen, on the Timers canvas only: the beam travels from the screen edge to the panel.** The Canvas
is already one screen-sized transparent click-through window hosting its panels, so a long beam and a trace are
plain CSS in a window that already exists. *(The most dramatic look; covers only Canvas-hosted overlays, which are opt-in.)*
- Build **medium** (about 3-4 days: panel appear detection on `.panel.wh` / `.off` changes, the path from the screen
  edge to the panel's row, arranging/edit exclusions).
- Maintenance **medium** (tied to canvas.html's panel lifecycle, which is large and moving).
- Runtime **very low** (no new window; the canvas already repaints on change).
- Change **medium** (canvas-specific; each canvas rule change touches it).
- Also covers the Dock's panes (same-origin iframes in one window) by the same CSS, for free.

**C - A dedicated effects window: a second screen-sized, click-through, transparent window draws the entrance for
any overlay** from rectangles main hands it. *(The only way to get real screen travel for every standalone overlay; the heaviest.)*
- Build **high** (about 5-7 days: a 22nd window, rect IPC, show-time sequencing).
- Maintenance **high**: a screen-sized window inherits every Canvas rule in `CLAUDE.md` (click-through even when
  unlocked, skipped by rescue and auto-arrange, never force-shown by setup, screen-change handling,
  `_overlayEntries`, hide-all, the EQ gate, z-order). Each is a place to get wrong.
- Runtime **medium**: a second layered surface the size of the screen composited over EQ, even if only while an effect plays.
- Change **hard** (a new window type is the thing every later change has to remember).

**Recommendation: A for 3.1, B as a follow-up if the guild lead wants the long-travel look on the Canvas; not C.**
A gives every overlay the arrival, costs almost nothing mid-raid, and is a single file to retune. The "from the
side" part is honoured by drawing the beam from the nearest screen edge across the overlay itself.

---

## 3. Feature 2 - Just-in-time, on-demand, expanding overlays

### 3.1 What it is
An overlay is **wanted now** only while its situation exists (a target with effects, a CH chain running, a charm,
rolls open, a pet out), shows a **glance** form at first, and grows **more detail as more happens**; when the
situation ends it goes away without the raider doing anything. "Off when not needed" is the exit half of the same rule.

### 3.2 Where it would live
- **Lift the Canvas rule table into one shared module** (`apps/mimic/showWhen.js`, plain functions, no Electron,
  loaded by `canvas.html` and by standalone overlay pages): `WHEN`, `whenSignals(me, state, now)`, `whenHolds`,
  `COMBAT_HOLD_MS`, `RAID_FRESH_MS`. Today these live inside `canvas.html` and are tested only through it
  (`test/canvas-show-when.test.js`); lifting them keeps one definition and gives Charm's one-off `charmIdle` a
  home. The existing test keeps passing against the lifted module.
- **Standalone pages** get the Charm pattern generalised: a "Show: Always / when ..." page option, an `idle` body class,
  persisted in `localStorage` and registered in `setupBundle.js` `SHARED` so Sets carry it (as `wpCharmShowWhen` does).
- **Main's `apply*Visibility()` functions stay as they are.** JIT is a second, inner layer:
  `effective = user flag AND NOT hide-all AND EQ gate AND rule`. The rule can only hide what the raider turned on,
  never show what they turned off; setup, unlock and arranging bypass it (as Charm and the Canvas both do).
- **Expansion tiers** reuse what exists: `wp-mini` and `overlay-auto-height` for the glance <-> detail change, and
  parts "density". A tier switch is a class on `<body>`, byte-stable HTML otherwise (the dashboard repaint rule).

### 3.3 Data: what signal exists today
| Situation | Signal | Exists? |
|---|---|---|
| In combat | `/api/me` `combat.live` | yes (Canvas uses it) |
| Have a target / an NPC target | `/api/me` `target` | yes |
| In a raid | `/api/state` `raidPipe` (fresh within 60 s) | yes |
| Charming | `/api/state` `charmSession.charming` | yes (2026-10-22) |
| **CH chain running** | `/api/state` `chChain` non-null (it goes null `CH_CHAIN_IDLE_RESET_MS` = 5 min after the last call) | yes, **not yet a rule** |
| **A pet is out** | `/api/state` pets list / Zeal gauge 16 | yes, **not yet a rule**; exact "pet present" test unverified |
| **Target has raid effects on it** | the target-buffs data Mob Info uses (`/api/agent/target-buffs`, bot-side) | exists; a **local** cheap signal for "has effects" is unverified |
| **Rolls open** | agent `rollSetsSnapshot()` | exists in the agent; whether `/api/state` serves it to overlay pages is unverified |
| Loot window / master-looter open | none found | **no** |

New rules are therefore small agent additions (a boolean each on `/api/state`), not new capture. Per the agent's
existing posture they fail open: an older agent that omits the key leaves the overlay shown (`s.miss`).

### 3.4 Hazards (each one cost us something already, or would)
1. **Do not `win.hide()` a window to make it idle.** Hidden windows are throttled (only the trigger window sets
   `backgroundThrottling:false`), and **the Chat overlay's gated groups (Tells, Group, Officer, ...) are captured
   only while the overlay is asking: the agent's policy lapses 15 s after the last ask** (`CHAT_POLICY_TTL_MS`).
   A hidden Chat would stop listening for the very tell that should bring it back. Charm solved this by idling
   **inside** a shown window that keeps polling. JIT idles in the renderer, never at the window.
2. **Flapping.** Every rule carries a hold (`COMBAT_HOLD_MS` 8 s, `CHARM_SESSION_HOLD_MS` 10 min are the precedents),
   and the motion budget (2.2) stops a rule that does flap from strobing.
3. **Fail open.** An unknown signal keeps the overlay visible ("a hidden callout is worse than a visible one").
4. **The trigger window never idles.** It is the voice (`_overlayWanted` exempts it for this reason).
5. **Surprise.** An overlay that appears and disappears by itself is the point, but it must be learnable: the page
   option states the rule in words, the Overlays tab shows it, and the tray's "show all" is one click.

### 3.5 Options

```
A - rules per overlay            B - situations                     C - pill and grow
 Pets   [Show: when pet out v]    one state: idle|fight|chain|...    always there, always small
 Mob    [Show: with a target v]   picks which overlays + how big     idle:  [Pet 100%]
 Chain  [Show: chain running v]   (auto-switches a Set)              fight: [Pet 100% -> Lord X
 each page explains its rule      "Fighting" => Mob+Threat full           buffs  haste  atk 412]
```

**A - A "Show when" rule on every overlay.** Canvas pieces already have it; standalone pages get Charm's version.
*(Explicit and predictable; reuses what is shipped; the raider decides each rule.)*
- Build **medium** (about 4-5 days: the shared module, the page option on the first 5-6 overlays, the new rules,
  the Overlays-tab row, tests; more overlays are an hour each after that).
- Maintenance **low-medium** (one module and one signal per rule; each overlay's idle state is small).
- Runtime **very low** (the signals are already on the poll every overlay shares).
- Change **easy** (a rule is a row in a table; per-overlay defaults are data).

**B - Situations: one named state decides which overlays are up and how big.** A single state machine in main
(idle, pulling, fighting, chain, charming, looting) reads the same signals and switches the **overlay set**
(R18 sets already exist: `overlaySets.js`, `/pipe mimic load|next`). *(The literal "just in time": the whole screen reshapes itself; the largest trust ask.)*
- Build **high** (about 8-12 days: the state machine, set-per-situation editing, hysteresis, a way to see why it chose).
- Maintenance **high** (every new situation or overlay is a decision about every set; sets are per character and shareable).
- Runtime **low** (a set load is a one-time cost, but a load per transition mid-raid is exactly when it must not stutter).
- Change **hard** (once raiders build sets around situations, changing the situations breaks their sets).

**C - Pill and grow: nothing disappears, it shrinks.** Overlays stay up as a one-line pill when idle and grow
into detail when active (`wp-mini` + `overlay-auto-height` + density). *(No appearing, so no surprise; spends screen space all the time.)*
- Build **medium** (about 4-6 days: define each overlay's glance and detail forms, tier triggers, auto-height tuning).
- Maintenance **medium** (two or three forms per overlay to keep byte-stable and consistent).
- Runtime **low** (window resizes via `overlay-auto-height` are already used; frequent resizes mid-fight are the risk to measure).
- Change **medium** (the forms are per overlay; the triggers are data).
- Does not deliver "off when not needed", so on its own it misses half the ask.

**Recommendation: A, with C's tiers where an overlay already has a mini form (Pets, Mob Info, Charm).** A is the
smallest step that gives true "on only when needed", is explicit, and uses code that is already in production on the
Canvas. B is where this leads once raiders trust A's rules; it should wait for the Sets work and for the 3.1
experience to show which situations people actually define by hand.

---

## 4. Feature 3 - Pet information attached to the game's pet buttons

### 4.1 What it is
The Pet overlay (HP, buffs with timers, what it is attacking, attack signature, charm ticks) **sits against EQ's own
Pet window**, so the pet's state is read where the raider already looks to command it. It shows only while a pet
exists (feature 2). Displays only: the raider still clicks EQ's real buttons.

### 4.2 Where it would live
- **Window:** `createPetsOverlay()` / `applyPetsVisibility()` in `main.js` (~7955), page `pets.html`. Make the window
  `focusable:false` (the CH chain precedent) so interacting with it never pulls keyboard focus from EQ.
- **Anchor math in a new pure module** (`apps/mimic/overlayAnchor.js`, tested without Electron, next to
  `uiClearRects.js`): given the ini rect of the target window (`visibleUiRects(text, {client, skinSizes})` returns
  `{name, x, y, w, h, guess}` in EQ pixels, chosen for the live resolution), EQ's client rectangle
  (`_eqMainWindow().client`, or the home display) and the overlay size, return the overlay's bounds: below the
  window, else beside it on the side with room, never on top of it (the keep-clear idea the Map already uses).
- **Anchored overlays are skipped by auto-arrange and Rescue** (they have a computed home, as the Canvas does) and
  re-anchored when the ini changes or EQ's window moves. `CLAUDE.md`'s screen rule applies: nothing moves on a screen
  change without a yes, so **anchoring is a per-overlay opt-in** ("Attach to EverQuest's Pet window") and that opt-in is the yes.
- **Re-read trigger:** a stat of the character's `UI_<Char>_*.ini` mtime (`_newestUiIniFile(char)` already exists) on
  the existing EQ-running poll, and a "Re-read" button. No new polling loop.

### 4.3 Data: what exists, what does not
- **Pet state:** exists (section 1).
- **The Pet window's rectangle:** the ini has a section per window with per-resolution position and a size (or the
  skin's size). The **exact section name for the pet window is unverified** in this repo: UI Studio groups
  `^player|^pet` under "Player / Pet" (`ui-studio.html` ~1128) and `uiClearRects.js` skips known phantom names, but no
  fixture here names the section. A local session with a live EQ folder confirms it (add to `docs/STATUS.md` "needs a
  local session").
- **The buttons themselves:** no per-button rectangle exists in the ini (unverified; none seen). "Attached to the
  buttons" is therefore **attached to the window that holds them**, with the readout placed on the side that does not cover them.
- **Staleness:** EQ writes the ini on camp / zone / quit. A window dragged this session is not in the file. The
  existing sources say so (`uiClearRects.js`: "a window moved since then is where the ini does not say").
- **A live rectangle:** only from Zeal (the 3.0 plan's option D, `DESIGN-mimic-3.0-overlay-builder.md` section 4:
  *"R12-R14 make D the load-bearing source"*). Not shipped; adoption would lag as spawn ids did.

### 4.4 Options

```
A - Hug (read the ini)         B - Pin (place it once)             C - Zeal tells us
 +----------+                   +----------+                        +----------+
 |PET window|                   |PET window|                        |PET window| <- live rect
 |[A][B][F] |                   |[A][B][F] |                        |[A][B][F] |
 +----------+                   +----------+                        +----------+
 [Pet 87%  ->Lord X]            [Pet 87%  ->Lord X]  you dragged    [Pet 87%  ->Lord X]
 snaps; stale if you moved      it; Mimic keeps the offset          exact, instant
 the window since last camp     from the window                     (needs a new Zeal message)
```

**A - Hug: Mimic reads EQ's ini and snaps the overlay to the Pet window's edge.** *(Zero setup; right at the last camp, wrong after a mid-session drag.)*
- Build **medium** (about 3-4 days: the anchor module, the opt-in, the re-read, tests on ini fixtures at two resolutions, windowed and fullscreen).
- Maintenance **medium** (tied to EQ's ini format and the skin's window names; a custom skin that renames the window breaks it quietly, so it must report "could not find the Pet window" and fall back to free placement).
- Runtime **very low** (an `fs.stat` on an existing poll; geometry is computed, not polled).
- Change **easy** (the module is pure).

**B - Pin: the raider drags the overlay to where they like it once; Mimic stores the offset from the window.**
*(Right even when the ini is stale, because the raider fixed the truth by hand; one manual step.)* Stored as fractions of EQ's client area plus an offset from the Pet window's ini rect, keyed by screen setup like Sets (`cfg.overlayLayoutBySig` precedent), so a resolution change keeps the relationship.
- Build **low-medium** (about 2 days on top of A's module; it is A with a stored delta).
- Maintenance **low**.
- Runtime **very low**.
- Change **easy**.
- Weakness: if the raider later moves the Pet window **and** the file is stale, the pin points at the old place.

**C - Zeal tells us: a new pipe message with every window's live rectangle.** *(Exact and instant; needs Zeal, and only the raiders who update it get it.)*
- Build **medium-high** (C++ on the guild's Zeal fork, then the agent and Mimic side; the upstream ask must be rewritten against `named_pipe.cpp`, as `CLAUDE.md` says the spawn-id ask should have been).
- Maintenance **low** once it lands.
- Runtime **none** (pushed on change).
- Change **medium** (an upstream surface).
- Never the only source: adoption lags, so A+B must work without it.

**Recommendation: A with B's nudge in the same slice (Hug to start, drag to fine-tune, offset remembered), and file the
Zeal ask now so C can replace the file read later.** A and B share one module, so choosing both costs about one
more day than A, and B removes A's only real weakness.

---

## 5. Feature 4 - Chat locked to the chat entry point, with tabs the client lacks

### 5.1 What it is
A Mimic chat surface docked at EQ's chat entry point (where the raider types), showing **tabs** for views the stock
client does not provide: combined or split groups (Guild + Raid together, Tells on their own, Rolls with winners
marked, Loot with item links decoded, Spells, Skills, Melee as separate views), an unread lamp on each tab, and
a tab that lights when something arrives in it. **Display only: there is no input box, no send, no macro.** The
raider still types in EQ.

### 5.2 Where it would live
- **Window:** `createChatOverlay()` / `applyChatVisibility()` (`main.js` ~8438) and `chat.html`. The data path is
  unchanged: the agent serves `GET /api/chat` with `groups` + `channels`; the page paints a filter over one ring. "A window is a group list plus a filter" (chat.html header), and a tab is the same thing drawn differently.
- **The entry point:** derived from the ini the way UI Studio already reads it: `[ChatManager]` `ChatWindow<N>_AlwaysHere=1`
  names the window typed text goes to (at most one is pinned; else window 0, `[MainChat]`), and its `[MainChat]` /
  `[Chat N]` block gives the rectangle (`main.js` ~6845-6910 already parses both). That the text-entry line sits on
  that window's bottom edge is **unverified** here, and Zeal can change chat input behaviour; a local session
  with a live client confirms it before the layout is final.
- **Tab form:** `chat.html` chips become an optional tab strip (the chips code, `_groups`, `chipIsOn`, breakouts all stay).
  Unread counts are new: a per-group counter in the page, reset on selecting the tab (today only the single
  "new below" count `_unread` exists).
- **Focus:** the window must be `focusable:false` so a click on a tab never takes the keyboard from EQ's input line.
  **Conflict to resolve:** `chat.html` has a text box (`#find`, the character filter) that needs focus. In docked mode
  that box is removed or opens with a temporary `setFocusable(true)` the way a drag does (`_dragSession.restoreFocusable`
  precedent), then restores. The docked strip itself has no text field.
- **Privacy is unchanged:** the lines live in the agent's memory on this PC and are never uploaded; gated groups are captured
  only while asked for. A docked strip that is idle (feature 2) must still be "asking" (3.4 hazard 1).

### 5.3 Data: what exists, what does not
All the groups named in 5.1 exist today as `CHAT_GROUPS` entries (Tells gated, Rolls = `random` plus the roll pairing
helpers `classifyRollPair` / `chatRollMark`, Loot with decoded item links). **Missing:** per-tab unread counts, the
tab strip drawing, the dock placement. "Tabs the stock client lacks" is stated as **what Mimic already splits that EQ's
fixed windows do not** (spell, skill and melee as separate views; rolls with winners; loot; tells in one place with a lamp),
not a claim about everything the stock client can or cannot route; EQ's own `ChannelMap` routing is richer than a casual
reading, and nothing here should be sold as the client's missing feature without checking it.

### 5.4 Options

```
A - Tab strip on the edge       B - Second skin over the window     C - Lamps at the entry point
 [Guild*][Raid][Tells 2][Rolls]  +-------------------------+        [GU*][RS][T 2][RL 3]
 +------------------------+     |[Guild][Raid][Tells][Rolls]|        hover a lamp = last 5 lines
 | EQ's own chat window   |     | Mimic feed covers EQ's    |        pop up, then fade
 | (untouched)            |     | window; input line left   |        (no feed docked)
 | > type here            |     | visible below             |        +------------------------+
 +------------------------+     | > type here (EQ's)        |        | EQ's own chat window   |
                                +---------------------------+
```

**A - Tab strip: a thin strip of tabs docked on the edge of EQ's chat window, with the active tab's feed opening on
the side with room.** EQ's chat window and its input line stay exactly as they are. *(Least risk to the game's own chat; Mimic's feed is beside it, not instead of it.)*
- Build **medium** (about 3-4 days: tab form, unread counters, the anchor from section 4's module, focus handling, tests).
- Maintenance **medium** (chat.html is a large, busy page; the strip is a second rendition of the chip row).
- Runtime **low** (a counter per group; the feed already paints a filter).
- Change **easy-medium** (tabs are `CHAT_GROUPS` data; the strip is one component).

**B - Second skin: Mimic's feed is drawn exactly over EQ's chat window, with tabs along its top, leaving the input line uncovered.**
*(The closest to "locked into the chat"; also the one that hides EQ's own text, and it depends on exact rectangles.)*
- Build **high** (about 6-8 days: pixel-accurate rect fitting, font/line matching, covering without covering the input line).
- Maintenance **high** (a stale or wrong rectangle covers the wrong thing or leaves a seam; every skin differs; the ini is only right as of the last camp).
- Runtime **low-medium** (a big opaque window composited over EQ's chat area at all times).
- Change **hard**.
- Plus a safety note: if Mimic's feed is wrong or late, the raider is reading a copy of chat while the real one is hidden underneath.

**C - Lamps at the entry point: no feed docked, only a row of small lamps; hover or a new line in a lit tab pops the last few lines, then fades.** *(Cheapest on screen space; the most "just in time"; not really tabs.)*
- Build **low-medium** (about 2 days: the lamp row, the pop-over, unread counters).
- Maintenance **low**.
- Runtime **very low**.
- Change **easy**.
- Weakness: reading a long exchange still needs the full Chat overlay.

**Recommendation: A, with C's lamps as the strip's collapsed state (lamps when idle, the tab strip opens on hover or when a gated group lights up).** A leaves the real chat window and its input untouched, which is the safest reading of "no automations back into the client", and the collapsed lamp state is the JIT behaviour feature 2 describes. B is only worth it if the guild lead wants Mimic's chat to **replace** EQ's chat window, which should be a deliberate later step.

---

## 6. Cross-cutting rules this work has to follow

- **Overlay parity checklist** (`CLAUDE.md`): no new overlay window is proposed, but Pets and Chat gain an anchored mode, so
  the six items still hold for them: ✕ hide, ✥ move (in anchored mode the ✥ **moves the stored offset**, it is never
  removed), the hover handshake on every clickable control (tabs and lamps get `data-wp-interact` if they are not
  `<button>`s), the `WP_OVERLAY_ROWS` row, the `apply*Visibility()` path, the `_HIDEALL_FLAGS` and `_overlayEntries()` entries.
- **Tray <-> dashboard parity:** motion setting, each Show-when rule, each "Attach to EverQuest's window" toggle: a tray item and the dashboard control in the same change.
- **Sets:** the new per-overlay page options go in `setupBundle.js` `SHARED`; the anchor offset keys by screen setup like other geometry.
- **Tests:** pure modules (`showWhen.js`, `overlayAnchor.js`) get unit tests like `overlaySets.js` and `uiClearRects.js`
  do. Text assertions on the motion stylesheet (a `prefers-reduced-motion` guard exists; no `infinite`; the longest duration is under the cap) use
  the comment-stripping helpers in `test/_source-slice.js`, per the comments-satisfy-assertions rule, and are mutation-checked.
  A test asserts the no-input rule: no input-synthesis dependency in `apps/mimic/package.json`, and none of the names in section 0 in Mimic's own sources.
- **Docs at both gates:** `docs/STATUS.md` + `docs/HOW-ITS-BUILT.md` rows when each slice lands on `beta`, updated again at the stable cut.
- **Release routing:** Mimic changes go to `beta` (the park stays; the workflow numbers the `-beta.N` tags); the stable cut opens the 3.1 line.
  Release-visible text is bulleted, member-facing, jargon-free; the release is **unnamed** unless the guild lead names it. A `web/lib/roadmapData.ts` entry at the stable cut.
  Agent changes (the new boolean signals) land on `beta` with the agent bump; the bot is untouched.
- **UI gets options:** this doc is the options-with-costs for the Mimic surfaces; the picks in section 9 come before any slice that is a design choice (1, 3 and 4).

---

## 7. Slicing into the next minor (3.1), in order

"Days" are rough focused working days, for one session doing the work with Sonnet agents on first drafts and the shipping session reviewing, per the repo's working rule.

| Slice | What ships (on `beta`) | Days | Depends on |
|---|---|---|---|
| **0 - Ground** | `cfg.motion` (`full`/`calm`/`off`) with tray + dashboard rows; `disableGpu` -> `calm`; the measurement harness (GPU/CPU across 20 entrances); `focusable:false` trial on Pets (validate with the CH-chain precedent); the no-input test | 1-1.5 | none |
| **1 - Arrival** | Option A of section 2: injected motion layer, `wp-appear` from the `show` hook, loudness budget, reduced-motion path, opt-outs (unlocked/setup/bulk restore) | 2-3 | 0 |
| **2 - Just in time** | Lift `showWhen.js` out of the Canvas; page option on Pets, Mob Info, CH chain, Charm (re-based), Buff queue; new rules (chain, pet out); tiers on Pets/Mob Info via `wp-mini`; renderer-level exit fade | 4-5 | 1 (for the exit), agent booleans (0.5 d) |
| **3 - Chat dock** | Option A + C-collapsed of section 5: tab strip, unread lamps, anchor from the ini, focus handling | 3-4 | 0, anchor module (below), the section 5 confirmation of the input location |
| **4 - Pet attach** | Option A + B-nudge of section 4: `overlayAnchor.js`, opt-in, re-read, remembered offset | 3-4 (shares the anchor module with 3) | 0 |
| **5 - Reach (stretch)** | Canvas long-travel beam (option B of section 2); roll/target-effects rules; polish, roadmap entry, both-gate docs | 2-3 | 1, 2 |

- **Total: 15-20 days for slices 0-5.** A realistic **3.1.0 is slices 0-3 (10-13 days)**, or slices 0-4 (13-17 days) if the pet window's section name is confirmed locally early; slice 5 is 3.1.x or 3.2.
- **Anchor module is built once** (slice 3 or 4, whichever starts first) and the other reuses it; if 3 and 4 are split between sessions, whoever goes second is a day cheaper.
- **Order of risk, lowest first:** 0, 1, 2, then 3 (focus handling and chat.html's size), then 4 (needs the pet-window section name confirmed locally).
- **Not in 3.1:** situations (feature 2 option B), a second-skin chat (feature 4 option B), an effects window (feature 1 option C), Zeal live rectangles (feature 3 option C: ask filed, built when it lands).
- **Raid-night freeze:** all of this is `beta` (pull-based updates), so the freeze does not apply; the docs commits go to `main` outside Sun/Wed/Thu 19:30-00:30 ET.

---

## 8. Unverified, and who can verify it

- Cost of one entrance effect on a real raid machine (GPU and renderer CPU) -> slice 0 harness, run by a local session or a volunteer.
- Whether Chromium in our Electron build maps Windows' "Show animations" to `prefers-reduced-motion` -> a quick test on Windows; `cfg.motion` covers the gap.
- Whether `document.visibilitychange` fires on `win.hide()`/`showInactive()` in our build (the alternative to the `wp-appear` IPC) -> not needed if the IPC is used.
- The ini section name of EQ's Pet window, and whether the chat window's bottom edge is the text-entry line -> a local session with a live EQ folder (add to `docs/STATUS.md` "needs a local session" with these exact questions).
- Whether `/api/state` serves roll sets to overlay pages; the exact "pet present" test; a cheap local "target has effects" signal -> a read of the agent when slice 2 starts.
- That a `focusable:false` Pet or Chat window behaves for drag, the right-click menu and the hover handshake on every supported Windows build -> the CH chain window was made non-focusable after a 2026-06-19 report (its own comment in `main.js`); the Pet and Chat windows still need their own check.

---

## 9. Decision points for the guild lead

Each is a pick; the one I would make is marked. Sketches are in the sections named; rendered previews go with the ask.

1. **Choose A, B or C for how the arrival looks (section 2):**
   - **A - Inside the window:** the beam and gold outline are drawn inside each overlay, from the nearest screen edge. *Cheapest, every overlay gets it, can grow into B.* **(recommended)**
   - **B - Across the screen (Canvas):** the beam crosses the screen to a panel; Canvas and Dock panels only. *Most dramatic, narrower reach.*
   - **C - Effects window:** a second screen-sized window draws it for every overlay. *Full long-travel for all, heaviest and riskiest.*
2. **Choose the default motion setting (section 2.3):**
   - **A - On by default (`full`), `calm` when graphics is off.** *Everyone sees the new look.* **(recommended: it is the feature; one click to turn off)**
   - **B - Calm by default (fade only), `full` opt-in.** *Safest for a raid, hides the feature.*
3. **Choose the beam colour (section 2.3):**
   - **A - Each overlay's own accent, gold outline for all.** *One loud colour only: the outline.* **(recommended)**
   - **B - Gold beam and gold outline.** *A single brand look; two gold things at once.*
   - **C - White-hot beam, gold outline.** *Reads most like a laser; adds a third colour.*
4. **Choose A, B or C for just-in-time overlays (section 3):**
   - **A - A "Show when" rule on every overlay.** *You set each one; reuses the Canvas rules.* **(recommended)**
   - **B - Situations.** *The screen reshapes itself by fight state; biggest build and biggest trust ask.* (after A has been used)
   - **C - Pill and grow.** *Never off, just smaller; spends screen space.* (used inside A for Pets, Mob Info, Charm)
5. **Choose A, B or C for the pet overlay's attachment (section 4):**
   - **A - Hug:** snaps to the Pet window from EQ's ini; stale if you moved the window this session.
   - **B - Pin:** you place it once, Mimic remembers the offset.
   - **C - Zeal tells us:** exact live position; needs a new Zeal message and updated Zeal.
   - **Recommended: A with B's drag-to-fine-tune in one slice, and the Zeal ask filed for C later.**
6. **Choose A, B or C for the chat dock (section 5):**
   - **A - Tab strip beside EQ's chat window**, EQ's chat untouched. **(recommended, with C's lamps as the idle state)**
   - **B - Second skin over EQ's chat window.** *Closest to "locked in"; hides EQ's own text; exact rectangles required.*
   - **C - Lamps only.** *Smallest; not really tabs.*
7. **Choose what 3.1.0 must contain:**
   - **A - Motion + just-in-time + chat dock (slices 0-3, about 10-13 days).** **(recommended: the pet attach needs a local check of the window name first)**
   - **B - Everything including the pet attach (slices 0-4, about 13-17 days).** *All four asks in one release; later.*
   - **C - Motion + just-in-time only (slices 0-2, about 7-9.5 days).** *Fastest; leaves both "attached" asks for 3.2.*
8. **Confirm the rule as written in section 0:** "Mimic never sends input to or controls the running game; it reads and displays. UI Studio's explicit, queued-until-logout file edits stay as they are, and no new writer to EQ's files is added." Pick **A - confirm as written** (recommended) or **B - tighten it to forbid UI Studio's game-folder writes too** (that would retire part of UI Studio and the UI-pack updater, so it is a much larger change).
