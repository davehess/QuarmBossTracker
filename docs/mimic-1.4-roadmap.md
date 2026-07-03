# Mimic 1.4.x beta roadmap

> Working queue for the Mimic 1.4 beta cadence (kicked off by the Command
> Center overlay, 1.4.0). Not full designs — just enough per item to resume
> cleanly, with research findings called out where they change what's
> buildable. Update in place as items ship or get re-scoped; this is a
> living doc, not a changelog (see `CHANGELOGS` in `utils/onboarding.js` for
> what actually shipped).

## 1. Extended Target — "Pull Tracker" (Uilnayar 2026-07-03)

**The ask:** watch incoming adds approach camp — ideally with an ETA, and a
visual of the target list where mobs "glide" up as more raiders pick them up,
so a mob dropping off the bottom of the list reads as "camp's clear."

**Research finding — true ETA is not buildable today.** Checked both halves:
- **Mob speed**: yes, `eqemu_npc_types.runspeed` / `walkspeed` exist per-NPC
  in our Supabase mirror.
- **Position**: no. Zeal's named pipe carries no location for anything —
  confirmed in CLAUDE.md from a live packet capture: the target (slot 6) and
  pet (slot 16) gauges are name + HP-per-mille only, no entity id, level, or
  loc. The EQ log itself never emits position telemetry automatically either
  (`/loc` is a manual command a player would have to spam continuously,
  which nobody does, and the agent doesn't currently parse it at all — no
  `/loc` regex exists anywhere in `packages/wolfpack-logsync/index.js`).
  So "how far is the mob" and "how long until it reaches camp" have no data
  source right now, on either side (puller or mob).
- **Path to unblock**: would need Zeal to add position to its telemetry —
  a natural companion ask alongside the spawn-id request already drafted in
  `docs/zeal-spawn-id-request.md`. Worth folding into the same conversation
  with CoastalRedwood/Zeal rather than a separate ask. Speculative timeline —
  depends on an external party.

