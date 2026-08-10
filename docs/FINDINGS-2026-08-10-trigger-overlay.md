# Findings — trigger overlay, raid night 2026-08-10 (Ssra)

Reported live, mid-raid, by Hitya. Everything here was diagnosed during the
raid window; only the DB-only mitigations were applied. **Everything under
"Queued" needs an agent and/or Mimic release and was deliberately NOT done
during the freeze.**

---

## Status — post-raid, 2026-08-10 00:30 ET

| Item | State |
|---|---|
| §P1 timer identity | **FIXED** — agent 3.5.56 (`beta`) |
| §7(a) RIP dedup key | **FIXED** — same commit, one shared filter serves both |
| §7(b) relayed fires ignore `cooldown_seconds` | **FIXED** — agent 3.5.56 + bot 3.1.37 carry it across the relay |
| Clock skew on relayed fires (NEW — below) | **FIXED** — bot 3.1.37 (`main`) + agent 3.5.56 (`beta`) |
| The 8 muted trash triggers | **STILL MUTED — do not restore yet.** Gate below. |
| §7b "yawns." always reads as Turgur's, incl. item procs | **NOT FIXED — needs Hitya's call.** 940 rows affected; badge says 75% for a 35% proc |
| §1 clear-all · §2 tag on the chip · §3 CH filler word · §5 Kneel Test | queued |
| §6 "Too Far" relay spam | fixed live, DB only, no revert needed |

### ⚠ The restore is gated on the STABLE fleet, not on the fix existing

This document said "restore once the agent fix ships". Sharpening that, because
the fix shipped to **`beta` only**: the eight triggers live in `guild_triggers`,
which **every** agent reads — including stable installs without the 3.5.56 fix.
Running the restore SQL now puts the wall of rows straight back for everyone
still on stable. Wait for a stable graduation of the 3.5.x agent, or for
confirmation that the raid is entirely on beta.

The TTS half is independent and stays a taste call — Hitya turned it off live as
*"VERY chatty for callouts"*, so it stays off until they ask for it back.

### Clock skew on relayed fires — Hitya, post-raid: *"the clock skew was VERY apparent for the TTS timers"*

Distinct from §7, and broader. `_relayLocalFire` stamps `fired_at_ms` from the
ORIGINATOR's clock — the EQ log-line time on *their* machine — and this platform
has already measured installs 14s, 42s and 56s off, drifting ~1.5-3 s/day. Every
consumer compared that stamp against its own `Date.now()`, so one skewed sender
broke four things at once for everybody else:

1. the `RELAY_STALE_MS` (15s) gate dropped **every** fire from a machine more
   than 15s behind, journalled as `stale-skipped — Ns old`. **This re-reads §6**:
   the "~95s relay backlog" inferred there from `fire was 94s old at consumption`
   is at least partly a 56s-class clock, not queue depth;
2. `speakAt` delays by `fireMs - Date.now()`, so a sender running AHEAD pushed
   the TTS that many seconds late — and past 60s it was dropped silently;
3. `_startTimer` set `ends_at_ms = origin_stamp + duration`, so every receiver's
   countdown, and its N-seconds-before warning callout, was wrong by the full
   skew — **the reported symptom**: no two raiders' bars agreed;
4. `_localFireKeys` mixes local and origin stamps in one map, so echo-suppression
   of our own fire against another observer's relay of it misfired.

