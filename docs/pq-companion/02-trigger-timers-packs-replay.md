# pq-companion vs. Wolf Pack — trigger timers, trigger packs, log replay/backfill

**Scope of this doc:** timer semantics on a trigger, the trigger action set, the
built-in "community" trigger packs (storage / versioning / update flow), and the
log replay + backfill machinery used to exercise triggers against real gameplay.

**Legal / sourcing note.** `pq-companion` (clone at
`…/scratchpad/pq-companion`, upstream `jasonsoprovich/pq-companion`) carries
**no license — all rights reserved**. Everything below is a *behavioural
description* with `file:line` pointers so a reader can go look; the only verbatim
material is a handful of clearly-marked sub-10-line quotes. **Every code sketch
in §4 is original, written for our stack.** Do not copy their source.

Paths are relative to each repo root: `pq-companion/…` for theirs,
`/home/user/QuarmBossTracker/…` for ours.

---

## 1. Their timer semantics, in full

Their timer lives in two layers, and the split is the single most important
structural idea in the whole system:

| Layer | File | Job |
|---|---|---|
| **Trigger engine** | `backend/internal/trigger/engine.go` | match a line → resolve *what* timer to start (key, duration, target, category) → hand it to a sink |
| **Spell-timer engine** | `backend/internal/spelltimer/engine.go` | own the timer map, dedup, expiry, kill-sweeps, sorting, broadcast |

The seam is a 2-method interface (`pq-companion/backend/internal/trigger/engine.go:40`)
so the *same* timer store is fed by trigger fires **and** by the real
spell-landed log pipeline — which is what makes the dedup/merge behaviour in
§1.7 possible at all.

### 1.1 Duration sources (four, in priority order)

`resolveTimerDuration` — `pq-companion/backend/internal/trigger/engine.go:984`:

1. **Matched extra-pattern override.** `ExtraPattern.TimerDurationSecs`
   (`backend/internal/trigger/models.go:149`) — a merged "Mez" trigger carries
   one pattern per spell, each with its own duration.
2. **Capture-derived duration.** `Trigger.TimerDurationCapture` names a capture
   group whose *text* is parsed into seconds (`models.go:231`).
3. **Fixed `TimerDurationSecs`.**
4. **Spell-focus extension.** If `SpellID > 0`, `StartExternal` looks the spell
   up and runs `applyDurationModifiers` — item/AA duration focuses stretch the
   trigger-driven timer to the same length the real spell-landed pipeline would
   produce (`backend/internal/spelltimer/engine.go:726-732`, `:2042`).

`ParseDurationText` (`trigger/engine.go:944`) accepts **plain seconds
(`400`), colon notation (`6:40`, `1:02:03`), and unit notation (`6m40s`, `2h`,
`90s`)** — and the frontend re-implements the identical grammar so the
quick-add box and the backend agree
(`frontend/src/components/overlays/CustomTimerPanel.tsx:61`).

### 1.2 Timer identity — three independent capture-driven axes

- **`TimerKeyCapture`** (`models.go:233`) — the captured text becomes the timer
  *key* instead of the trigger name. One "Mez" trigger runs N independent
  countdowns keyed by real spell name. Crucially the worn-off pattern must
  capture the *same* group, and `resolveTimerKey` (`trigger/engine.go:846`)
  zeroes the `SpellID` on a captured key so a stop-by-id can't kill a sibling
  spell's row (`trigger/engine.go:258-270`).
- **`TimerTargetCapture`** (`models.go:245`) — does *two* jobs: (a) becomes part
  of the composite timer key `"<spell>@<target>"` (`spelltimer/engine.go:742`,
  `:202`) so the same buff on five people is five rows; (b) **rebinds the
  `{target}`/`{t}` action token for that fire** (`trigger/engine.go:708-712`),
  so the TTS says the name on *this* line rather than whatever you happen to be
  targeting.
- **Fallback to inferred combat target** when the trigger has no capture
  (`trigger/engine.go:755-758`) — explicitly so a literal-name boss trigger
  still binds a target and doesn't get swept by the orphan cleanup (§1.6).

### 1.3 Early end / worn-off

`WornOffPattern` is a **second compiled regex per trigger**, evaluated on every
line *independently of whether the primary matched* (`trigger/engine.go:258`).
On match it calls `StopExternal(key, spellID)`, which removes by **name OR
spell-id** (`spelltimer/engine.go:857`) so a buff that fades via flavour text
("Your body slows.") still clears a row the spell-landed pipeline created under
the canonical DB name.

Additional automatic ends:
- `removeOnKill` (`spelltimer/engine.go:1569`) — exact target-name match, plus
  a **sweep of every target-less detrimental** on any kill. Their own comment
  admits the cost (an unrelated pet death wiping a boss debuff); the fire()-side
  target fallback in §1.2 is the mitigation.
- `removeSelfTimers` on player death (`:1521`), matching both the resolved name
  and the literal `"You"`.
- Charm timers are **excluded from the orphan sweep** (`IsCharm`,
  `spelltimer/models.go:121`) — a charmed pet is a living ally, so killing the
  mob it tanks must not drop the charm bar.
- `ClearCategory("buff" | "detrimental" | "custom" | "ch_chain" | "all")`
  (`spelltimer/engine.go:891`).

### 1.4 Restart / refire behaviour

Two *separate* knobs, and they are careful about the distinction:

- **`RefireCooldownSecs`** (`models.go:261`) — silent anti-spam lockout, no
  timer, no overlay. Tracked per trigger ID on the engine, deliberately **not**
  on the recompiled pattern slice, so an unrelated CRUD edit doesn't reset
  in-flight cooldowns (`trigger/engine.go:109-114`, `:660`). Fractional values
  allowed so GINA/EQNag sub-second cooldowns survive import.
- **`CooldownSecs`** (`models.go:271`) — a *second visible* timer alongside the
  duration timer, keyed `"<Name> CD"` (`trigger/engine.go:890`), always rendered
  on the buff overlay, with an auto-injected "…ready" TTS at 1 s remaining
  (`:899-920`). Works even on alert-only triggers (Lay on Hands, Feign Death).

`passesRefireCooldown` compares **log-line timestamps, not wall clock**
(`trigger/engine.go:658-659` — their comment says this is explicitly so replay
behaves deterministically).

Restart-in-place is implicit: `StartExternal` writes into a keyed map, so a
re-fire on the same key overwrites `StartsAt`/`ExpiresAt`.

### 1.5 Warning thresholds ("fading soon")

`TimerAlert` (`trigger/models.go:122`) is a **list per trigger**, not a single
slot: `{id, seconds, type: play_sound|text_to_speech, sound_path, volume,
tts_template, voice, tts_volume}`. A long buff can carry 300 s **and** 60 s; a
mez carries 10 s.

- Capture references inside `tts_template` are substituted **at fire time**
  server-side (`marshalTimerAlerts`, `trigger/engine.go:603`), except `{spell}`
  which is deliberately left for the client because the resolved spell name
  isn't known until the timer materialises.
