# Trigger overlay v2 — slow labels, one row per mob, and a mute/feedback loop

Spec from Hitya, 2026-08-10 (post-Ssra). The trigger overlay is *"that area is
critical, the most critical on the page"* — this doc is the plan for it.

Grounding for everything below: `eqemu_spells` SPA-11 sweep (79 detrimental
attack-speed spells) + `eqemu_items.proc_effect` join, run 2026-08-10. Slow % is
`100 - raw->max` for the SPA-11 slot, the same derivation the existing
`SLOW_MAGNITUDES` table was verified with on 2026-07-23.

---

## 1. Say the source in full, not an abbreviation

`SHM SLOW` is fine as a *short* form, but the label should read as words:
**SHAMAN SLOW**, **BEASTLORD SLOW**, **ENCHANTER SLOW**, **BARD SLOW**,
**TRIDENT SLOW**, **ROGUE POISON SLOW**, **DISEASE SLOW**.

Today `SLOW_CLASSES` covers 11 spells and only three classes (SHM/ENC/BST). It
has no concept of a NON-class slow source, which is why a Willsapper proc had
nowhere to land and got crowned as a shaman spell (see
`FINDINGS-2026-08-10-trigger-overlay.md` §7b). The source table needs to be
grounded and complete:

| Label | Spells (slow %) |
|---|---|
| **SHAMAN SLOW** | Turgur's Insects 75, Togor's 70, Tagar's 50, Tigir's 50, Walking Sleep 35, Drowsy 25, Cloud of Grummus 40 |
| **ENCHANTER SLOW** | Forlorn Deeds 70, Shiftless Deeds 65, Tepid Deeds 50, Slow 35, Languid Pace 30, Lethargy 50 |
| **BEASTLORD SLOW** | Sha`s Revenge 65, Sha's Vengeance 55, Sha's Advantage 50, Sha's Lethargy 30 |
| **BARD SLOW** | Requiem of Time 55, Melody of Mischief 45, Selo`s Consonant Chain 40, Selo`s Assonant Strane 40, Angstlich's Assonance 40, Largo`s Melodic/Absonant Binding 35, Selo`s Chords of Cessation 25 |
| **ROGUE POISON SLOW** | Paralyzing Poison I/II/III 50, Matriarch Poison 40, Paralyzing Neurotoxin 30, Greater Shadow Poison 25, Lesser Shadow Poison 5 |
| **DISEASE SLOW** | Decay of the Plaguebringer 60, Diseased Cloud 55, Plague of Insects 25 |
| **TRIDENT SLOW** | Waves of the Deep Sea 10 — `Trident of the Deep Sea`, also `Club of Slime` |
| **PROC SLOW** (generic item) | Energy Sap 35 (`Willsapper`), Breath of the Sea 20 (`Wavecrasher`, `Mutum's Ghostly Fleshstopper`, `Vyledorinajirnak the Seas Justice`) |
| **BOSS SLOW** | Rage of Ssraeshza 90, Curse of Xerkizh 80, Storm Comet 90, Enveloping Entropy 90 |

⚠ **`Waves of the Deep Sea` is already a live guild trigger** (180s timer, listed
under "Left ON deliberately" in the findings doc). It is a 10% slow off a
Trident proc — worth knowing before anyone reads its callout as a real slow.

⚠ The label is only honest when the spell is IDENTIFIED. Eleven spells share
`yawns.` and six share `slows down.`, so a bystander landing often cannot name
the source at all — agent 3.5.57 already reports those as `SLOWED` with no class
and no percentage. **A source label must never be inferred from an ambiguous
crown**; it comes from a named cast (self-cast or relayed) or it stays generic.

## 2. One row per mob — never eight

Two separate causes, one already fixed:

- **FIXED (agent 3.5.56, beta):** `_startTimer` folded the raw log line into the
  timer id, so every fire created a new row. This is the wall-of-rows in the Ssra
  screenshots. Identity now comes from semantic captures only, and a resolved
  `timer_key_capture` IS the identity — so a re-slow on the same mob resets one
  bar. Test: `test/trigger-timer-identity.test.js`.
- **FIXED (agent 3.5.56 + bot 3.1.37):** cross-observer duplicates. Relay dedup
  keys carried each observer's own raw log line (and therefore their clock), so N
  raiders watching one event produced N distinct keys. Keys are now built from
  semantic captures, and the bot resolves fire timestamps to true time before
  dedup — the clock-skew involvement Hitya asked for. Tests:
  `test/relay-clock-skew.test.js`, `test/relay-true-time.test.js`.

**Still to do:** a hard invariant at RENDER time — at most one slow row per mob,
regardless of how many triggers or observers produced it. The fixes above remove
the known causes, but the overlay should not be able to show a second row even if
a new cause appears. Collapse by `(mob, effect-class)` and keep the strongest /
longest.