The bot's cross-agent dedup had the same defect — `Math.abs(e.fired_at_ms -
firedAt) <= 8s` compares stamps written by *different machines*, so two observers
of one event more than 8s apart on the clock both stored and both fanned out.
That is a second, independent reason RIP doubled, on top of §7(a)'s key.

Fixed by resolving to true time at ingest — the bot is the only party that sees
every clock — using the offset that already rides every payload (#202):
`fired_at_true_ms = fired_at_ms + clock_offset_ms`; the agent then subtracts its
own offset to land on its local clock. Fails open to the previous behaviour when
either offset is missing, on a backfill (current offset, old events), or on an
absurd >10min reading. Tests: `test/trigger-timer-identity.test.js` (§P1 + §7a),
`test/relay-clock-skew.test.js` (agent), `test/relay-true-time.test.js` (bot).

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

**The `tts` action was stripped from the same eight** (Hitya, live: *"it's VERY
chatty for callouts"*). The on-screen text overlay is untouched — `SHM SLOW`,
`ENSNARE - {s}` and friends still flash; they just no longer speak. A slow
landing on every trash mob in a Ssra pull is not eight things worth saying out
loud.

### ⚠ RESTORE THIS after the agent fix ships

Both changes above are temporary. One statement puts all of it back — run it
once the fixed agent has reached the fleet, then re-check one pull:

```sql
update guild_triggers set timer_duration_sec = 780,
  actions = '[{"text":"ENSNARE - {s}","type":"text_overlay","color":"red","duration_ms":5000},{"text":"Ensnare","type":"tts"}]'
  where id = '384594e5-2170-49a3-ae2a-440df824f764';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"BRD SLOW","type":"text_overlay","color":"green","duration_ms":5000},{"text":"Bard slow.","type":"tts"}]'
  where id = '2ff69aa3-3b36-4bc1-a634-178d832bc12c';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"DRU SLOW","type":"text_overlay","color":"green","duration_ms":5000},{"text":"Druid slow.","type":"tts"}]'
  where id = 'be362ce9-1515-4c5f-a472-3239dc139101';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"ENC SLOW","type":"text_overlay","color":"green","duration_ms":5000},{"text":"Enchanter slow.","type":"tts"}]'
  where id = '85d5ed12-4f0f-43e3-989c-1320a20a4bff';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"MAG SLOW","type":"text_overlay","color":"green","duration_ms":5000},{"text":"Magician slow.","type":"tts"}]'
  where id = 'fadc1705-0aae-47ce-b548-3bcab000af23';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"PLAGUE SLOW","type":"text_overlay","color":"green","duration_ms":5000},{"text":"Shaman plague.","type":"tts"}]'
  where id = '8944158d-8d54-4132-9ae4-a6500d640faa';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"SHM SLOW","type":"text_overlay","color":"green","duration_ms":5000},{"text":"Shaman slow.","type":"tts"}]'
  where id = 'facb6fea-b21f-4dfd-b585-d36a65e06d58';
update guild_triggers set timer_duration_sec = 180,
  actions = '[{"text":"BST SLOW","type":"text_overlay","color":"red","duration_ms":5000},{"text":"Beastlord slowed","type":"tts"}]'
  where id = '06b4935c-d58f-45a8-ac5f-0aa3e49997d9';
```

Restoring the TTS does not depend on the agent fix — that one is a taste call
and can go back whenever the guild wants it. The **timers** are the ones gated
on the fix; putting them back before it ships just re-creates the wall of rows.

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

### 4. Zeal tags don't disambiguate same-name mobs — two defects

Hitya, live: *"we're not getting disambiguation after I tagged 3 as inc and they
were retagged with tank names"*. The Extended Target overlay showed two
`a crypt guardian` rows, both 81%, with **eight** `SLOWED` chips sitting in the
`tags:` pool — the "tags on this name we could not weld to a row" bucket.

The pool is doing exactly what it was built to do; the problem is upstream of
it, in two places.

**(a) An append silently discards the previous tag text** —
`packages/wolfpack-logsync/index.js:26590`. The stored entry is one record per
spawn id, and `+`/`@` are treated as replace:

> *"append variants replace our stored text (the nameplate-merge subtleties
> don't matter for a row label)"*

They do matter now. In game the nameplate reads `<theirs> <mine>`, so after a
tank tags `Fuggin-Tanking` and a slow macro appends `+SLOWED`, the raid sees
`Fuggin-Tanking SLOWED` while we store just `SLOWED`. The tank name — the only
part the welder can use — is thrown away. That is how three mobs tagged with
tank names end up as an unweldable pool of `SLOWED`.

Fix: on `mode === 'append'`, store `((prev && prev.text ? prev.text + ' ' : '') + text).slice(0, 48)`.
The comment above it already predicted this ("the log would show a replace where
the raid saw a merge") — it is now a display bug too, not just a log fidelity one.

**(b) Welding only matches on tank NAME, never on the spawn id or the tagger** —
`index.js:10604`:

```js
const target = rows.find(c => !c._tag && (c.tanks || []).some(t2 =>
  textLower.includes(String(t2).toLowerCase())));
