# Keepers of the (Overlay) Arts — Masterpieces, the Gallery, and sets per mode

*Mimic 3.0's name and program (the guild lead, 2026-10-18; DECISIONS-2026-09-21 §368). Scoped the same day by four
research passes; this doc is their synthesis. Nothing here is built yet unless a slice says so.*

**The idea in one line:** a guild's heaviest users (**Tastemakers**) build spectacular Canvas setups; the platform turns
each one into a **Masterpiece** any member can preview with their own live data and adopt in one click, without losing
what they had.

**Two rules that shape everything:**
- ⚠ **The repo is public.** Masterpiece titles (the punny, player-credited names) and author credit are member-authored
  data in the DATABASE, published by the author themselves, opt-in and revocable. Never seed or hardcode them in git.
- **Overlays replace display, not targeting.** Clicking to target stays EverQuest's own target window (or Zeal). Layouts
  are designed around that one window.

## What already exists (the program is mostly assembly)

| Need | Already on `beta` | Gap |
|---|---|---|
| Layout format | `canvas.html` `sanitize()` (panel kinds `part`/`sect`/`overlay`/`timers`/`callouts`, show-when `when`+`cls`); `canvas-save` → `cfg.canvasLayouts["WxH"]` | positions are fractions of the *display*, sizes are px: a 1440p layout is ~33% too big at 1080p |
| Saved groups | `cfg.canvasGroups` with copy/rename/update (§362), group hotkeys, `/pipe mimic group` | parts only; offsets are raw px |
| Whole-screen snapshots | overlay sets (`overlaySets.js`, `_captureOverlaySet`/`_applyOverlaySet`, `/pipe mimic load/save/next`) | no owner, no mode tag (below) |
| Live preview | `WpParts.render()` is DOM-free; every part has a `sample` | a no-save preview layer |
| Mimic → bot auth | per-user session token (the `ui_layout` upload pattern, `mimicLink.requireAgentAuth`) | gallery routes |
| Bring overlays into the Canvas | "⇲ Bring in the N on screen now" + hosted-window reaper + Remove/Undo | visible-only, silent, no snapshot (below) |
| Socials | read in Mimic (UI Studio), uploaded on Backup, indexed by the bot, `common_macros` on /me/ui, web-staged edits applied at logout | a privacy fix first (below) |
| Fit ("you can use this") | `/api/me` (class, level, gems, clickies); `character_gear`, `character_aas`, `character_spellbook`; the 1,611-entry clicky catalog | a needs check |
| Image storage | private-bucket + signed-URL pattern (`guild_media`, `feedbackShots.ts`) | a `gallery-shots` bucket |

## Workstream 1 — the Gallery of Masterpieces (recommended: **B**)

- **A — a file you pass around:** export/import a file into a new set; no server, no catalog. Cheapest, hardest to grow.
- **B — one shared library, browsed from Mimic and the site** *(recommended)*: database tables + bot routes; a Gallery
  tab in the Canvas chooser; a `/gallery` page on wolfpack.quest (new route → live with `[beta]`). Also serves the
  unbuilt "share my setup" code (§91) and an account backup from the same table.
- **C — website is the shop, Mimic is the door:** web catalog deep-linking into Mimic. Needs a protocol handler; cannot
  preview with your live data until Mimic has the spec. Better as a later add-on to B.