## 3. Overlap is the top bug — the background text must stay readable

Rows currently squish and overlap the game behind them. Requirements:

- rows must never overlap each other or become unreadable;
- **grow upward** — the overlay is anchored at its bottom edge, so new rows push
  up instead of expanding down over the game UI;
- a hard cap on visible rows with an overflow indicator ("+3 more") rather than
  unbounded growth;
- the short form is fine here: **class + % + mob name** on the countdown.

## 3b. The screen is already full — where the timers may and may not go

From two live Ssra screenshots (Hitya, 2026-08-10). Everything up at once:

| Region | Occupant |
|---|---|
| top-left | Target Info (stats/debuffs/resists) |
| left column, full height | Command Center — MT/target HP, Rampage, defensives, the healer mana list, curse/cure |
| top-right | Extended Target — boss rows, tank list, **a wrapping horizontal row of debuff timer chips** |
| right | DPS meter |
| bottom-right | CH chain (7 slots + off-heal candidates + DI) |
| bottom-centre-right | Tank overlay — MT/target bars, Rampage, CH beat, damage shield, buffs, off-heal |
| **centre** | **the game.** Character positioning, the raid, the mob. |

*"The middle of the screen is crucial area for positioning, but that whole line
of timers was awful to compete with."* So:

- **The centre is reserved.** The momentary TTS/callout alert may flash there —
  that is its job, and it clears in a few seconds. **Persistent countdown timers
  must not live there**, which is the concrete reason to split them out (§4).
- Timers anchor **bottom-up** in their own window, so a growing stack never
  creeps into the play area.
- Note there is ALREADY a second timer surface: the Extended Target chip row
  (`Immolate 62s · Occlusion of Sound 15s · Tuyen's Chant of Flame 14s ·
  Greenmist 32s · Funeral Pyre of Kelador 4s`). It wraps to a second line as it
  fills. Whatever the trigger-timer overlay becomes should not duplicate what is
  already on that row — decide which surface owns boss debuff countdowns before
  building a third one.
- The second screenshot also shows the real competition: EQ's own chat, group,
  hotbars, Hit Me / My Melee and target ring take the bottom third. Any "just
  move it lower" answer has to survive that.

## 4. Split the surfaces

*"The regular triggers/timers need separate space or be separable to two
different overlays as an option… the timers really need to go somewhere else."*

Make the countdown TIMERS a separate overlay window from the big centered TTS /
callout ALERTS, as an option (default on). They have different jobs: an alert is
a momentary shout, a timer is a persistent bar you read. Sharing one window is
why the timers crowd the callout.

Both must satisfy the overlay feature-parity checklist in `CLAUDE.md` (✕, ✥ +
right-click menu, hover-interact handshake, dashboard row, `apply*Visibility()`,
`_HIDEALL_FLAGS`, `_overlayEntries()`).

## 5. Font size on the callout

The big clear TTS/callout text needs a user-settable font size. Setting lives
with the other overlay prefs; applies to the alert overlay only.

## 6. The mute / correct / edit loop — an EVERYONE workflow

Hitya, 2026-08-10: *"i need the mute wrong button to be an everyone workflow. no
one of us can do it best, and suggestions on what's wrong need to come in. if
it's wrong, we should add it in as a queue item. Something marked wrong that we
could play back would be ideal. Hear the TTS fire while watching the fight
happen."*

Two things that follow, and neither is officer-gated:

- **Filing is open to the whole raid.** Trigger curation has been one person
  reading a table, which is how 37 of 109 enabled triggers ended up dead without
  anyone noticing — an enabled trigger reads as coverage. The raid hears every
  fire; they are the sensor. Anyone can mute, anyone can file Wrong, anyone can
  attach a suggestion.
- **Volume is the ranking signal.** Dedup reports by (trigger, ~same fire) so
  five people flagging one callout becomes ONE queue item with five reporters,
  not five items. Reporter count is the priority, replacing a judgement call
  nobody is well placed to make alone.

### ⏪ The replay half already exists — do not rebuild it

`#101` shipped the hard part (`docs/HOW-ITS-BUILT.md:1144`):
`startReplay`/`_replayWorker` walk any slice of a log back through the **real**
trigger pipeline — pattern, cooldown, suppression — and speak the actual TTS.
Fires are tagged `_replay`, nothing uploads or relays, live cooldowns are
untouched, and it refuses mid-fight. It is driven by `POST /api/replay/start` on
the agent, exposed as the ⏪ Replay card on the dashboard's Triggers tab and as
**"⏪ Replay this fight locally"** on every `/parses/[id]` page, which already
pre-fills the fight's time window.

So *"hear the TTS fire while watching the fight happen"* is mostly a **linking**
job, not a new engine:

1. A Wrong report records what is needed to reconstruct a replay window —
   `trigger_id`, the matched line, `character`, the log file, the fire timestamp,
   `encounter_id` when the fire happened inside a known fight, and `agent_version`.