```

So a tag whose text is `inc`, `SLOWED`, `^S^`, or any callout that isn't a tank's
name can never bind, even though the tag carries a `spawn_id` that uniquely
identifies the mob. `#194` deliberately froze this at v1 ("Tags do not change K
in v1"), which was the right call for *counting* instances — an unwelded tag
can't say which HP band is its mob. But it also blocks the easy win:

1. **Weld by TAGGER first.** `tg.tagger` is the character who sent the tag. If
   that name is one of a row's tanks, the tag is theirs — no text matching
   needed. This alone fixes the "tank tags their own add with `inc`" case, which
   is the normal raid action.
2. Then fall back to the existing text match.
3. Then the existing single-tag/single-row rule.

Both are small and neither touches the K=1 byte-identical payload guarantee
(tags are additive fields). (a) is agent-side, (b) is bot-side, so they ship
separately.

**Workaround until then (usable tonight):** put the tank's name in the tag text
and use `!` (replace) rather than `+` (append) — `/tag chat !Fuggin-Tanking`.
A bare `inc` or `SLOWED` tag will pool, and an appended one will erase whatever
tank name was there.

### 5. "Kneel Test" on Mob Info — the junk-text guard counts the wrong set

Hitya, live: *"still seeing Kneel Test"* — Mob Info's DEBUFFS (OBSERVED) list on
Xerkizh The Creator showing `Kneel Test  1/1 · 0:01`.

The guard for this already exists and names the bug by name
(`packages/wolfpack-logsync/index.js:25841`, 2026-07-07):

> *"is struck by a sudden force." is 33 knockback-type spells, and the
> ambiguous-family resolver kept crowning EQEmu's internal "Kneel Test" (the
> only one with a nonzero duration) as its representative, writing 10k phantom
> rows into buff_casts and phantom entries onto Mob Info. Anything shared by >8
> distinct spell names is dropped from both indexes.*

It never fires, because of the order of two filters. Line 25824 skips every
spell without a timed duration formula **before** anything is indexed:

```js
if (!_isTimedDurationFormula(e.durf)) continue;   // 0 < f < 50
```

and the >8 threshold at line 25855 then counts only what survived that filter.
Of the 32 spells sharing `is struck by a sudden force.`, **exactly one has a
timed formula — Kneel Test (durf 5)**. Every other member is `durf 0`. So the
guard sees a family of size 1, not 33, and a family of one looks like the most
confident match in the catalog rather than the least.

**This is a class, not one row.** Measured against the live catalog — families
whose true size is >8 but whose timed-detrimental survivors are ≤8, so the guard
misses them:

| Landing text | Spells sharing it | Timed survivors | Verdict |
|---|---:|---|---|
| `is struck by a sudden force.` | 32 | **Kneel Test** | junk — a dev artifact |
| `has been struck by lightning.` | 11 | **Bolt of Karana** | junk — 10 unrelated lightning effects all credited to one real spell |
| `winces.` | 12 | Chords of Dissonance, Denon\`s Disruptive Discord | junk-ish |
| `looks very afraid.` | 12 | 7 fear spells | genuine family |
| `screams as poison burns their veins!` | 14 | 8 poison DoTs | genuine family |
| `begins to spin.` | 11 | 8 dizzy effects | genuine family |
| `begins to move faster.` | 9 | 4 × Brittle Haste | genuine family |

`Bolt of Karana` is the one to notice: it is a **real** spell, so nothing looks
wrong, and it appeared in tonight's own Mob Info screenshot on the crypt
guardian. Any of eleven lightning effects landing on a mob gets recorded as Bolt
of Karana with a real duration.

**Fix — do NOT just raise the threshold.** Counting the full family and dropping
everything >8 would take the four genuine families with it. The discriminator is
the *ratio*: a text shared by many spells where almost none are timed detrimental
is a generic effect text, and the one or two that are timed are coincidental.

```js
// Count the WHOLE family (before the durf/good filters), not the survivors.
// famSize: suffix → Set of every spell name carrying that landing text.
if (famSize.get(suffix).size > 8 && new Set(arr.map(h => h.name)).size <= 2) {
  dm.delete(suffix); junked++; continue;     // 32→1, 11→1, 12→2 all drop
}
// existing >8-survivors rule + slow-rescue continue to apply unchanged
```

That drops Kneel Test, Bolt of Karana and `winces.`, and leaves the fear / poison
/ dizzy / haste families alone (7, 8, 8 and 4 survivors). The fuller version is a
coherence check — keep the members that form one effect class, the way the
2026-07-27 slow-rescue already does for `yawns.` — but the ratio rule fixes
every case observed today and is two lines.

**No mid-raid mitigation.** The obvious one — zeroing `buffdurationformula` on
spell 2808 — was refused by the permission classifier, and it would have been
undone by the next weekly `sync-quarm.yml` run anyway. `eqemu_spells` is a
mirror; the fix belongs in the agent.

Backfill note: `buff_casts` rows already carry `spell_name = 'Kneel Test'` (and
misattributed `Bolt of Karana`). Worth a cleanup pass once the guard is fixed, or
those rows keep feeding `target-buffs` and the cure queue.

### 6. "Too Far" / "Can Not See" / "Can Not Hit From Here" — relay spam (FIXED live)

Hitya: *"someone is spamming too far or cannot see to the whole raid, we're not
seeing it or hearing it, but it's filling up the log on the dashboard."*

Three guild triggers on `Your target is too far`, `You cannot see your target`
and `You can't hit them from here`, all scoped `class_specific`, all relaying
guild-wide. The checkpoint journal was solid `guild_relay` rows, most of them
`stale-skipped — fire was 94s old at consumption` (a ~95s relay backlog, which is
itself the volume signal).