**Data model (B):** `gallery_masterpieces` (title, blurb, class tags, min level, mode tag, author + opt-in byline,
status draft/published/hidden/removed), `gallery_versions` (immutable `spec` jsonb, `needs`, screenshots — adopting
copies a version, so an author's later edit never changes yours silently), `gallery_adoptions`, `gallery_reports`.
Service-role access enforced in the bot/web, like `ui_snapshots`. Catalog list ETag'd and bot-cached; specs fetched once
on try/adopt; thumbnails (not full screenshots) in lists — images are the egress to watch.

**Portable format (needed by every workstream):** store a reference rect (EQ's client rect when known, else the display)
and express sizes in reference-height units and positions as an anchor (`tl … br`) plus offset. At adopt time scale by
the adopter's rect height, convert to Canvas fractions, clamp on screen, nudge off overlaps and off open EQ windows. Left
stays left on an ultrawide; a centred cast bar stays centred. Pure functions (`toMasterpiece`, `masterpieceFit`) with
tests at 1080p, 1440p, 4K-at-150%, ultrawide and windowed EQ.

**Adopt without ruining modality:** "Add as a new set" (default — auto-saves a "Before …" set first, Undo) or "Add to my
canvas" (inserted as a saved group in free space, Undo). Hotkeys, socials and clicky advice are *suggestions*: proposed
keys checked for conflicts, socials queued into empty slots, gear shown as a have/missing checklist. Nothing auto-equips
or overwrites.

**v1 limits:** `part` panels only (no whole-overlay iframes); author byline opt-in; officer hide + a report button.

## Workstream 2 — sets per character, per mode (recommended: **B**, tags on free names)

Today a set has no owner: two characters that both save "raid" overwrite one set. Fix that first, then add modes.
- **A — fixed mode slots** (Raid / Group / PvP / Charm / Leveling / Solo, one per character): a clean vocabulary, but
  "and more" doesn't fit and changing the list later migrates data.
- **B — free names + an optional mode tag from a closed list (+ Other), a per-character default per mode**
  *(recommended)*: additive on the shipped store; the gallery browses by the same tags.

**Detection (suggest, never auto-switch in v1):** raid, group, charm and the PvP flag are reliable; leveling is
reliable as "XP is flowing"; guild-vs-pug group is heuristic; power-leveling and AFK farming are not knowable — manual
tags. Guardrails: never in combat or the Canvas's combat hold, never in setup/arrange, never over hide-all, signal stable
30–60 s, one suggestion per mode entry, never when two clients are reporting.

**Cross-class copy** offers: keep everything / drop class-specific overlays / keep but hide. Canvas `cls` rules already
hide class-wrong pieces.

## Workstream 3 — bring current overlays into the Canvas (RAM)

Each standalone overlay is its own renderer, roughly 25–40 MB private (Task Manager's column). Moving 8 overlays into the
Canvas plausibly saves ~100–250 MB, 5 saves ~40–120 MB, 2–3 is marginal — **an estimate; measure it on the member's own
machine** with the existing `app-metrics` handler before/after and show "saved X MB" locally. Not movable: the hidden
trigger voice window, Chat, Map, Map timers. Command Center loads over `http` and likely gets its own process anyway.

**Recommended:** a per-overlay "Move into Canvas" toggle as the plumbing, then a one-shot convert on top of it: preview
("5 move, 2 stay on screen 2, Chat stays"), a yes, a pre-convert "Before Canvas" set, and "Put them back". Overlays on a
second monitor stay as windows in v1 (one Canvas per display needs layouts keyed by display id first).

## Workstream 4 — socials, voting, class A/B, gear advice

**Slice 0 — a privacy fix that comes first (found while scoping):**
1. `common_macros` publishes a macro seen on ≥3 *characters*; 41 of 64 published rows come from fewer than 3 *players*
   (4 from one person's alts). The floor must count players.
2. `_indexSnapshotSocials` / `_recomputeCommonMacros` ignore `exclude_from_stats`.
3. `ui_socials_index` is a plaintext copy of every backed-up social; PRIVACY.md says backups are encrypted and does not
   mention it. Needs a disclosure line.
Content today is benign (no chat verbs in any published row), but nothing in the code prevents it.

**Recommended: a "library-lite"** — explicit "Share this social" only (normalized, previewed to the author, fail-closed:
tells/guild/group/ooc lines dropped, names replaced with `{NAME}` unless they match a catalog item/spell/NPC), stored as
`social_variants` rows that a Masterpiece can later reference; one 👍/👎 per player. The A/B: class + has-item/spell/AA
cohorts, stable hash assignment, "try it" stages the social into an empty slot, a feedback prompt after 3 days, results
shown as notes when an arm has under 3 players. Cohorts are small (13 players have socials on file today) — call it a pilot.

**Gear/clicky advice** rides inside a Masterpiece: `requires`/`prefers` items with "you have it (3/5 charges)" or "drops
from X in Y / sold in Z / N guildmates hold one" (respecting `exclude_inventory`). Hotbutton values and Zeal keybinds
are unparsed — needs a local session to capture real examples.

## Tastemaker outreach

Ask the heaviest users (counted in players: breadth of streams + uploads, 30 days) to publish their setups as the first
Masterpieces. The request goes out when one-click Publish exists — there is nothing to import into before then — and the
guild lead approves the wording before any DM.

## Suggested order

1. **Slice 0** — socials privacy fix (bot, small).
2. **Foundations** — portable layout format + set ownership (fork-on-save) + mode tags. Approach-independent.
3. **Gallery slice 1** — Publish (parts only) → Gallery tab → "Add as a new set" with Undo. **Outreach goes out here.**
4. **Live preview + fit badge + "Add to my canvas"**, and the move-into-Canvas toggle + convert.
5. **`/gallery` web page** (two layouts on beta for the pick), screenshots + rendered thumbnails.
6. Social sharing + votes, then the class A/B; suggest-only mode toasts; bindings and version updates.

## Open decisions (the guild lead)

| Decision | Recommended |
|---|---|
| Gallery approach | B |
| Set modes | B: free names + closed tag list + per-character default |
| Social aggregates consent | a new opt-in flag (default off), floor 3 players |
| Author credit | opt-in byline per Masterpiece |
| Whole-overlay panels in a Masterpiece | not in v1 |
| Second-monitor overlays in the convert | stay as windows in v1 |
| Old per-character visibility profiles vs sets | keep both for now; revisit after sets have per-mode defaults |