- The alert list is carried **opaquely on the timer row** as `json.RawMessage`
  (`spelltimer/models.go:98`) and re-emitted on the WS payload; spelltimer never
  introspects it.
- Firing is **client-side edge detection**: `useTimerAlerts`
  (`frontend/src/hooks/useTimerAlerts.ts:38`) keeps `prevRemaining` per timer ID
  and fires when it crosses from above→at-or-below a threshold. Recasts re-arm
  automatically because remaining jumps back up. Per-overlay bell mutes are read
  from localStorage.
- A separate global **repeat-audio cooldown** (`trigger_audio_cooldown_secs`,
  `frontend/src/types/config.ts:140`; gate in
  `frontend/src/hooks/useAudioEngine.ts:61-70`) rate-limits repeat audio per
  trigger id, independent of the trigger's own refire lockout.

### 1.6 Expiry policy — "keep expired" overdue mode

`pruneExpired` (`spelltimer/engine.go:1855`) has a user-configurable mode. With
*keep expired* on, a past-expiry buff/detrimental is **not deleted**: it lingers
up to `keepExpiredMaxOverdue = 60 min` (`:1813`), `snapshot()` emits
`remaining_seconds` **negative** plus `expired: true` (`:1996-2014`), and the
overlay renders it as a red count-up "needs refresh" row
(`CustomTimerPanel.tsx:82-94`, `:123` shows `+Ns`). A worn-off signal in this
mode doesn't drop the row either — `removeTimer` just pulls `ExpiresAt` back to
now (`:1493`).

### 1.7 Dedup / merge against the real spell pipeline

The subtlest behaviour in the file (`spelltimer/engine.go:771-808`): if a
same-spell-name timer was created within `dedupGraceWindow = 3 s` (`:150`),
`StartExternal` does **not** add a second row — it **merges the trigger's
metadata onto the existing timer** (display threshold, timer alerts, bar colour,
pinned, custom group). Stated rationale, and it's a good one: *spell-landed wins
on identity (target, focus-accurate duration); the trigger wins on metadata,
because a trigger is the user's declaration of "treat this spell specially."*

There is also a **deferred-render** path (`:747-769`): three mez spells share
land text, so a trigger fire only stashes a `pendingArm` (TTL 10 s, `:184`) and
the visible timer materialises **only if the spell actually lands** — a fizzle /
resist / interrupt never paints a phantom bar.

### 1.8 Display, colour, sort, and multiple timer windows

- **Per-trigger `BarColor`** (`models.go:287`) overrides the automatic
  cyan→orange→red urgency ramp (`CustomTimerPanel.tsx:48`, `:90`).
- **Per-trigger `DisplayThresholdSecs`** (`models.go:279`) — hide the row until
  remaining ≤ N. Trigger-level value overrides the global per-category setting;
  spell-landed rows emit 0 so a settings change applies retroactively
  (`spelltimer/models.go:86-92`).
- **`Pinned`** (`models.go:352`) — pinned timers sort as a group above unpinned,
  then ascending remaining within each group (`spelltimer/engine.go:2020-2030`).
- **`CustomGroupID` → named Custom Timers windows.** `TimerGroup`
  (`backend/internal/trigger/timergroup.go:16`) is a user-created *extra overlay
  window*; a trigger's timer renders in whichever window its group points at
  (`CustomTimerPanel.tsx:177-179`). Referenced by ID not name so rename never
  cascades, and deleting a group reassigns its triggers to the default window
  rather than deleting them (`timergroup.go:151-173`). Raid leaders can put boss
  timers in their own window.
- Timer categories: `buff | debuff | mez | dot | stun | ch_chain | ch_chain_2 |
  custom` (`spelltimer/models.go:26-44`), each with its own overlay window
  (`frontend/src/components/overlays/{Buff,Detrim,Custom,Respawn}TimerPanel.tsx`).
- Per-row ✕ dismiss (`RemoveByID`, `spelltimer/engine.go:1471`), plus a manual
  quick-add form (name + `5m`/`300`/`6:40` + colour picker + alert bell) in the
  Custom Timers panel (`CustomTimerPanel.tsx:274-364`).

### 1.9 Action set (5 types) and pattern conveniences

`ActionType` (`trigger/models.go:16-33`): `overlay_text`, `play_sound`,
`text_to_speech`, `clipboard`, `discord_webhook`.

- **`clipboard`** receives the same capture substitution, so `"/tar {1}"` becomes
  a ready-to-paste in-game command (`models.go:23-27`). Genuinely clever.
- **`discord_webhook`** stores only an opaque `WebhookID` on the action, never
  the URL (`models.go:97-106`) — because actions round-trip through pack
  export and a webhook URL is a bearer credential. Dispatch resolves the ID at
  fire time, validates the host against a discord.com regex
  (`trigger/engine.go:775`), 5 s HTTP timeout (`:785`), one goroutine per post so
  a slow Discord can't stall log parsing (`:822-839`).
- **`overlay_text` styling per action**: `position {x,y}` (pin vs. stack),
  `font_size`, `glow_color`, `font_family`, `align`
  (`trigger/models.go:69-95`) — with an interactive Test/Position drag flow via
  `POST /api/triggers/test-overlay` (`backend/internal/api/triggers.go:875-940`).
- **Pattern tokens** (`normalizePattern`, `trigger/engine.go:511`): `{c}`/`{char}`/
  `{self}` expand to the active character *at compile time* (so `Reload()` reruns
  on character change, `main.go:1517-1519`); `{S}`/`{S1}…{S9}` → named text
  groups; `{N}`/`{N1}…` → number groups; **.NET `(?<name>…)` is rewritten to Go
  `(?P<name>…)`** so raw GINA regexes compile.
- **`ExtraPatterns`** — OR semantics, individually toggleable, first match wins
  and supplies both captures and per-row timer overrides (`trigger/engine.go:249-254`).
- **`ExcludePatterns`** — suppress the fire when any also matches the same line
  (`trigger/engine.go:255`, `matchesAny` `:472`); their workaround for RE2 having
  no lookbehind. The "Incoming Tell" trigger uses ~14 of them.
- **`Characters[]`** — per-character targeting (`triggerAppliesTo`, `:642`),
  empty = any.

### 1.10 Non-log trigger sources (pipe)

`Source: 'log' | 'pipe'` (`trigger/models.go:206`). Pipe triggers carry a typed
`PipeCondition` instead of a regex: `target_hp_below`, `target_name`,
`buff_landed`, `buff_faded`, `pipe_command` (`models.go:163-181`). All five are
**edge-detected against previous state** held on the engine
(`trigger/engine.go:101-104`) so a ~100 ms pipe tick doesn't machine-gun, with
`HandlePipeReset()` (`:418`) clearing edge state on pipe disconnect so a fresh
Zeal session doesn't see a spurious transition. `prevHP == 0` (no prior read) is
treated as 101 so selecting an already-low target fires once (`:322-329`).
`pipe_command` matches text the player types as `/pipe <text>` in game — a
manual, in-game trigger button.

---

## 2. Pack + replay/backfill mechanics

### 2.1 Packs: where they live and how they're shaped