2. "Replay this report" = `/api/replay/start` over `[ts - 30s, ts + 30s]` on that
   character's log. One click, the same engine, and the reporter hears exactly
   what they heard on raid night.
3. When `encounter_id` is set the report also deep-links to the parse page, so the
   fight timeline is on screen while it replays — the "watching the fight happen"
   half, already built.

**Privacy is satisfied by construction, and this is load-bearing.** The agent
filters officer chat, tells, group and custom channels at the BYTE level *before*
parse (`docs/PRIVACY.md`), so a line that reached a trigger is already a line we
are allowed to keep. Capturing the matched line adds no new exposure. Capturing
surrounding *context* lines would — those have not been through the trigger
filter — so context stays LOCAL for replay and is never uploaded. The report
carries the matched line only; the replay reads the user's own log on their own
machine, which is exactly how #101 already works.

### The report becomes a queue item

A Wrong report is a work item, not a log entry. New `trigger_reports` table
(reporter, trigger_id, matched line, ts, encounter_id, agent version, free-text
suggestion, status), surfaced as a queue on `/admin/triggers` ranked by reporter
count, with the status flowing open → fixed/won't-fix. This is the officer-facing
half; filing stays open to everyone.

### The rest of the loop

The point: *"so they don't get spammed"*, self-service, without an officer.

1. **Mute from the moment it fires.** Every TTS callout and every timer chip
   carries a mute control while it is on screen. One click and that trigger stops
   speaking/showing for this user.
2. **A "Wrong" button** next to the callout. Distinct from mute — mute is "not
   for me", Wrong is "this trigger is broken." It should file a report the
   officers can see (trigger id, the line that matched, the user, the time), so a
   dead or mis-signatured trigger surfaces from real use rather than an audit.
   This is the direct counter to the 37-dead-triggers problem: an *enabled*
   trigger reads as coverage until someone says otherwise.
3. **An edit window** on the TTS/timer, so a user can fix their own callout text,
   timer length or cooldown without leaving the game.
4. **End-of-night prompt**: list what they muted tonight and ask whether to keep
   it off permanently. Mutes default to session-scoped so a bad raid night does
   not silently delete a callout forever.
5. **Tell them when it is fixed.** If a muted trigger is later edited or its
   "Wrong" report resolved, notify that user and offer to unmute. Otherwise a mute
   is a one-way door and the user never gets the fixed version.

Storage: per-user mutes belong next to `personal_triggers.json` /
`character-prefs`, not in `guild_triggers` — one user's mute must never mute the
raid. "Wrong" reports need a new officer-visible surface (a table + a row on
`/admin/triggers`).

---

## Staged plan

| Stage | Scope | Where | State |
|---|---|---|---|
| **1** | Graduate agent 3.5.56/3.5.57 to stable — the duplicate + skew + ambiguity fixes are done but sitting on a channel with no users | `main` | **done** — `STATUS.md` records the timer-identity fix as stable (task #27 unblocked) |
| **2** | Overlap/readability + grow-upward + one-row-per-mob render invariant | Mimic `triggers.html` | **built 2026-08-11** with #207 (unreleased). Bottom-anchored stack growing upward, 6-row cap + "+N more", `collapseTimers` one-row-per-(mob, effect class) for slows, `--timers-space` keeps the centre flash off the stack. `main.js` makes the trigger overlay grow-up **by default** (`_GROW_UP_DEFAULT_KEYS` / `_growUpSetting`) |
| **3** | Split timers into their own overlay (option, default on) + callout font size | Mimic + dashboard | open. Still worth doing: the bottom anchor bounds the problem but the flash and the stack still share one window, so a tall stack still nudges the centred flash (by half the stack height) |
| **4** | Full source labels (table in §1), driven off named casts only | agent + `mobinfo.html` | open — the chip still reads `mob - <trigger name>`, with no class or % |
| **5** | Mute + Wrong + inline edit + end-of-night prompt + notify-on-fix | agent + bot + `/admin/triggers` | open. #207 landed the **half of §6.1 that is not a mute**: every countdown and every pinned callout can be cleared, per-user and session-scoped, and the clearing is now RECORDED (`dismissed`/`expired` on `trigger_timing_feedback`) so the queue this stage builds has evidence to rank by |

Stages 1-3 are what stops the bleeding on raid night. 4 is polish on top of the
3.5.57 honesty work. 5 is the biggest build and the one that changes officer
workflow, so it wants its own review.

⚠ **Stage 1 is the highest-leverage item and is not a code change.** Beta
adoption is ~zero (session digest, and 33 observers reported on 3.5.54/3.5.55
during the Ssra raid). Every fix from 2026-08-10 — the wall of duplicate rows
included — is on `beta` where nobody runs it.
