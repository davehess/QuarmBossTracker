# Findings — trigger overlay, raid night 2026-08-10 (Ssra)

Reported live, mid-raid, by Hitya. Everything here was diagnosed during the
raid window; only the DB-only mitigations were applied. **Everything under
"Queued" needs an agent and/or Mimic release and was deliberately NOT done
during the freeze.**

---

## P1 — every timer trigger creates a NEW row on every fire

**Symptom (Hitya, live):** the trigger overlay fills with rows like

```
09:11  [Sun Aug 09 19:59:29 2026] A Shissar Lich has been ensnared.  - Ensnared
02:52  [Sun Aug 09 21:03:24 2026] A temple skirmisher yawns.         - Shaman Slow landed
02:54  [Sun Aug 09 21:04:24 2026] A Shissar Templar yawns.           - Shaman Slow landed
02:54  [Sun Aug 09 21:04:26 2026] A Shissar Templar yawns.           - Shaman Slow landed
02:54  [Sun Aug 09 21:04:28 2026] A Shissar Templar yawns.           - Shaman Slow landed
```

— "this is annoying and no way to clear it", "unusable with the rows squished",
"don't include the whole timestamp in this line". Three separate bugs, ONE root
cause.

### Root cause

`_buildCaptureBag` (`packages/wolfpack-logsync/index.js:26448`) puts three
things in the capture bag that are not semantic captures:

```js
for (let i = 0; i < m.length; i++) if (m[i] != null) bag[String(i)] = m[i];  // '0' = the WHOLE match
...
bag.L = bag.l = line;                                                        // the RAW line, always
if (ctx.character) { bag.c = bag.char = bag.self = ctx.character; }
```

`_startTimer` (`packages/wolfpack-logsync/index.js:30061`) then consumes the
bag indiscriminately:

```js
const keys = Object.keys(captures).sort();
captureSuffix = '|' + keys.map(k => k + '=' + String(captures[k])).join('|');
timerTarget = captures.target || captures.npc || captures.mob || captures[keys[0]] || null;
...
const id = baseId + captureSuffix;
```

Three consequences, all observed:

1. **Duplicate rows.** `captureSuffix` contains `L=<raw log line>`, and the raw
   line carries the EQ timestamp. Two slows on the same mob two seconds apart
   produce two different ids, so the overlay gets two rows instead of one row
   whose countdown resets. Every timer trigger duplicates on every fire.
2. **`timer_key_capture` is dead code.** It only shapes `baseId`;
   `captureSuffix` is appended unconditionally afterwards, so the varying `L`
   defeats the key. The seven slow triggers already carried
   `timer_key_capture='s'` and still duplicated — that is the proof.
   *(This also corrects the mitigation I applied earlier tonight for the six
   stacked Death Touch chips on the pet "Xarn": removing the `<boss>` capture
   from that trigger does not fix it, because `L` still varies. The chips
   deduping is not something that patch could have delivered.)*
3. **The row label is the whole log line.** `Object.keys(bag).sort()` puts
   `'0'` first (ASCII digits sort before letters), and `'0'` is `m[0]` — the
   entire match, which for an `^…$` pattern is the entire line, timestamp
   included. So `timerTarget` falls back to the line rather than the mob name.
4. **The chips never auto-clear.** `_cancelTimersOnMobDeath` matches a timer's
   `target` against the dead mob's name. `target` here is a full log line, so it
   can never match — which is exactly "no way to clear it". Killing the mob
   should have cleared these and couldn't.

### Fix (agent — needs a release)

In `_startTimer`, filter the bag before using it for identity or display:

```js
const NON_SEMANTIC = new Set(['L', 'l', 'c', 'char', 'self']);
const keys = Object.keys(captures)
  .filter(k => !NON_SEMANTIC.has(k) && !/^\d+$/.test(k))
  .sort();
```

and honour the key explicitly — when `timer_key_capture` is set, the keyed
capture IS the identity, so skip `captureSuffix` entirely:

```js
const id = t.timer_key_capture ? baseId : baseId + captureSuffix;
```

Both changes are local to `_startTimer`; `_buildCaptureBag` keeps `L`/`l`/`c`
because action text (`{L}`, `{c}`) legitimately uses them. Do **not** strip
them at the bag — that would break action interpolation.

Test to add: two fires of the same trigger on the same mob, one second apart →
exactly one entry in `_activeTimers`, `target` equal to the mob name (not the
line), and `_cancelTimersOnMobDeath(<mob>)` clears it.

### Applied mid-raid (DB only, no deploy)

Timers turned OFF on the eight trash-frequency triggers that were filling the
overlay. The callout (text overlay + TTS) is untouched — only the countdown row
is gone. Restore `timer_duration_sec` once the agent fix ships:

| Trigger | id | was |
|---|---|---|
| Ensnared | `384594e5-2170-49a3-ae2a-440df824f764` | 780 |
| Bard Slow landed | `2ff69aa3-3b36-4bc1-a634-178d832bc12c` | 180 |
| Druid Slow landed | `be362ce9-1515-4c5f-a472-3239dc139101` | 180 |
| Enchanter Slow landed | `85d5ed12-4f0f-43e3-989c-1320a20a4bff` | 180 |
| Magician Slow landed | `fadc1705-0aae-47ce-b548-3bcab000af23` | 180 |
| Shaman Plague Slow landed | `8944158d-8d54-4132-9ae4-a6500d640faa` | 180 |
| Shaman Slow landed | `facb6fea-b21f-4dfd-b585-d36a65e06d58` | 180 |
| Sha's Advantage | `06b4935c-d58f-45a8-ac5f-0aa3e49997d9` | 180 |