**Packs are Go source, not data files.** `backend/internal/trigger/packs.go`
(3205 lines) defines every built-in pack as a function returning a
`TriggerPack{PackName, Description, Class *int, Triggers []Trigger}`
(`trigger/models.go:380`). `AllPacks()` (`packs.go:2701`) returns:

- **15 class packs** — Enchanter, Cleric, Druid, Shaman, Paladin, Shadowknight,
  Warrior, Monk, Rogue, Ranger, Bard, Magician, Necromancer, Wizard, Beastlord.
- **8 general packs** — `General Triggers` plus the **seven community packs**:
  **Caster Alerts, Crit Alerts, Spell Breaks, Group Alerts, Raid Alerts,
  Tracking, Misc Alerts** (`packs.go:2305-2700`).

Two *generic transforms* run over class packs at `AllPacks()` time rather than
being hand-written into ~50 literals (`packs.go:2731`):

- `applyDefaultTimerAlerts` (`packs.go:116`) — every timer trigger without its
  own alerts gets a default: buffs < 1 h → "fading soon" TTS at **60 s**, buffs
  ≥ 1 h → **300 s**, detrimentals → "expiring" at **10 s** (`packs.go:15-27`).
  Triggers whose duration is too short for the threshold to be useful are left
  alone.
- `applyBuffTargetCapture` (`packs.go:98`) — rewrites the "lands on other" branch
  of every buff pattern to wrap the player-name class in `(?P<target>…)` and sets
  `TimerTargetCapture="target"`, so group buffs automatically get per-recipient
  rows and the grey "on <name>" suffix.

`Class *int` is a **pointer** so "missing" is distinguishable from "0 = Warrior"
(`models.go:389`); on install, a class pack defaults its `Characters[]` to only
that class's characters.

**Cross-pack dedup — `DedupKey`** (`models.go:321`): a conceptual identity
("`charm_broke`", "`disc_resistant`"). `insertPackTriggers` (`packs.go:3053`)
skips a trigger whose key another installed pack already owns; `UninstallPack`
(`packs.go:3118`) **promotes** an orphaned key from a still-installed pack
(`promoteOrphanedTriggers`, `:3145`). `SourcePack` records the owning pack
separately from `PackName` (the display category), so a pack trigger moved into
a user category is still removable on pack uninstall.

### 2.2 Pack *versioning* — the baseline three-way diff

This is the strongest idea in the whole repo and we have nothing like it.

Because packs are compiled into the binary, a new release changes pack
definitions under an existing install. On install they snapshot the **raw shipped
definition** of each trigger into a `pack_baselines` table
(`packs.go:3062`, `rawPackDefs` `:3092`), keyed by a stable `PackKey`
(`packupdate.go:36` — an explicit key survives a *developer* rename; the trigger
`Name` survives a *user* rename). That gives a **three-way merge**:

> baseline ≠ shipped definition → the developer changed it (update available)
> baseline ≠ user's row → the user customized it
> — `pq-companion/backend/internal/trigger/packupdate.go:16-17` (quoted)

`ComputePackDiff` (`packupdate.go:262`) classifies each pack key into
**Changed / Added / Removed / DeletedLocally / UpToDate**, with a per-field
`FieldDiff{field, label, old, new, current, user_customized}` (`:184`) over 22
declared diffable fields (`packFields`, `:57-134`). `Characters` and `SortOrder`
are deliberately excluded as per-user context.

`ApplyPackUpdate` (`packupdate.go:411`) runs in one of two modes:
- **`preserve`** — per-field merge: any field the user didn't touch takes the new
  definition, customized fields keep the user's value (`:516-522`).
- **`reset`** — wholesale replace, re-deriving default characters.

Plus: a `keys []string` selection so the user can apply a subset; **baselines
advance only for applied triggers**, so a deselected change stays flagged;
locally-deleted definitions are **opt-in only** and never resurrected by
"apply all" (`:542-551`); stale baselines get purged (`:568-577`).
UI: `frontend/src/components/PackUpdateModal.tsx`, badge counts from
`ComputeUpdateSummaries` (`:365`), routes at `backend/internal/api/router.go:512-516`.

### 2.3 Pack *hotfixes* — `DefaultUpdate` migrations

Separate, narrower mechanism for "fix an installed pack without a reinstall"
(`packs.go:2746-2905`). A `DefaultUpdate` has an immutable `Key`, runs **at most
once** (recorded in `pack_default_updates`), and can only do **additive** things:
`AppendExcludePatterns`, `SetCooldownSecs`/`SetRefireCooldownSecs` **only if
still 0**, or `InsertTrigger` (skipped if the pack isn't installed, so it never
resurrects a removed pack). Errors are logged, marked applied, and skipped so one
bad migration can't loop (`ApplyDefaultUpdates`, `:2918`). 14 shipped so far —
including 5 "add this Ring War signature-spell trigger" inserts and 5 matching
"retrofit a 3 s refire cooldown" fixes for an AE double-fire bug.

### 2.4 The rollback postmortem — what actually went wrong

`pq-companion/docs/trigger-pack-rollback-2026-06-10.md`. The 2026-06-10 batch did
three things at once: shipped the 7 community packs, converted per-class
Charm/Root/Snare break alerts into shared dedup-keyed helpers, and consolidated
the Enchanter pack from 35 → 23 triggers via merged spell-line triggers.

The doc's own lessons, worth internalising:

1. **Installed packs are never mutated in place.** Merged triggers only arrive on
   an explicit reinstall. (Written *before* the baseline-diff system existed;
   that's the "never silently change a user's rows" instinct that later became
   §2.2.)
2. **The actual field bug: dedup is install-time only.** Pre-existing class-pack
   rows have no `dedup_key`, so a user with an old Enchanter pack + a new "Spell
   Breaks" install gets **double break alerts**. There was no migration to
   backfill dedup keys onto existing rows.
3. **A wholesale `git revert` was the wrong rollback** — reverting the commit that
   added shared break alerts would also delete the seven new packs. They had to
   document a surgical revert path instead.
4. **They pre-staged the escape hatch**: `docs/legacy-packs-2026-06-10/{bard,
   druid,enchanter,paladin,wizard}.json` are the exact pre-change definitions as
   importable `TriggerPack` JSON, so a user can roll back **without a release**
   (import replaces all triggers in that `pack_name`).
5. The engine work (`ExtraPattern` overrides + `timer_key_capture`) is called out
   as purely additive and **never worth reverting** — a clean separation of
   "mechanism" (safe) from "content policy" (risky).

### 2.5 Import (4 formats) — the on-ramp

`ImportPreview` → review → commit (`backend/internal/trigger/importer.go`,
routes `router.go:499-502`). Detected formats: `pqc | gina | eqnag | eqlogparser`
(`frontend/src/types/trigger.ts:383`). Per-trigger `warnings[]` for lossy
mappings and a `regex_ok` flag — **a pattern that won't compile under RE2 is
imported *disabled* and flagged for manual editing** rather than dropped
(`types/trigger.ts:397-404`, `gina.go:173-178`). GINA specifics
(`gina.go:97-180`): walks nested `TriggerGroup`s and records the slash-joined
group path; maps `TimerType ∈ {Timer, RepeatingTimer}` → a timer (Stopwatch
unsupported); combines multiple `TimerEarlyEnders` into one alternation regex;
`ginaDurationSecs` (`:194`) accepts seconds/float/HH:MM:SS/milliseconds.