**What IS buildable now, with zero new data:** the Extended Target overlay
(`apps/mimic/extarget.html`) already has everything needed for the "watch it
climb the list" experience — `raider_count` per target, already sorted by
that count (`index.js`'s `_handleAgentExtendedTarget`, most-targeted first).
The only gap is that today's render is a plain repaint: a mob's row jumps to
its new position with no motion, so a raider watching the overlay (per
Uilnayar: "we tend to watch another screen where all the mobs are being
fought") can miss the actual moment more people start hitting it. Fix is a
pure animation change — FLIP technique (record each row's bounding rect
before the re-render, then animate the transform delta after) — no backend
work. This gets most of the practical value ("is this add getting worked,
or did it get abandoned") without needing real distance/ETA math.

**Recommended sequencing:** ship the glide animation as Extended Target v1.1
now (cheap, self-contained to `extarget.html`). Treat true ETA-to-camp as a
stretch goal gated on the Zeal ask landing — don't block the animation work
on it.

## 2. Trigger Alerts ↔ Triggers tab + class/role-aware first impression

**The ask:** Trigger Alerts (`triggers.html`) is exactly the kind of "persists
for short bursts, has screen real estate" overlay that should link directly
to the dashboard's Triggers tab, and if the overlay + tab suggested good
starter categories based on the viewer's class/role, a new Mimic install
would feel custom-tailored out of the box — a strong first impression.

**Status: needs a design pass before building.** Open questions:
- What does "direct linkage" mean concretely — clicking a fired alert jumps
  to `/admin/triggers` (or the local dashboard's Triggers tab) filtered/
  highlighted to that trigger? Or the reverse, a "preview" button on a
  trigger row that test-fires it into the overlay?
- Class/role → suggested trigger categories: this needs an actual mapping
  (e.g., healer → CH-chain + curse/cure; tank → DA/rampage/enrage/Death
  Touch — note items 3/4 below already cover much of the tank side via
  Command Center). Where does this mapping live — hardcoded in the agent,
  or a new guild_triggers column (`suggested_for_class`)?
- Is this scoped to the onboarding flow only (first-run experience), or a
  persistent "recommended for you" section on the Triggers tab going
  forward?

Needs sign-off on scope before implementation — flagging here so it's not
lost, not starting the build yet.

## 3. UI Studio-powered overlay positioning

**The ask:** UI Studio (`apps/mimic/ui-studio.html`, `openUiStudio()`) already
has a mature graphical editor for EQ's own UI/eqclient.ini window layout
(capture, rescale-for-resolution, cloud backup via `/api/agent/ui_layout`).
The idea: reuse that same visual-editing machinery to let raiders position
Mimic's OWN overlay windows (currently: drag-to-move + a resize-preset right-
click menu per overlay, no unified visual layout view).

**Status: needs scoping.** UI Studio edits *EQ's* ini-driven window
geometry — Mimic's overlays are separate `BrowserWindow`s positioned via
Electron bounds (`_resolveBounds`/`_persistBounds` in `main.js`), a
different mechanism entirely. "Serve us well in positioning our Overlays"
most likely means borrowing UI Studio's *visual editor UX pattern*
(drag-and-drop preview canvas, snap-to-grid, live preview) for a new
"Overlay Layout" view — not literally the same code path. Worth a follow-up
conversation on how much of UI Studio's canvas/rendering code is actually
reusable vs. just the UX pattern, before estimating scope.

## 4. Per-character overlay position + opacity (Phase B-2)

Already tracked as a pending item from the Phase B-1 per-character
*visibility* profile work (`_CHAR_PROFILE_FLAGS`/`_CHAR_PROFILE_WINDOWS` in
`main.js` — currently visibility-only; position and opacity were explicitly
deferred as "B-2 follow-up... carry screen-signature + on-screen validation
complexity"). Re-raised directly by Uilnayar (2026-07-03): playing two
different characters in one session needs two different overlay layouts,
and switching between them currently loses position/opacity even though
visibility already swaps automatically.

**Scope for B-2:**
- Extend the existing per-character profile capture/apply
  (`_captureCharProfile`/profile-switch logic) to also snapshot each
  overlay window's bounds + opacity, keyed the same way visibility already
  is.
- The "screen-signature" complexity noted in the B-1 comment: a saved
  position needs to be validated against the CURRENT display configuration
  before restoring (a profile saved on a 3-monitor setup shouldn't try to
  place a window off-screen on a laptop). Needs a signature (display count +
  resolution) stored alongside each saved layout, with a sane fallback
  (re-clamp to nearest valid position) when the signature doesn't match.
- Once this lands, item 5 below (syncing to `/me`) becomes straightforward —
  it's the same captured-layout shape, just also pushed to Supabase.

**This is the most concretely-scoped item here** — recommend it's next up
for actual implementation once Command Center settles.

## 5. Sync per-character overlay layout to `/me` on wolfpack.quest

**The ask:** most of what's on `/me` today is inherently local-machine data
(buffs/zone/live-state already stream up via `character_live_state`); it
stands to reason overlay layout choices should sync the same way so a
member can see/manage them from the web, not just locally.

**Depends on item 4 shipping first** — there's no per-character layout data
to sync until B-2 exists. Once it does, this is the same shape as the
existing live-state sync (`flushLiveStateToBot` pattern): a new Supabase
column/table (e.g. `character_overlay_layout` jsonb, keyed by character),
a bot upsert endpoint, and a read-only (at least for v1) card on `/me`.
Write-back from the web (edit your layout from the browser, pull down into
Mimic) is a natural v2 but adds real scope — round-tripping display-signature
validation across "whatever machine is currently running Mimic" — worth
explicitly deciding v1 is read-only before starting.

## 6. UI Studio: launch scoped to a specific character + generate previews

**The ask:** be able to launch UI Studio pre-scoped to a given character's
*locally saved* UI, or pull one of their other saved versions, with
generated previews (probably based on the commonly-displayed elements) so
you can tell layouts apart without opening each one.

**Status: needs its own research pass** before scoping — UI Studio currently
opens as a single global window (`openUiStudio()`, singleton — `if
(uiStudioWindow) { uiStudioWindow.focus(); return; }`) with an in-app
character picker (`_uiStudioFilesFor`), not a "launch already targeted at
character X" entry point, and there's no preview-thumbnail generation
today (`/api/agent/ui_layout` stores/retrieves the raw ini bundle, not a
rendered image). Preview generation in particular is a meaningfully sized
feature on its own (would need to actually lay out the captured window
geometry against some reference EQ UI skin to render something
recognizable) — flagging as the least-scoped item here, likely a later
phase once 3/4/5 above are further along.

## Suggested sequencing

1. Extended Target glide animation (#1, animation-only slice) — cheap, ships
   fast, no dependencies.
2. Per-character overlay position + opacity (#4) — most concrete, unblocks #5.
3. `/me` layout sync, read-only v1 (#5) — once #4 lands.
4. Trigger Alerts ↔ Triggers tab design pass (#2) — needs a scoping
   conversation before estimating.
5. UI Studio overlay-positioning UX (#3) and per-character launch + previews
   (#6) — both need further research; revisit after 1–3 ship.

Zeal position-telemetry ask (unblocks true Pull Tracker ETA) — draft
alongside `docs/zeal-spawn-id-request.md` whenever that conversation
happens; not on Mimic's own critical path.