Their **only** action is `{"type":"sound","file":"alert3.wav"}`, and sound
actions are a documented no-op (`index.js:31208`: *"sound / emit_event beyond the
overlay's own audio remain no-ops in v1"*). So they produced nothing anyone could
see or hear, and relayed to the whole raid regardless — pure overhead. That is
also why the report was "we're not seeing it or hearing it": there was never
anything to see.

Fixed live by setting `default_scope = 'personal'` on all three
(`b8271e57-…`, `0f460928-…`, `54c8f9ae-…`). These are `You …` messages — only the
client that generated the line can ever see it, so a broadcast scope was never
meaningful. **No revert needed**; this one is a straight correction, not a
mitigation.

Follow-up worth taking: `sound` actions being silent no-ops is invisible in
`/admin/triggers`, so an officer can build a trigger that does nothing and get no
feedback. Either implement the action or mark it unsupported in the editor.

### 7. "REST IN PEACE" spoken twice — relay dedup keyed on observer-specific data

Hitya: *"We hear the 'REST IN PEACE' twice, not sure if it's local or hearing it
over discord."* It is local. Two defects compound.

**(a) The relay dedup key contains the raw log line.** A local fire is marked
seen under (`packages/wolfpack-logsync/index.js:28303`):

```js
const fireKey = (t.name || 'trigger') + ':' + JSON.stringify(captures || {});
```

and that same key is what rides the relay (`_relayLocalFire`, line 25238) and
what the consumer dedups on (`_consumeRelayFires`, line 25302). But `captures`
is the full `_buildCaptureBag` output, which always carries `0` (the whole
match) and `L`/`l` (**the raw log line, including that client's timestamp**).

Two raiders watching the same death produce the same `victim`/`killer` but
different `L`, because EQ log timestamps are second-resolution and client clocks
drift — the exact drift this repo already measures and corrects for (the
clock-offset work, agent `client_now` → consensus estimator). So:

- the ORIGINATOR dedups its own echo correctly (same machine, same key), but
- a SECOND observer's relay arrives with a different key and is never recognised
  as the same event.

Result: one callout locally, plus one more for every other observer whose
timestamp differed by a second. Intermittent by construction — which is exactly
why it sounds like it might be Discord bleed.

**This is the same root cause as the `_startTimer` P1 at the top of this
document.** Non-semantic bag keys (`0`, `L`, `l`) leaking into an identity key.
One fix serves both: build identity from the *semantic* captures only.

```js
const NON_SEMANTIC = new Set(['L', 'l', 'c', 'char', 'self']);
const idCaptures = Object.fromEntries(Object.entries(captures || {})
  .filter(([k]) => !NON_SEMANTIC.has(k) && !/^\d+$/.test(k)));
const fireKey = (t.name || 'trigger') + ':' + JSON.stringify(idCaptures);
```

The deliberate behaviour the comment at line 28299 protects — *"'RIP Hitya' and
'RIP Sweenie' within the same second both land"* — is preserved, because
`victim` is a semantic capture and stays in the key.

**(b) Relayed fires ignore `cooldown_seconds` entirely.** `_runRelayedFire`
(line 25543) builds a synthetic trigger with only `name`, `actions`,
`timer_duration_sec` and `_scope`. No `cooldown_seconds`, so the gate at line
27995 sees `undefined` and never fires. `Death touch — RIP` carries a 5s
cooldown that would otherwise have absorbed this whole class of duplicate.

That also means **raising `cooldown_seconds` in the DB cannot mitigate it** —
worth stating, because that is the obvious first thing to try.

Fix: carry `cooldown_seconds` (and `id`) onto the synthetic trigger so relayed
fires respect the same gate as local ones.

**How to confirm from the dashboard** (no code needed): the Trigger Checkpoint
Journal shows one row per fire with its scope. Two `Death touch — RIP` rows
within a second or two — one `guild`, one `guild_relay`, both reaching
`5/6 dispatched` — is this bug. A single row means the second voice came from
someone's open mic on Discord.

**Interim option A, DB-only:** set `default_scope = 'personal'`. Every client
that can see the death line fires it once from its own log, so the double is
impossible. The cost is real: a raider out of range of the death stops hearing it
at all, which is the case the relay was built for. **Rejected by Hitya
2026-08-10: "No we want that broadcast. We only want to hear it once."**

**Interim option B, DB-only — the one that actually matches the ask.** Move the
spoken half onto a `discord` voice action and leave the visual on the local
overlay:

```json
[{"type":"text_overlay","text":"RIP {victim}","color":"yellow",
  "duration_ms":4000,"require_raid_member":"victim"},
 {"type":"discord","voice":true,"message":"Rest in Peace {victim}"}]
```

Why this gives broadcast reach heard exactly once:

- `_relayLocalFire` **strips `discord` actions** (line 25232), so the spoken half
  never rides the relay — it can't double through that path by construction.
- The `discord` action's dedup key defaults to `t.name + ':' + msg`
  (line 28206) — the EXPANDED message, `Death touch — RIP:Rest in Peace Hitya`.
  No `L`, no timestamp, so it is **identical across every observer**, and the
  bot's cross-agent dedup (`index.js:12781`, `guildId|mode|key`) collapses all N
  reporters into one spoken callout.
- Everyone in raid voice hears it, including raiders out of range of the death
  line — which is the coverage `personal` scope would have lost.
- `require_raid_member` still protects it: the gate is **trigger-level**, so one
  action declaring it suppresses the entire fire (see the correction below).

Verified prerequisites: `RAID_VOICE_CHANNEL_ID` **is** set in Railway production
(the bot drops voice fires silently when it isn't — `if (!voiceCh) continue;`).

Residual risks, both real:
1. **No guild trigger uses a `discord` action today** — zero rows in
   `guild_triggers` match. This path is unexercised in this guild, so the first
   trigger to use it is also its first test.
2. It moves the callout from each raider's local speaker to Discord TTS, adding
   the agent → upload queue → Discord hop. Fine for a death notice (after the
   fact); wrong for anything that needs to warn *before* an event.

**Not applied mid-raid** for reason 1 — swapping the only death callout onto an
unproven surface during a raid risks losing it entirely. Test it on a throwaway
trigger first, then move RIP over.

### 7b. Every "yawns." in the database is recorded as Turgur's Insects — including item procs (NEW, 2026-08-10 post-raid)

Hitya: *"Ashieron slowed this sun revenant and it showed as shaman slow… instead
it shows as turgurs. It should have been the effect of Willsapper, since he
procced while wearing it."* Mob Info showed **`SHM SLOW Turgur's 75%`** with
`Turgur's Insects 43/60 · 4:18` in DEBUFFS (OBSERVED).

**The two spells are indistinguishable on a mob.** Verified against
`eqemu_spells`:

| | Energy Sap (1960, Willsapper proc) | Turgur's Insects (1588, SHM 60) |
|---|---|---|
| `cast_on_other` | `yawns.` | `yawns.` |
| duration | 65 ticks, formula 7 | 65 ticks, formula 7 |
| SPA 11 `max` | 65 → **35% slow** | 25 → **75% slow** |

Same emote, same duration. The one thing that differs — the magnitude — is never
printed. Energy Sap *does* have distinct text (`cast_on_you` = "You feel your
energy being sapped.", `spell_fades` = "You feel less tired.", against the shaman
line's shared "You feel drowsy."), but those are the ON-YOU forms and never
appear for a mob. **From a bystander log line the two are byte-identical.**

**We crown Turgur's on purpose.** `index.js:25862` — the 2026-07-27 slow-rescue
keeps the yawns family from the >8 junk guard, filtered to `_isSlowSpell`
members, so `parseDebuffLanding` "crowns a slow (Turgur's, longest duration)".
Energy Sap is not in `SLOW_SPELLS`, so it is dropped by the rescue filter and can
never be crowned, or tracked, or displayed.

**Scale — this is not one row.** Across the whole `buff_casts` table there are
**940 `Turgur's Insects` rows and ZERO rows for any other "yawns." spell** (Energy
Sap, Walking Sleep, Drowsy, Tagar's, Togor's, Tigir's, Curse of Turgur, Curse of
Walking Sleep, Mort Drowsy — none, ever). Every yawn the guild has recorded has
been labelled Turgur's.

**A large share of those are procs, not shaman casts.** On this one sun revenant:
thirteen "Turgur's" landings in 80 minutes, including pairs 23 seconds apart
(04:44:47 → 04:45:10, 04:48:17 → 04:50:25). Nobody re-casts a 6m30s slow that
way. And **Ashieron is a Paladin** — he cannot cast Turgur's Insects at all,
while `PAL` is in Willsapper's class list. For that landing the attribution is
provably wrong.

**The harm is tactical, not cosmetic.** The badge tells the raid the mob is
slowed **75%** when a proc has slowed it **35%** — and the same misattribution
feeds `target-buffs`, the cure queue and any analysis over `buff_casts`. It is
the same shape as §5 (Kneel Test / Bolt of Karana): an ambiguous landing text
where the resolver crowns a plausible representative and is silently wrong.

**Not fixed — needs a call from Hitya**, because it reverses a deliberate design
choice and changes raid-facing information. The options, and why this is not a
straight bug fix:

1. **Crown the weakest plausible member** when nothing names the caster. Never
   overstates; a real Turgur's would read 35% until a named cast confirms it.
2. **Show the family honestly** — `SLOWED (unidentified)`, no percentage — unless
   a cast was actually observed. Most truthful, loses the at-a-glance number.
3. **Prefer evidence, default to today's crown.** A self-cast or a relayed cast of
   a yawns-family slow on that target within a few seconds names the spell
   exactly; with no such cast, a yawn is far more likely a proc. Strong, but it
   assumes fleet coverage — an unmonitored shaman would be read as a proc.
4. **Gate on the roster**: a yawn cannot be Turgur's if no shaman is in the raid.
   Cheap and sound, but only helps on shaman-less nights.

Recommend **3 + 1**: use a named cast when one exists, and when none does, stop
claiming 75%. Either way `SLOW_SPELLS`/`SLOW_MAGNITUDES` need Energy Sap (35%,
labelled as a proc rather than a class) plus the four other unlisted yawns
members, and the 940 existing rows need a decision on relabelling.

⚠ Note for whoever implements: `_refreshSlowFromAmbiguousLand` has the same blind
spot from the other direction — an ambiguous yawn REFRESHES whichever family
member is already tracked, so a 35% proc silently re-opens a tracked 75% Turgur's
window. That is likely why the badge read `4:18` remaining rather than expiring.

### 8. Carried over from earlier tonight

- ~~**`require_raid_member` is an action-level gate only** — it does not suppress
  the trigger's timer.~~ **WRONG — checked and retracted 2026-08-10.** The field
  is *declared* on an action but *enforced* trigger-wide: `_fireTriggerActions`
  (`packages/wolfpack-logsync/index.js:28128`) returns before any action or timer
  runs if any action's `require_raid_member` capture is not a raid member or one
  of our pets. The comment says so explicitly — *"treat the whole trigger as
  suppressed (no actions, no timer)"* — and gives the reason: rendering a Death
  Touch countdown for a pet while suppressing the overlay text would be worse
  than doing neither. The only softness is deliberate: the gate **falls open**
  when `_raidRosterMembers` is empty (no Zeal type-5 roster seen yet), so
  out-of-raid testing still fires. Nothing to fix here.
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