### 2.6 Replay — the user-facing "test my triggers" path

`backend/internal/logparser/replayer.go` + `backend/internal/api/replay.go` +
`frontend/src/pages/LogFeedPage.tsx:167-390`.

- **Same callbacks as the live tailer.** `NewReplayer(dispatchEvent,
  dispatchLine, onSession, onStatus)` (`main.go:1534`) is handed the *identical*
  central dispatch closures the live tailer uses (`main.go:1411`, `:1448`) — so a
  replayed line drives triggers, timers, combat meter, threat, overlays exactly
  as a live one does.
- **Session isolation is coarse:** `onSession(true)` pauses the live tailer;
  `onSession(false)` clears all timers and resets the combat tracker
  (`main.go:1534-1539`). That's the whole isolation story — see §3 for why it
  isn't enough.
- **Pacing:** wait the true inter-line gap ÷ speed, capped at
  `replayMaxGap = 3 s` so AFK stretches don't stall (`replayer.go:19`, `:249-257`).
  Speed clamped 0.1–100 at the API (`:136-145`); the UI offers 1/2/5/10/25×
  (`LogFeedPage.tsx:296-303`). Pause/Resume/Stop with a 100 ms poll step
  (`:22`, `:311-349`), cooperative cancel via a closed channel claimed under the
  lock so a double-Stop can't double-close (`:205-218`).
- **The timestamp remap — the load-bearing detail.** Lines are dispatched with
  `dispatchTS = time.Now()`, **not** the log timestamp (`replayer.go:274-281`).
  Their comment says exactly why:

  > the spell timer and trigger engines compute expiresAt as (timestamp +
  > duration), so a historical timestamp … produces an expiry already in the
  > past and the overlay disappears within a frame of appearing
  > — `pq-companion/backend/internal/logparser/replayer.go:269-272` (quoted)

  The *original* log timestamp is still used for pacing, range filtering and
  position reporting. **We have this exact bug — see §3.1.**
- **Range picking without reading the file.** `probeLogRange`
  (`api/replay.go:119`) reads only 256 KB from each end to get first/last
  timestamps, used to pre-fill the datetime pickers.
- **Path safety:** base-name-only validation, must start `eqlog_`, must exist
  inside the configured EQ dir (`api/replay.go:76-90`); file opened read-only,
  never modified.
- **UX affordances we lack:** file picker listing every `eqlog_*` with character
  + size, sorted most-recently-played first (`api/replay.go:35-63`); a progress
  bar computed from position-within-window (`LogFeedPage.tsx:246-252`); a
  right-click **"Play from this point"** on any browsed log line
  (`LogFeedPage.tsx:718-739`); selections persisted in localStorage with a 30-min
  idle TTL so navigating away mid-iteration doesn't lose your place
  (`frontend/src/hooks/useReplayPrefs.ts`).

### 2.7 Backfill — a *separate*, DB-only path

`backend/internal/backfill/engine.go` is deliberately **not** replay. It reads a
character's whole log **once** and fans out to selected `Handler`s (chat,
players, loot, skills, lockouts, factions — registered at `main.go:1098-1145`).
Contract: each handler is *"dedup-safe, timestamp-aware … re-running a backfill is
idempotent and never overwrites newer live data"* (`backfill/engine.go:7-9`), and
it never runs automatically. Progress is throttled to 150 ms
(`engine.go:71`) and broadcast over WS (`api/backfill.go:73-79`).
**No trigger/timer handler is registered** — backfill is for data, replay is for
triggers. That separation is correct and we should copy it.

---

## 3. What they do correctly that we fail on or lack entirely

Ordered by raider-visible damage. "Ours" refers to
`/home/user/QuarmBossTracker/packages/wolfpack-logsync/index.js` unless noted.

### 3.1 🔴 BUG (ours): replayed timers never render

**Theirs:** dispatch timestamp remapped to `time.Now()` (`replayer.go:274`).

**Ours:** `_replayEvaluateLine` calls `_fireTriggerActions(rt, captures, tsMs,
true)` with `tsMs` = the **historical** log timestamp (`index.js:30536`). That
flows into `_startTimer(t, tsMs, …)` (`index.js:29325`, called at `:30416`),
which sets `ends_at_ms = startMs + duration*1000`. For any log older than the
timer duration that is **already in the past**, and `_activeTimersSnapshot`
deletes it on the very next read (`index.js:29722-29723`).

**Raider consequence:** you replay last Sunday's Ssra pull to check your new tank
buster trigger. You hear the TTS. **The countdown bar never appears.** You
conclude the timer is broken and either delete the trigger or spend an evening
debugging a trigger that is actually fine. This is the single highest-value fix
in this document and it is ~3 lines.

### 3.2 🔴 One warning slot vs. an unbounded list

**Theirs:** `TimerAlerts []TimerAlert` — any number of thresholds, each
independently `play_sound` or `text_to_speech`, with its own volume and voice
(`trigger/models.go:122`).

**Ours:** exactly one, as two scalar columns: `warning_seconds` + `warning_text`
(`index.js:29371-29372`, rendered at `apps/mimic/triggers.html:620-622`,
fired at `:645-648`). Our own migration comment admits the squeeze — a Tank
Buster wants 10 s **and** 4 s, and we shipped only the 4 s line, documenting the
compromise in `supabase/migrations/20260607150000_guild_triggers_portable_shape.sql:13-18`.

**Raider consequence:** the cleric gets "D.A. now" with 4 s to react and no 10 s
"get ready". A 3-hour KEI can't have both a 5-minute *and* a 60-second heads-up.
Officers work around it by cloning triggers, which then double-fire the banner.

### 3.3 🔴 No dynamic duration; no per-pattern duration override

**Theirs:** `TimerDurationCapture` + `ParseDurationText` (`trigger/engine.go:984`,
`:944`) and `ExtraPattern.TimerDurationSecs` (`models.go:149`).

**Ours:** `timer_duration_sec` is a fixed integer, full stop (`index.js:29365`),
and we have no extra-patterns concept at all — one `pattern` per trigger row
(`supabase/migrations/20260530000000_guild_triggers.sql`).

**Raider consequence:** every spell in a family needs its own trigger row (Mez /
Mesmerize / Dazzle = 3 rows, 3 places to fix a typo, 3 chances to double-fire),
and any mechanic that *announces its own duration* in the log line can't be
timed at all.

### 3.4 🔴 No "reuse cooldown" timer — cooldown means the wrong thing

**Theirs:** two distinct fields — silent `RefireCooldownSecs` and a **visible
second countdown** `CooldownSecs` rendered as `"<Name> CD"` with an automatic
"ready" TTS (`trigger/engine.go:899`).

**Ours:** one field, `cooldown_seconds`, which is the silent lockout
(`index.js:29316-29320`). There is no way to say "Feign Death is on a 9 s
recast, show me the bar".

