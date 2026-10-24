# Design: the screen reader (Mimic reads the screen where there is no pipe)

**Status:** decided in principle 2026-10-24 (the guild lead: *"if we need to read the screen perhaps that is a good way for us to
operate moving forward. I suppose we need OCR locally? not every game has a named pipe"* and *"EQ without Zeal first... wow
second. perhaps gta6 afterwards"*). Engine pick open on the Decision Desk. Nothing built. DECISIONS §425.

## 0. The rules that come with it

- **Reading is the third input, after the log and the Zeal pipe, never a replacement.** The log carries everything a game writes
  down; the pipe (Quarm only) carries live state; the screen carries what reaches neither: target HP%, the buff window's timers,
  the extended-target list, and any game with no log at all.
- **Regions only. Never a full frame stored, kept in memory longer than one read, or uploaded.** A full frame holds the chat
  window, and the chat window holds tells. This is the same chokepoint as the log filter (`docs/PRIVACY.md`): the thing that
  could leak is never captured in the first place, so no later code path can leak it.
- **Reading sends nothing into the game.** The "no automations come back into the client" rule (DESIGN-overlay-motion §0)
  holds: pixels in, nothing out.
- **Regions follow the game's own window layout.** For EQ that is the ini Mimic already reads (`_parseUiWindowRects`,
  `uiClearRects.js`), so a moved window moves its region. A region a raider can fix themselves (a region editor in UI Studio) is
  what keeps the upkeep bounded across UI packs and resolutions.
- **Capture works where the overlays work:** windowed and borderless. Exclusive fullscreen goes black for both, so the promise
  is "if you can see the overlays, Mimic can read the screen", and nothing more.

## 1. Order of games

1. **EverQuest without Zeal.** The pipe exists to check against, so every read can be scored before anyone relies on it, and a
   raider without Zeal gets target, buffs and extended target from day one.
2. **World of Warcraft (Classic).** The combat log is richer than the screen; the reader is for the bits the log omits (buff
   timers, target HP) and follows the other-games plan (DECISIONS §377: a thin reader per game posting the same upload).
3. **GTA 6, afterwards, to check first.** An online game's anti-cheat terms on overlays and screen capture have to be read
   before a line of code; unverified. It stays a question, not a plan.

## 2. The engine (the open pick; pictures on the Desk)

| | What makes it different | Build | Maintenance | Runtime | Change |
|---|---|---|---|---|---|
| **A — Windows' built-in OCR** (recommended) | On every raider's PC already; no download | low: a helper process, the way the voice engines run | low | fast on CPU, no GPU (unverified on EQ's small digits) | easy |
| **B — a small ONNX OCR model** (~10 MB) | Better on game fonts, a confidence per read | medium | medium: a model to ship and update | tens of ms a region on CPU, unverified; competes with the game | medium |
| **C — template matching** | Pictures, not text: bars and icons; no words or numbers | low per target, grows per UI | highest: every UI pack and resolution | cheapest | painful |

Recommendation: **A for text, C alongside for bars and icons; B replaces A behind the same region code only if the dry run shows
A misreading EQ's digits.**

## 3. The dry run (two days, a local session on the guild lead's PC; costs users nothing)

Capture EQ at the guild lead's resolution and UI pack; run A on the three regions at 2 to 5 reads a second for a raid hour;
score every read against the pipe. Pass bar (proposed): target name 99%, HP% within 1 point 98%, buff timers within 1 second
95%. Report CPU and frame-time cost with EQ running. Only then does an engine get picked for real.

## 4. Phases (rough)

- **Phase 0**, the dry run above: 2 days, local.
- **Phase 1**, EQ-without-Zeal: target + HP% region, the region editor's first slice, the privacy rule as a structural test
  (no code path may hold a frame outside the capture helper): 6 to 8 days.
- **Phase 2**, buff timers and extended target, icons via C: 5 to 7 days.
- **Phase 3**, WoW: a region set per the stock UI, behind the other-games reader: 5 to 8 days after that plan's reader exists.

Day counts are unverified estimates.
