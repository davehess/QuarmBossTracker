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

## Other guilds' macros, and teaching the tracker yours (agent 4.0.13, 2026-10-23)

What shipped is the callout-driven tracker (option 2 above): it reads the numbered calls in shout / raid / group / say chat. It
knew only Wolf Pack's shapes. In another guild's raid the guild lead saw
`D&D 333 CH - <target> - 61%` and asked where such macros end up in setup mode, or for the tracker to look for other patterns.

**The rule that shapes everything below (the guild lead): Wolf Pack's own shout chain must not change.** The original parser
(`_CH_CALL_RX`, `_CH_GO_RX`, the roster call, the spot-heal shout) is untouched and runs first. The additions are matchers tried
only on a line it did not claim. A hit is not applied to the chain directly: it is *translated* into the canonical text the original
reads (`003 - CH - <target> - Mana: 61%`, `003 GO GO GO`) and fed back through `trackChChainLine`, so slots, claimants, DDR grades,
the beat and the "0N GO" speech all come from the one existing code path. Two consequences worth knowing:
- A line the original *accepts* stays the original's reading even when a broader reader would add something: `3 CH Brackwyn 61%`
  is slot 3 with no mana (there is no "Mana" word), as it always was.
- The one place the original *drops* a line, a slot over 30, now gets a second look: `333 - CH - X` is the other guild's slot 3.
  `100 - CH - X` and `000 - CH - X` stay dropped (a slot is 1 to 30).
`test/ch-chain-wolfpack-regression.test.js` feeds a whole Wolf Pack chain (roster, every shout form, a DRUID gap-fill, GO cues, a spot
heal, an interrupt, chatter that mentions CH) through the tracker and compares the chain after every line, plus every spoken GO, with a
capture of the tracker from before this change.

### Formats the built-in matchers accept (`chParseBuiltinExtra`)
| Part | Accepted |
|---|---|
| Channel | raid, shout, say, group, guild (as before) and a custom channel whose name starts `ch`, `chain`, `heal` or `cleric` (`tells ch:1`) |
| Tag (optional) | one word of 1 to 6 characters that is not a number: `D&D`, `WP`, `[CH]` |
| Slot | digits with leading zeros (`007`), the digit repeated (`333` is 3, `55` is 5), `#3`, `3.`, `3)`, or after CH: `CH3`, `CH 3`, `CH#3`. 1 to 30 only |
| CH | `CH`, `C.H.`, `CHeal` (capitals, as in the original) and `Complete Heal` / `Complete Healing` (any case) |
| Separator | anything of `- — – : -> → \| < > [ ] ( ) , .` and spaces, plus an optional `on` |
| Target | a capitalised name, 3 to 15 letters, not a word like Mana / Next / Inc |
| Mana (optional) | `61%`, `Mana 61`, `mn 61`, `m61`, `(61%)`; over 100 is ignored |
| Go-cue | `3 GO`, `333 go`, `D&D 555 GO`, `GO 3`, `go 333`, `next 3`, `next up: 3`. Like the original's cue it steers only a chain that already exists, and the slot must be one it has |

A line needs CH (or Complete Heal), a slot and a name-shaped target. That is what keeps `Circled Toe Bones ran 333` and a loot call
out. A two-digit repeat is read as the digit (`11` is 1, not 11), per the macros seen; Wolf Pack's own `011` form is the original's.

### Teach it yours
Not every macro will be one of the shapes above. In the CH Chain overlay's setup mode, **Learn a CH call**:
1. Pick one of the recent lines the tracker could not read (it keeps the last 25 CH-looking ones, in memory), or paste a line.
2. The agent guesses a role for each word (digits are the slot, a `%` number the mana, the capitalised word after CH the target, a
   short word before the slot a guild tag). Click a word to cycle it: slot, target, mana, tag, ignore, plain. Choosing a role again moves
   it, so there is never a second slot.
3. The panel reads the line back, "Reads: slot 3 · target Brackwyn · mana 61%", or says why it cannot (no slot, a slot over 30, no fixed
   word). **Save this call** stores it.

A template is `{id, example, roles}`; the pattern is recompiled from those two fields, so there is one source of truth. Plain words must
match (any case); the slot, target and mana words are variables; a tag word is optional; the line may carry trailing text. A template
with a target is a CH call, one without is a go-cue. It must keep at least one fixed word, so a template cannot match ordinary chat.
Up to 12, listed in the same panel with a ✕ each. They live in the agent's `logsync.prefs.json` (`ch_templates`) and nothing uploads.
Taught templates are tried before the built-ins, and neither is tried on a line the original parser claims.

The first time a line with a standalone `CH`, a number and a capitalised name matches nothing, setup mode shows
"Unrecognised CH call — teach it?" once per overlay session; **Teach it** opens the panel on that line.

Endpoints (local only): `GET /api/chchain/learn` (templates, unread lines, the hint), `POST /api/chchain/learn`
(`{example, roles}` saves, `{dry:true, ...}` previews, `{guess:true, example}` suggests roles), `POST /api/chchain/learn/remove {id}`.