**Raider consequence:** melee/knight recast tracking (Feign Death, Lay on Hands,
disciplines) simply isn't expressible. Users get a callout when they *use* the
ability and nothing telling them when it's back.

### 3.5 🟠 No per-trigger colour, pin, or display threshold

**Theirs:** `BarColor`, `Pinned`, `DisplayThresholdSecs` (`models.go:279-292`,
`:352`), with pinned-first sorting (`spelltimer/engine.go:2020`).

**Ours:** bar colour is read off `actions[0].color` as a side effect
(`index.js:29369`), everything sorts strictly soonest-first
(`index.js:29742`), and every timer is visible from t=0.

**Raider consequence:** on a busy pull the 3-minute boss-cadence bar you care
about sits at the *bottom* of the stack under six 20-second rows, and there's no
way to keep it up top or colour-code raid-critical vs. personal.

### 3.6 🟠 No named timer windows

**Theirs:** `TimerGroup` (`timergroup.go:16`) — user-created extra Custom Timers
windows, referenced by ID, delete-safe.

**Ours:** one `#timers` stack in `apps/mimic/triggers.html:203`.

**Raider consequence:** a raid leader can't put boss-mechanic timers in their own
window separate from personal buff countdowns; everything competes for one
vertical strip that already shares the window with alert text and loot chips.

### 3.7 🟠 No "keep expired" overdue mode

**Theirs:** negative `remaining_seconds` + `expired: true`, lingering up to an
hour as a red count-up (`spelltimer/engine.go:1886`, `:2002-2011`).

**Ours:** `_activeTimersSnapshot` **hard-deletes** on `ends_at_ms <= now`
(`index.js:29723`).

**Raider consequence:** you look away for 4 seconds during a burn, the "Clarity
gone" bar has already vanished, and you don't rebuff.

### 3.8 🟠 No exclude patterns

**Theirs:** `ExcludePatterns[]` (`trigger/models.go:312`), plus a shipped
14-entry example for "Incoming Tell" and two later hotfix migrations adding more
(`packs.go:2775-2805`, `:2895-2905`).

**Ours:** nothing. A broad pattern is either broad or hand-negated with lookahead
gymnastics.

**Raider consequence:** the classic "my tell alert fires on every merchant
'That'll be 4 gold'" complaint has no clean fix.

### 3.9 🟠 No cross-pack dedup / no pack concept at all

**Theirs:** `DedupKey` + `SourcePack` + promote-on-uninstall (`packs.go:3053`,
`:3118`, `:3145`).

**Ours:** `guild_triggers` is one flat library with `tags[]` and `source_pack`
columns (`supabase/migrations/20260530010000_guild_triggers_library_extension.sql:22-33`)
but **no install/uninstall unit and no dedup**. Everything enabled is fetched by
every agent (`index.js` bot side: `_handleAgentGuildTriggers`, `index.js:8012`).

**Raider consequence:** we can't ship curated bundles ("Enchanter", "Raid Alerts")
that a raider opts into; the officer either enables a trigger for everyone or
nobody, and any overlap between two officers' additions double-fires.

### 3.10 🟠 No pack-update diff — we cannot safely change a shipped trigger

**Theirs:** §2.2 baseline three-way diff, per-field, with preserve/reset and
per-trigger selection.

**Ours:** the guild library is centrally edited on `/admin/triggers` and pushed to
every agent within 10 minutes. There is **no local customization concept at all**,
so there's nothing to preserve — but also no way for a raider to tweak a guild
trigger's threshold without cloning it to personal (the dashboard's "⎘ Copy to
personal", `index.js:13643-13656`), after which they silently stop receiving
officer fixes to that trigger.

**Raider consequence:** the raider who adjusted one number is now running a
permanently-stale fork of the guild's tank-buster trigger and doesn't know it.

### 3.11 🟡 Replay pollutes their DB; ours doesn't — *we're ahead here*

Worth recording as a **place where our design is better**, because it constrains
what we should copy.

Their replay drives `chatConsumer`, `lootConsumer`, `playersConsumer`,
`skillsConsumer`, `factionEngine`, `popflagConsumer` (`main.go:1421-1446`) —
with timestamps remapped to *now* (§2.6). Replaying an old raid therefore writes
chat/loot/skill rows stamped today. Their only guard is that backfill handlers
are dedup-safe, which the remap defeats.

Ours is a **strict rehearsal**: `_replayEvaluateLine` marks every fire `test=true`
+ `_rehearsal` + `_replay`, uses an **ephemeral cooldown map** so the real
`_triggerLastFire` is untouched, and journals each fire with a `replay` marker and
a ⏪ overlay tag (`index.js:30501-30572`). Nothing reaches `_fireLog`, the relay,
Discord, the upload queue, or the timeline. We also **refuse to replay during a
live fight** (`_liveFightActive`, `index.js:30470`) so a rehearsal callout can
never be mistaken for a real one, and we restrict the path to logs the agent
already watches (`index.js:30618-30623`). **Keep all of this.** Only adopt their
clock remap (§3.1) and their UX (§3.12).

### 3.12 🟡 Replay UX gaps (ours)

Theirs has, and ours does not: a file picker with character/size/mtime sorting;
first/last timestamp probe pre-filling the range (we make the user type both);
a progress bar with position-in-window; **pause/resume** (we only have start/stop,
`index.js:30645`); **"play from this point"** off a browsed line; and persisted
form selections. Ours has `pace: 'real' | 'fast'` (`index.js:30630`) where theirs
has a real speed multiplier with a 3 s gap cap vs. our 6 s (`index.js:30464`).

**Raider consequence:** a trigger author iterating on one 90-second pull retypes
two datetime fields on every attempt.

### 3.13 🟡 No trigger-side backfill registry

**Theirs:** a registered-section backfill engine with an idempotency contract
(`backfill/engine.go:7-9`) and a progress UI.

**Ours:** `--since <ISO>` is a whole-agent CLI mode, and the bot has a
`backfill-requests` workflow (`index.js:30651` client side) — but there's no
per-section selector and no in-dashboard progress. Different shape, similar gap;
lower priority than everything above.

### 3.14 🟡 Test infrastructure comparison

Ours: golden-log CI (`test/golden-log.test.js`, fixtures at
`test/fixtures/golden/{line-families,raid-pull}.log`, accepted via
`scripts/update-golden.js`) replays synthetic logs through the **real** shipped
parser and diffs a committed expectation. That's a genuinely strong
characterization net and theirs has no equivalent — but it covers the **combat
parser**, not the **trigger/timer path**. Their `engine_test.go` (1569 lines) and
`packupdate_test.go` (476 lines) do cover trigger semantics directly. Our gap:
**no golden coverage of trigger fires or timer lifecycles at all.**

---

## 4. Adaptation plan for our stack

Landing zones: **A** = agent (`packages/wolfpack-logsync/index.js`), **M** =
Mimic overlay (`apps/mimic/triggers.html`), **W** = web admin
(`web/app/admin/triggers/page.tsx`), **S** = Supabase migration on
`guild_triggers`, **B** = bot (`index.js`).