Ensnared at 780s was the worst offender: thirteen minutes of accumulation
against one row per snared mob per cast.

Left ON deliberately — low fire rate, one stray duplicate row is survivable
until the fix: Death touch (120s), Emperor Ssra Tank Buster (60s), Dragon Roar
(36s), Carnage / Copied Carnage (360s), Explorer Slain (350s), Feeblemind (30s),
Waves of the Deep Sea (180s), and the class-specific self-buff bars (Great Wolf,
Fierce Eye, Auspice, Chromatic Haze, Casting Spell).

---

## Queued — needs a release

### 1. No way to clear a timer chip by hand

`apps/mimic/triggers.html` only renders a per-chip ✕ when the server marks the
row `dismissible` — that flag exists for #107 loot-auction chips and nothing
else. There is no clear-all. Today the only escape is hiding the whole trigger
overlay.

Proposed: a clear-all control on the trigger overlay title bar (needs the
hover-interact handshake per the overlay feature-parity checklist — the overlay
is click-through when locked), plus `dismissible` on ordinary timer chips so a
single stuck row can be dropped without losing the rest. Client-side dismissal
already exists (`dismissTimer` / `_dismissedIds`, 4s re-add suppression); this
is mostly about surfacing it.

### 2. Same-name mobs need the tag / spawn id on the row

Hitya: *"if the mob has the same name we should include the tag/spawnid"*.

Scope check before anyone designs this (`CLAUDE.md` → Scope boundaries): the
**Zeal pipe carries no spawn id** — the target/pet gauges are name + HP only, so
the pipe cannot disambiguate two mobs with the same name. The **`/tag` channel
does** carry a spawn id, at every N we have tested (4 skeletons, 5 bears, ~17
elder thought horrors), but it is **operator-driven** — a human must target and
tag each mob, against a ~8/min server chat rate limit.

So the realistic shape is: when a tag is known for the mob, show it on the chip
(`A Shissar Templar #3 — Shaman Slow`); when it is not, show the bare name and
accept one row per name. Do not design this assuming full spawn-id coverage.

Note this only becomes visible AFTER the P1 above is fixed — right now the rows
are unique for the wrong reason (the timestamp), which is why identical mobs
appear as separate rows at all.

### 3. CH chain — a filler word can land in a chain slot

Hitya: *"Not sure how 'Is' ended up as 006"* (slot 006 showing a caster named
"is", 72% mana).

The chain-roster parser (`packages/wolfpack-logsync/index.js:3790`) takes the
word immediately before each slot number:

```js
const RX = /([A-Za-z][A-Za-z'`]+)\s+0*(\d{1,3})(?=\s*[,;]|\s*$)/g;
```

so a roster shout of the form `… Xarn 005, backup is 006,` yields the pair
`("is", 6)`. `_resolveChRosterName` then tries to map the token onto the live
Zeal raid roster and, finding no unique match, **falls back to the token as
typed** — deliberately, because "Mana" on the row beats the wrong player on it.
"is" survives that fallback. From there the row is sticky: a real CH call on
slot 6 keeps the roster name (roster wins over the shout speaker, by design) and
just stamps mana + last-cast, which is why it showed 72% and a stale age.

Fix options, in preference order:
1. Reject tokens that are not a plausible character name — a small stopword set
   (`is, and, then, on, for, to, slot, next, chain`) plus a minimum length of 3.
2. Stronger: require the token to resolve against `_raidRosterMembers` when a
   raid roster is present, and only fall back to the raw token when the roster
   is empty (not in a raid window yet). That preserves the abbreviation case
   ("Mana" → "Manamana") and kills the filler-word case outright.

Option 2 is the better rule but changes behaviour when the Zeal roster is
missing; option 1 is safe on its own. Recommend shipping 1, then 2 behind the
same release.

The exact shout that caused it is not recoverable — chain calls go out on
`/shout`, and only `/gu` and `/rs` reach `chat_messages`.

### 4. Carried over from earlier tonight

- **`require_raid_member` is an action-level gate only** — it does not suppress
  the trigger's timer, so a non-raider still gets the countdown row.
- **Mute control on `/admin/triggers`** — Hitya asked for a quick edit link plus
  a mute; deferred past the freeze. Open choice: page-level TTS mute vs a
  per-row soft mute.
- **"MELEE OUT" on the cursed mobs** — no such trigger exists yet. Blocked on
  the real log line / mob name; the emote has not been captured.

---

## Where this lands

Agent fixes (§P1, §3) ship to `beta` per the beta-first rule; the overlay work
(§1, §2) is a Mimic change and rides the same beta line. The DB mitigations
above are live now and need reverting once the agent fix reaches the fleet —
**that revert is the thing most likely to be forgotten**, so it is listed as a
row-by-row table on purpose.
