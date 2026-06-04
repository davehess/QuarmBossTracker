# Design — CH Chain "DDR" Minigame (backlog I)

Status: **proposal, awaiting sign-off.** Inspired by
https://github.com/peetar/rotatonator — a Complete Heal rotation timer where
each cleric gets a beat ("your turn") so a chain heals a tank without gaps or
double-heals. Ties into CLAUDE.md's "CH chain chatter analysis" roadmap.

## What it does
Given an ordered list of clerics and an interval (the CH cast time / chain slot,
classically ~ the time for the chain to come back around), the tool shows a
rotating "NOW: <you> → NEXT: <name>" beat. When it's your slot it flashes +
optionally TTS "CH now". A "DDR" feel = a moving highlight down the cleric list
on the beat, so each healer reacts to a visual cue instead of counting in chat.

## Two ways to drive the rotation (pick one for v1)
1. **Timer-driven (simple, rotatonator-style):** officer sets the cleric order +
   interval; everyone's overlay ticks the same clock. Needs clocks roughly in
   sync — drive it off a shared `start_at` epoch from the bot so all clients
   compute the same slot = `floor((now - start_at)/interval) % N`. No per-cast
   detection required. **Recommended v1** — deterministic, no log parsing.
2. **Callout-driven (advanced):** parse `/rs` `/gu` numeric callouts ("1", "2",
   "ch3 up") to advance the pointer. Robust to drift but needs the chat stream +
   per-cleric class tagging (we have `who_observations.class`). Phase 2.

## v1 scope (timer-driven, local-first)
- A new Mimic overlay `chchain.html` (reuse the G overlay chrome: ✕, tray
  toggle, drag/lock, setup mode).
- Config (local to start): ordered cleric names + interval seconds + your own
  name (to know which slot is "yours"). Stored in mimic config.
- Beat: highlight the active slot; when it's you → big flash + optional TTS.
  Show NEXT clearly. A "drift nudge" button (+/- 0.5s) to re-sync by feel.
- No bot needed for a single-group test. For raid-wide sync, add a shared
  `start_at` + order from the bot (Phase 1.5), same relay shape as H/E.

## Data shape (if/when shared)
```
ChChain = { guild_id, active, start_at, interval_ms, order: [cleric,...], updated_by }
```
Officer sets it (Discord `/chchain set` or web /admin), agents read it on poll.
Slot for a client = `floor((Date.now() - start_at)/interval_ms) % order.length`.

## Open questions for sign-off
1. **Driver:** timer-driven v1 (recommended) or hold out for callout-driven?
2. **Who configures the order** — each healer locally, or officer pushes one
   shared rotation to the raid?
3. **Interval:** is the classic Quarm CH chain a fixed cadence (e.g. one CH per
   ~N seconds per cleric), and what's N? Need the raid's actual chain timing.
4. **Inputs/feedback:** flash + TTS enough, or also a sound cue / a "tank HP"
   integration (we have target/self HP from Zeal — could show the tank's bar in
   the same overlay)?
5. **Scope check:** this is a real build (overlay + config UI + optional relay).
   Confirm it's wanted for the raid push vs. later — it's the least "get them
   hooked" of the batch and the most specialized (clerics only).