> ⚠️ **Portable-shape compatibility.** Our CLAUDE.md rule is: default to
> `text_overlay` + `tts` + trigger-level `timer_duration_sec` +
> `warning_seconds`/`warning_text`, because that shape fires on **every** Mimic
> version. Items marked **[SHAPE]** below add fields to `guild_triggers`. New
> *additive* fields are safe — an old agent ignores unknown keys — but a trigger
> that *depends* on a new field silently degrades on old Mimic. Every [SHAPE]
> item must therefore ship with: (a) a graceful fallback in the agent, and (b) a
> guild-lead decision on the minimum Mimic version officers may author against.
> **Rank 1 and 2 are the only ones that change nothing.**

### Rank 1 — Fix the replay clock (no shape change, ~30 min)

The §3.1 bug. Timers must be armed off *wall clock* during replay while pacing
and journalling continue to use log time.

**Where:** `packages/wolfpack-logsync/index.js` — `_startTimer` (`:29325`) and
its call site in `_fireTriggerActions` (`:30416`).

```js
// index.js — _startTimer(): arm the countdown on the wall clock when the fire
// is a replay/rehearsal. tsMs stays authoritative for pacing + the journal, but
// a historical tsMs would put ends_at_ms in the past and _activeTimersSnapshot
// would drop the row before the overlay ever painted it (the "replay has no
// bars" report). Live fires are unaffected: tsMs is already ~now.
const startMs = (t._replay || isTest) ? Date.now() : (tsMs || Date.now());
```

Do the same for the voice-`marks` stale drop, which currently discards every
mark during replay because `Date.now() - fireMs > 60_000` is true for any log
older than a minute (`index.js:30372`):

```js
// index.js — _fireTriggerActions(), voice/marks branch: replay rebases mark
// offsets onto now so a rehearsal actually plays the 30→10→5→0 sequence
// instead of dropping all four as "stale".
const baseMs = t._replay ? Date.now() : (tsMs || Date.now());
const fireMs = baseMs + Math.max(0, offsetMs || 0);
if (!t._replay && Date.now() - fireMs > 60_000) return;   // stale, drop
```

Add a golden-style regression: a fixture log + an assertion that replaying it
leaves ≥1 row in `_activeTimersSnapshot()`. Lands in `test/` alongside
`golden-log.test.js`; both `startReplay` and `_activeTimersSnapshot` are already
exported (`index.js:32024`, `:32027`).

### Rank 2 — Replay UX: range probe, pause/resume, "play from here" (no shape change, ~half day)

**Where:** A (`/api/replay/*` handlers at `index.js:20764-20782`, dashboard JS at
`:18268-18300`), M none.

1. **`GET /api/replay/info?logPath=…`** returning first/last timestamps, probed
   from head/tail chunks so a 400 MB log isn't read (their `probeLogRange`,
   `api/replay.go:119`, is the shape). Pre-fill both datetime inputs on file
   select. This alone removes most of the iteration friction.
2. **Pause/resume.** `_replayWorker` (`index.js:30548`) already polls `st.stop`
   between lines; add `st.paused` and a `while (st.paused && !st.stop) await
   _sleep(100)` at the top of the loop, plus `/api/replay/pause|resume`.
3. **Progress %** in `_replayStateForWeb` (`index.js:30478`) — we already track
   `played`/`total`; render a bar in the dashboard Triggers tab.

⚠️ Dashboard-escape hazard: any edit to the `WEB_HTML` template literal must be
followed by `npm run check:dashboard`, and any `<details>` emitted must use
`wpKeep(...)` (CLAUDE.md, agent dashboard rules).

### Rank 3 — Multiple warning thresholds **[SHAPE]** (~1 day)

Replace the single `warning_seconds`/`warning_text` pair with a list, keeping the
scalars as a read-compat fallback forever.

**S — migration** (additive, idempotent):

```sql
-- guild_triggers: a trigger may want several pre-end callouts (a tank buster
-- wants 10s AND 4s; a 3h KEI wants 5m AND 60s). The legacy scalar pair stays
-- as the portable fallback older Mimic versions read; new agents prefer
-- timer_warnings when present.
ALTER TABLE public.guild_triggers
  ADD COLUMN IF NOT EXISTS timer_warnings jsonb NOT NULL DEFAULT '[]'::jsonb;
-- shape: [{ "seconds": 10, "text": "tank buster in ten", "tts": true }, ...]

-- Backfill the list from the scalars so both readers agree from day one.
UPDATE public.guild_triggers
   SET timer_warnings = jsonb_build_array(
         jsonb_build_object('seconds', warning_seconds,
                            'text',    warning_text,
                            'tts',     true))
 WHERE timer_warnings = '[]'::jsonb
   AND warning_seconds > 0
   AND warning_text IS NOT NULL;
```

**A — `_startTimer` (`index.js:29325`)**: emit a normalised list, derived from
whichever source exists, so the snapshot shape is uniform:

```js
// index.js — _startTimer(): normalise warnings into one ordered list. Officers
// on new Mimic author `timer_warnings`; anything authored the old way (or by an
// older /admin/triggers build) still works via the scalar pair. Sorted
// descending so the overlay's latch walk is monotonic.
function _timerWarnings(t) {
  const list = Array.isArray(t.timer_warnings) ? t.timer_warnings : [];
  const out = list
    .filter((w) => w && w.seconds > 0 && w.text)
    .map((w) => ({ at_ms: Math.round(w.seconds * 1000),
                   text: String(w.text).slice(0, 200),
                   tts: w.tts !== false }));
  if (out.length === 0 && t.warning_seconds > 0 && t.warning_text) {
    out.push({ at_ms: t.warning_seconds * 1000,
               text: String(t.warning_text).slice(0, 200), tts: true });
  }
  return out.sort((a, b) => b.at_ms - a.at_ms);
}
```

Store `warnings: _timerWarnings(t)` on the timer row and surface it from
`_activeTimersSnapshot` (`index.js:29719`) **alongside** the existing
`warning_ms`/`warn_text` (so an older `triggers.html` bundled in an older Mimic
keeps working — this is the fallback that makes the shape change safe).

**M — `apps/mimic/triggers.html`**, replacing the single latch at `:643-648`:

```js
// triggers.html — paintTimers(): one latch per threshold instead of one per
// row. Latches reset when the countdown climbs back above a threshold, so a
// restarted timer warns again — same re-arm rule as the single-warning latch
// it replaces. Falls back to the legacy scalar when `warnings` is absent, so a
// new overlay against an old agent still fires the one warning it knows.
const warnList = n.warnings && n.warnings.length
  ? n.warnings
  : (n.warn_ms > 0 && n.warn_text ? [{ at_ms: n.warn_ms, text: n.warn_text, tts: true }] : []);
if (!n.fired) n.fired = new Set();
for (const w of warnList) {
  if (remMs > w.at_ms) { n.fired.delete(w.at_ms); continue; }
  if (n.fired.has(w.at_ms)) continue;
  n.fired.add(w.at_ms);
  fire({ text: w.text, tts: w.tts ? w.text : null });
}
```

**W** — repeatable threshold rows in `/admin/triggers`.

### Rank 4 — Reuse-cooldown timer (`cooldown_timer_sec`) **[SHAPE]** (~half day)

Add a *second* countdown, disambiguating our overloaded `cooldown_seconds`.

**S:** `ADD COLUMN IF NOT EXISTS cooldown_timer_sec integer NOT NULL DEFAULT 0;`
(name it distinctly from `cooldown_seconds` — reusing the name would silently
turn every existing anti-spam lockout into a visible bar).

**A — in `_fireTriggerActions` right after the existing timer start
(`index.js:30416`):**

```js
// index.js — reuse-cooldown countdown. Separate row from the duration timer,
// keyed with a " CD" suffix so a discipline can show "Furious Discipline"
// (duration) and "Furious Discipline CD" (recast) side by side. Works on
// alert-only triggers too — Feign Death has no duration but a 9s recast.
if (t.cooldown_timer_sec > 0) {
  _startTimer({
    ...t,
    id:   String(t.id || t.name) + '::cd',
    name: (t.name || 'ability') + ' CD',
    timer_duration_sec: t.cooldown_timer_sec,
    timer_warnings: [{ seconds: 1, text: (t.name || 'ability') + ' ready', tts: true }],
  }, tsMs, test, null);   // null captures: a recast bar is never per-target
}
```

Note this composes with Rank 3 for free — the "ready" callout is just a warning
at 1 s.

### Rank 5 — Exclude patterns **[SHAPE]** (~2 h)

**S:** `ADD COLUMN IF NOT EXISTS exclude_patterns text[] DEFAULT '{}'::text[];`

**A — compile in `_compilePersonalTrigger` (`index.js:26656`) beside the existing
`_endRegex`, and gate in `evaluateTriggersAgainstLine` (`index.js:30061`) right
after the primary match, before the charm-pet filter:**

```js
// index.js — _compilePersonalTrigger(): precompile the exclude list once. A bad
// exclude must never take the trigger down with it — we drop the offending
// entry and keep the rest, same fail-open policy as _compileEndEarlyRegex.
function _compileExcludes(t) {
  const src = Array.isArray(t.exclude_patterns) ? t.exclude_patterns : [];
  const out = [];
  for (const p of src) {
    if (!p || !String(p).trim()) continue;
    try { out.push(new RegExp(_translateDotNetRegex(String(p)), t.pattern_flags || 'i')); }
    catch (err) { console.warn('[triggers] bad exclude on "' + (t.name || '?') + '":', err.message); }
  }
  return out;
}

// index.js — evaluateTriggersAgainstLine(), immediately after `if (!m) continue;`
if (t._excludes && t._excludes.some((rx) => rx.test(line))) continue;
```

Same two lines in `_replayEvaluateLine` (`index.js:30501`) so rehearsal matches
live. Then seed the obvious ones (merchant/pet lines on any tell-ish trigger).

### Rank 6 — Per-trigger colour, pin, display threshold **[SHAPE]** (~half day)

**S:** `bar_color text`, `pinned boolean NOT NULL DEFAULT false`,
`display_threshold_sec integer NOT NULL DEFAULT 0`.

**A:** carry all three onto the timer row in `_startTimer` (`index.js:29357`),
emit from `_activeTimersSnapshot` (`:29719`), and change the sort there from
pure ascending-remaining to pinned-group-first:

```js
// index.js — _activeTimersSnapshot(): pinned rows float as a group above
// unpinned, then ascending remaining within each group, so a 3-minute boss
// cadence bar stays at the top instead of sinking under six 20s rows.
out.sort((a, b) =>
  (b.pinned === true) - (a.pinned === true) || a.remaining_ms - b.remaining_ms);
```

Apply `display_threshold_sec` as a **filter in the snapshot** (skip while
`remaining_ms > threshold*1000`) — keeping it agent-side means an older overlay
gets the behaviour without a Mimic update. **M:** honour `t.bar_color` over the
current `actions[0].color` derivation and add a pin glyph on
`.timer-row` (`apps/mimic/triggers.html:561-604`).

### Rank 7 — Keep-expired overdue rows **[SHAPE], opt-in** (~half day)

**A — `_activeTimersSnapshot` (`index.js:29719`), replacing the hard delete:**

```js
// index.js — _activeTimersSnapshot(): with keep_expired on, an elapsed timer
// lingers as an overdue count-up ("+42s") instead of vanishing, so a rebuff
// cue you looked away from is still on screen. Hard-dropped once it has been
// overdue longer than KEEP_EXPIRED_MAX_MS so stale rows can't pile up.
const KEEP_EXPIRED_MAX_MS = 10 * 60 * 1000;
const overdue = now - t.ends_at_ms;
if (overdue > 0 && (!t.keep_expired || overdue > KEEP_EXPIRED_MAX_MS)) {
  _activeTimers.delete(id); continue;
}
// …then emit: remaining_ms: t.ends_at_ms - now  (negative when overdue)
//             expired: overdue > 0
```

**M:** `triggers.html:630` currently removes any node with `remMs <= 0`
(`:633`). Guard that on `!n.expired`, render `'+' + fmtRemain(-remMs)`, and reuse
the existing `.warn` styling. **Ship this defaulted OFF** — negative
`remaining_ms` reaching an *older* `triggers.html` removes the row immediately,
which is a harmless degradation but should still be a deliberate opt-in.

### Rank 8 — Trigger *packs* over the existing library **[SHAPE], design work]** (~2–3 days)

We already have `tags[]` + `source_pack` on `guild_triggers`. The missing pieces
are (a) an install unit, (b) cross-pack dedup, (c) a per-raider opt-in surface.

Proposed minimum, deliberately smaller than theirs:

1. **`pack_name` + `dedup_key` columns** on `guild_triggers`. `pack_name` is
   what an officer curates; `dedup_key` is the conceptual identity.
2. **Agent-side dedup at load, not at install.** We have no per-user install
   step, so the equivalent is a filter when merging guild + personal:

```js
// index.js — merge point for [..._personalTriggers, ...stats.guildTriggers].
// Two packs shipping the same concept (a "charm broke" alert in both the
// Enchanter and Spell Breaks packs) must produce ONE callout, not two. First
// writer wins; personal triggers are walked first so a raider's own version of
// a concept always beats the guild copy.
function _dedupTriggers(list) {
  const seen = new Set(), out = [];
  for (const t of list) {
    const k = t && t.dedup_key;
    if (k) { if (seen.has(k)) continue; seen.add(k); }
    out.push(t);
  }
  return out;
}
```

   This sidesteps the *exact* failure the postmortem documents (§2.4 item 2):
   because dedup is evaluated **at every load** rather than baked in at install,
   there is no cohort of pre-existing rows missing the key.
3. **Per-raider opt-in** — a `selected_packs` list in the agent's local state
   (the library-extension migration already anticipated
   `selected_triggers.json`), with a Packs section in the dashboard Triggers tab.
4. **Officer surface** — group `/admin/triggers` by `pack_name`, with
   enable-pack / disable-pack.

**Skip** their compiled-in-Go pack definitions entirely: our packs are already
rows in a database that officers edit live, which is strictly better for a guild.

### Rank 9 — Pack update diff (their §2.2) — **adapt, don't port** (~2 days, defer)

Their baseline three-way diff exists because packs are *compiled into a binary*
and users edit installed copies. Our guild library is server-side and centrally
edited, so 90 % of that machinery is solving a problem we don't have.

The 10 % we *do* need is the §3.10 consequence: once a raider hits
"⎘ Copy to personal" (`index.js:13643`) they fork silently and stop getting
officer fixes. Minimal fix, no new engine:

- Stamp the copy with `forked_from_id` + `forked_at` + a snapshot hash of the
  guild row's `pattern`/`actions`/timer fields.
- On each 10-minute guild-trigger poll, compare the current guild row's hash to
  the stored one and flag the personal copy in the dashboard: *"the guild version
  of this trigger changed — [see diff] [re-copy]"*.

That's a badge + a diff view, not a merge engine, and it captures nearly all the
value.

### Rank 10 — Trigger-path golden tests (~half day, no shape change)

We have a strong golden net for the combat parser and **zero** for triggers. Add
a third fixture (`test/fixtures/golden/trigger-fires.log`) plus a
`test/trigger-timers.test.js` that drives `_replayEvaluateLine` /
`evaluateTriggersAgainstLine` over it and asserts a committed expectation of
`{trigger, captures, timer_started, warnings_fired}`. Everything needed is
already exported (`index.js:32024-32027`), and `scripts/update-golden.js` is the
accept-a-change pattern to follow. This is what makes Ranks 3–7 safe to land.

---

## 5. Risks, effort, and what to skip

### Effort summary

| # | Item | Effort | Shape change | Blast radius |
|---|---|---|---|---|
| 1 | Replay clock fix | ~30 min | none | agent only |
| 2 | Replay UX (probe/pause/progress) | ~0.5 d | none | agent + dashboard HTML |
| 3 | Multiple warning thresholds | ~1 d | **yes** | S + A + M + W |
| 4 | Reuse-cooldown timer | ~0.5 d | **yes** | S + A + W |
| 5 | Exclude patterns | ~2 h | **yes** | S + A + W |
| 6 | Colour / pin / display threshold | ~0.5 d | **yes** | S + A + M + W |
| 7 | Keep-expired overdue | ~0.5 d | **yes** (opt-in) | A + M |
| 8 | Packs + dedup | ~2–3 d | **yes** | S + A + W + B |
| 9 | Fork-drift badge (not a merge engine) | ~2 d | **yes** | S + A + W |
| 10 | Trigger golden tests | ~0.5 d | none | test/ |

### Risks

- **Portable-shape erosion (highest).** Every [SHAPE] item widens the gap between
  "what an officer can author" and "what the oldest deployed Mimic understands".
  Mitigation is uniform across Ranks 3–7: **the new field is always additive, the
  agent always emits the legacy field alongside it, and the overlay always falls
  back.** The genuine decision for the guild lead is: *what Mimic version do we
  declare as the authoring floor?* Until that's answered, treat every [SHAPE]
  item as "authorable but must degrade to something useful".
- **Dashboard escape hazard (Rank 2, 6, 7).** `WEB_HTML` is one template literal
  with two escape layers; we've shipped that bug twice. `npm run check:dashboard`
  after **every** touch, `wpKeep(...)` on every emitted `<details>`, and remember
  section HTML must be byte-stable across polls or the section rewrites every 2 s.
- **Timer-key semantics (Rank 4, 6).** Our timer id is
  `baseId + sorted-capture-suffix` (`index.js:29354`). The `::cd` suffix in Rank 4
  must not collide with a capture suffix; the `_cancelTimersOnMobDeath` sweep
  (`index.js:29430`) matches on `row.target`, so a CD row (which passes `null`
  captures and therefore inherits the current boss as `timerTarget`,
  `index.js:29350-29352`) would be wrongly cancelled on that boss's death.
  **Explicitly set `target: null` on cooldown rows.**
- **Sort-order change is user-visible (Rank 6).** Pinned-first reorders every
  raider's stack the moment the first pinned trigger ships. Announce it.
- **Pack dedup can silently mute a callout (Rank 8).** Two triggers sharing a
  `dedup_key` means one never fires. Surface the suppressed row in the dashboard
  ("suppressed — same concept as X") rather than dropping it invisibly; the
  postmortem's failure mode was the mirror image (double-firing) and both come
  from dedup being hard to see.
- **Replay + timers interaction (Rank 1).** Once replayed timers actually render,
  a long replay can leave a stack of rehearsal bars up after the run. Add a
  "clear test timers" sweep on replay completion — the mechanism already exists
  (`testOnly` clear at `index.js:20745`).

### Skip list — deliberately not adapting

- **Their compiled-in-Go pack definitions and the whole `pack_baselines` /
  `ComputePackDiff` / `ApplyPackUpdate` engine.** ~1500 lines solving
  "the binary ships content that users then edit". Our content lives in
  Supabase and is edited by officers in one place. Rank 9 captures the residual
  value at ~5 % of the cost.
- **Their `discord_webhook` action.** We already have a first-class bot relay
  (`/api/agent/trigger` → `TRIGGER_BROADCAST_CHANNEL_ID`, `index.js:7507`,
  `:30330`) with cross-agent dedup by key. A per-user webhook would be a second,
  worse path with a credential-storage problem theirs had to design around.
- **Their `pipe_command` (`/pipe <text>`) trigger source.** Cute, but it needs a
  Zeal feature we'd have to negotiate, and our Zeal surface is already documented
  as narrow (target/pet gauges only, no spawn id — CLAUDE.md scope boundary).
  Our `zeal_condition` gauge triggers (`index.js:29302`) already cover the
  useful HP-threshold cases.
- **Their per-action font/glow/align overlay styling.** Real polish, but our
  overlay is a single centred alert plus a timer stack; per-action typography is
  a large surface for a small win. Revisit only if UI Studio grows an alert
  editor.
- **Their orphan-sweep-every-target-less-detrimental-on-any-kill rule**
  (`spelltimer/engine.go:1569`). Their own comment documents it wiping unrelated
  boss timers. Our `_cancelTimersOnMobDeath` (`index.js:29430`) already does the
  narrow, correct thing: exact case-insensitive name match, fail-open when the
  target is unknown. **Do not copy the sweep.**
- **Their coarse replay isolation** (pause tailer, clear everything at the end).
  Ours is strictly better — `test=true` end to end, ephemeral cooldown map,
  live-fight refusal, ⏪ journal marker. Keep ours; take only the clock remap.
- **`RepeatingTimer` / `Stopwatch` GINA timer types.** They map `RepeatingTimer`
  to a plain one-shot and drop `Stopwatch` (`gina.go:128`). Neither has a raid
  use case we've been asked for; a repeating boss cadence is better served by the
  cadence re-arm we already have (`index.js:29495` `_armBossCountdown`, used by the AoE-dance re-arm at `:29710`).
