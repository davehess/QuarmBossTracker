# 05 — Spell timer engine: pq-companion vs. wolfpack-logsync

**Scope:** their "tick-accurate buff/debuff countdown" engine vs. our buff-landing
tracking (`_buffLandingsByTarget` / `_petBuffLandings`).

**Legal:** pq-companion is *all rights reserved, no license*. Everything below is
description + short marked quotes (<10 lines). **Every code block in §4 is
original work written for our agent** — none of it is derived from their source
text. Their formula table is a port of EQMacEmu server behaviour (a fact about
the game, not their expression); we re-derive the same facts independently and
validate them against **our own** `eqemu_spells` mirror, which is what §4's test
vectors are built from.

---

## 1. Their duration / tick model

### 1.1 Package layout

| File | Role |
|---|---|
| `backend/internal/spelltimer/duration.go` (157 ln) | the formula table |
| `backend/internal/spelltimer/models.go` (165 ln) | `ActiveTimer`, tick constant, default level |
| `backend/internal/spelltimer/engine.go` (2171 ln) | land / fade / refresh / kill / charm state machine |
| `backend/internal/logparser/castindex.go` (175 ln) | data-driven land-text matcher |
| `backend/internal/logparser/parser.go` | fade / resist / interrupt / charm-break regexes |
| `backend/internal/buffmod/buffmod.go` (658 ln) | item + AA duration-focus resolution |
| `frontend/src/lib/spellHelpers.ts:316` | a hand-kept TS mirror of the same table |

### 1.2 The formula table

`CalcDurationTicks(formula, base, level)` — `duration.go:74-127`. Explicitly
documented as a port of **EQMacEmu**'s `CalcBuffDuration_formula`
(`zone/spells.cpp`), *not* modern EQEmu. Their header comment records why
(`duration.go:63-72`, quoted, 4 lines):

> This is a faithful port of EQMacEmu's CalcBuffDuration_formula
> (zone/spells.cpp) — the EQMac/Al'Kabor ruleset Project Quarm runs, whose
> formulas DIVERGE from modern EQEmu's. The earlier modern-EQEmu table here
> over-stated many durations…

The table (`duration.go:84-126`), with the two distinct clamp shapes
(`capAtBase` `:134`, `capToBase` `:149`):

| f | ticks | clamp |
|---|---|---|
| ≥200 | `formula` (literal tick count) | none |
| 0 | 0 (instant) | — |
| 1 | `level/2` | capAt |
| 2 | `level<=1 ? 6 : level/2+5` | capAt |
| 3 | `level*30` | capAt |
| 4 | `50` | capTo |
| 5 | `2` | capTo |
| 6 | **`level/2 + 2`** | capTo |
| 7 | `level` | capTo |
| 8 | `level+10` | capAt |
| 9 | `level*2+10` | capAt |
| 10 | `level*3+10` | capAt |
| 11 | `level*30+90` | capAt |
| 12 | `max(1, level/4)` | capTo |
| 50 | **0** (permanent → deliberately no countdown, `:119-123`) | — |
| other <200 | 0 | — |

`capAtBase(i, base)` = `i<base ? max(i,1) : base`; `capToBase(i, base)` =
`base ? min(i,base) : i`. All integer division is **floor** (Go `int` division).

Pinned by `duration_test.go:74-153` against PQDI, including
`{f6 forlorn lvl57 → 30}`, `{f6 forlorn lvl60 → 32}`, `{f10 charm lvl12 → 46}`,
`{f8 pacify 60 → 60}`.

### 1.3 Tick model / anchoring

- `eqTickSeconds = 6.0` (`models.go:16`).
- Duration is computed in **integer ticks**, then multiplied to seconds exactly
  once: `baseDurationSec := float64(durationTicks) * eqTickSeconds`
  (`engine.go:1077`).
- The timer is anchored at the **parsed log timestamp of the land line**
  (`ev.Timestamp` → `onSpellLanded(landedAt, …)`, `engine.go:471`, `:1098-1100`),
  not at wall-clock receipt. `ExpiresAt = landedAt + durationSeconds`
  (`engine.go:1079`).
- **They do not align to server tick boundaries.** There is no "round the first
  partial tick" logic anywhere. "Tick-accurate" means *the duration is an integer
  number of ticks*, not *the countdown is phase-locked to the server pulse*. Our
  model is identical in this respect — neither side can see the server's tick
  phase from the log.
- Rendering: server recomputes `RemainingSeconds = ExpiresAt - now` on every
  snapshot (`engine.go:2000`) and broadcasts at 1 Hz (`broadcastInterval`,
  `engine.go:143`). The overlay just paints `remaining_seconds` with a 1 s linear
  CSS transition (`TargetTimerList.tsx`), so the client never runs its own clock.

### 1.4 Level handling — hardcoded 60

This is the surprising part. The live engine **never uses the character's real
level**:

```
engine.go:1067   durationTicks := SpellDurationTicks(spell, defaultCasterLevel)
engine.go:2075   defaultCasterLevel,       // passed into buffmod.Resolve too
models.go:21     const defaultCasterLevel = 60
```

`models.go:18-21` justifies it: Quarm's cap is 60, so most formulas hit their cap
and the answer is right for a max-level character. Note the consequence: their
engine is **not PoP-aware** — they have `era.MaxLevel(popActive) → 65` and use it
in the `/characters` buffmod inspector (`api/characters.go:884-890`, which *does*
read `char.Level`), but the timer engine ignores both.

### 1.5 Bard-song clamp

`duration.go:23` — `bardSongUseBaseDuration = true`. For a spell only the bard
class can cast (`isBardSong`, `:41-55`: `classLevels[7] < 255` and every other
index `>= 255`), `SpellDurationTicks` returns the **raw `buffduration`** instead
of running the formula. Rationale (`:9-13`): songs pulse-refresh every tick while
the bard sings, so the only interval that matters is the fade after they stop.
Cross-class disciplines are excluded by the "bard-only" test
(`duration_test.go:58-72`). Mirrored in the frontend at `spellHelpers.ts:256`.

### 1.6 Land detection — data-driven `CastIndex`

`castindex.go:95-134` builds, once at startup, from the whole `spells_new` table:

- `youByText: map[cast_on_you] → []CastMessage` — **exact full-line O(1) lookup**
  for self-lands.
- `otherByPattern: []{suffix, ^(name)<suffix>$ regex, candidates}` sorted
  **longest-suffix-first**, with a cheap `strings.HasSuffix` pre-filter before
  the regex runs (`:154`) — their comment says it skips ~1,600 regex runs per
  unclassified line.
- Name capture class (`castindex.go:77`, quoted, 1 line):
  > `const nameClass = "[a-zA-Z][a-zA-Z' `]{2,29}"`

  Deliberately lowercase-tolerant so article-led mobs (`a gnoll`, `an iksar
  warrior`) match; false positives are gated downstream by the scope filter.
- Shared cast text is preserved as **`Candidates`**, not guessed at.

Disambiguation ladder (`engine.go:1311-1377`, `resolveLandedSpellName`):
1. unique match → done;
2. all candidates share a display *name* → use it (rescues same-named dupe rows);
3. `lastCastSpell` within `lastCastWindow` (30 s, `:156`) matches a candidate;
4. **sole item-clicky candidate**, tie-broken by *what the player actually
   carries* (`soleClickableCandidate` / `ownedClickyIDs`, `:1383-1447`);
5. curated `ambiguousLandGroups` (`:1243-1269`) — two entries only: Speed of the
   Shissar/Brood, and the 4-spell Resist Magic family;
6. otherwise **drop the land entirely** — no timer is created.

### 1.7 Fade / overwrite / refresh / cleanup

| Signal | Regex (`parser.go`) | Engine action (`engine.go`) |
|---|---|---|
| `Your X spell has worn off.` | `:45` | `:484-491` remove `(X, activePlayer)` |
| `X effect fades from Y.` | `:48` | `:493-502` remove exact `(X, Y)` |
| `Your illusion fades.` / `You forget Illusion: R.` | `:265` | `:504-508` wipe all `Illusion:*` for the player |
| `Your charm spell has worn off.` | `:139` (matched **before** the generic fade so it can't become `SpellName="charm"`) | `:510-518` `removeCharmTimers()` — wipe every `IsCharm` timer |
| `Your spell did not take hold.` | `:57` | `:473-482` only clears `lastCastSpell` (**no timer removal** — nothing had landed) |
| resist / interrupt | `:41-45` | same as above |
| player death | — | `:525-532` `removeSelfTimers()` — EQ strips your buffs on death; buffs *you* put on others survive |
| kill | — | `:534-542` `removeOnKill()` — exact target match **plus** an orphan sweep of every target-less detrimental, charm excluded (`:1569-1601`) |
| Zeal corpse target | — | `:594-607` `HandlePipeTarget` — `"<Name>'s corpse"` is treated as an always-in-range death signal, since the log's slain line never reaches a distant caster |
| zone | — | `:520-523` **deliberately no-op** — buffs survive zoning |

**Refresh** is trivially correct because the map key is composite:
`timerKey = "<spell>@<target>"` (`:202`). `e.timers[key] = timer` (`:1194`)
replaces a same-target recast and lets casts on *different* targets coexist —
their comment at `:1191-1193` calls out that this is what fixed AoE-mez collapse.

**Untargeted worn-off policy** (`removeBySpellNameOrID`, `:1742-1795`) is the
sharpest thing in the file: a `…worn off.` line names no target, so
- **detrimentals**: peel off exactly **one** instance — the nearest-expiry one —
  because AoE-mezzed mobs break independently and each break gets its own line;
- **buffs**: wipe all — a group buff is cast once and its members fade together.

**Expiry**: `pruneExpired` at 1 Hz (`:1855-1892`); with the user's "keep expired"
option on, a past-expiry row stays as a **count-up overdue reminder**
(`RemainingSeconds` goes negative, `Expired: true`, `snapshot():2002-2012`) until
`keepExpiredMaxOverdue = 60 min`.

**Zeal cross-check, unused**: `SetPipeBuffSlots` (`:616-679`) compares the
engine's self-buff timers against Zeal's buff-slot names and *logs divergence
only* — "No timers are pruned in this pass" (`:613-615`). See §5.

### 1.8 Focus / AA duration extension

`applyDurationModifiers` (`:2042-2095`) → `buffmod.Resolve` (`buffmod.go:553`).
Contributors come from a **Quarmy inventory export** (worn items' `focuseffect`
→ focus spell → SPA 128) plus a hardcoded AA table (`aaTable`, `:166`, because
Quarm's `aa_effects` is empty). Stacking (`:404-408`): best *single* item focus,
AAs sum additively, then `extended = base × (1+aa%) × (1+item%)`. Three
carve-outs: bards never receive duration extensions; off-class clickies get AA
but not item focus (SPA 134 max-level gate); Permanent Illusion AA overrides
self-cast SPA-58 durations to a flat 10 000 ticks.

Their own `LIMITATIONS.md` §11.2 concedes the flaw: for a buff **received** from
someone else, they apply the *recipient's* focuses, which is wrong — and §11.1
notes Quarm's server-side `spell_modifiers` overrides are invisible to them.

### 1.9 Charm

- `isCharmSpell` = any effect slot == SPA 22 (`:1644-1659`).
- `IsCharm` timers are **excluded from the kill orphan sweep** (`:1579`) — a
  charmed pet is a living ally, killing what it's tanking must not drop it.
- Cleared only by the generic charm-break line (`removeCharmTimers`, `:1667`) or
  natural expiry. Only one charm per character, so blanket-clear is correct.
- Duration comes straight from the catalog formula (charm line = f10/base 205 →
  190 ticks @ L60). They have **no** synthesis for charm spells with a null
  `cast_on_other`, and no cross-client relay.

---

## 2. Ours — same depth

All refs `packages/wolfpack-logsync/index.js` unless noted.

### 2.1 The formula table

`_durTicksForLevel(formula, capTicks, level)` — **`:2332-2357`**.

```
:2336  if (f === 50 || f === 51) return cap || 72000;   // permanent
:2337  if (!lvl || !f) return cap;                      // no level → spell max
:2340  case 1:  t = Math.ceil(lvl / 2);
:2341  case 2:  t = Math.ceil(lvl / 2) + 5;
:2342  case 3:  t = lvl * 30;
:2343  case 4:  t = cap || 50;
:2344  case 5:  t = 2;
:2345  case 6:  t = Math.ceil(lvl / 2);        ← no +2
:2346  case 7:  t = lvl;
:2347  case 8:  t = lvl + 10;
:2348  case 9:  t = lvl * 2 + 10;
:2349  case 10: t = lvl * 3 + 10;
:2350  case 11: t = (lvl + 3) * 30;            ← == lvl*30+90 ✓
:2351  case 12: t = Math.ceil(lvl / 4);
:2352  default: return cap;
:2355  if (cap > 0 && t > cap) t = cap;
```

Header comment (`:2313-2319`) states the design intent — **cap-dominated
degradation**: "any formula we get slightly wrong degrades to *max*, never to an
over-long timer beyond the spell's own cap." That intent is sound and is why most
of the divergences below are invisible; it also masked the formula-6 bug.

Divergences from EQMac, checked against **our** `eqemu_spells` mirror (see §2.6):

| f | ours | EQMac | real impact on our catalog |
|---|---|---|---|
| 1 | `ceil(l/2)` | `floor(l/2)` | +1 tick at odd levels only |
| 2 | `ceil(l/2)+5` | `floor(l/2)+5`, `l≤1→6` | +1 tick at odd levels only |
| 4 | `cap` | `min(50, cap)` | **none** — `max(buffduration)=50` for f4 |
| **6** | `ceil(l/2)` | `floor(l/2)+2` | **−2 ticks (12 s) for the 25 spells with base 35** |
| 12 | `ceil(l/4)` | `max(1, floor(l/4))` | none — **0 spells** use f12 |
| 50/51 | `cap ‖ 72000` | `0` (no countdown) | 4 spells with land text + base>0 |
| ≥200 | `cap` (via `default`) | `formula` | 13 spells with land text; `f600` base==600 so identical; `f3600` base 0 → suppressed |
| unknown | `cap` | `0` | no unknown formulas in catalog |

### 2.2 Tick model / anchoring

Same as theirs: integer ticks → `dur_ticks * 6` seconds (`targetBuffsFor:2733`,
`petBuffsForOwner:2611`), anchored at the **parsed EQ log timestamp** of the land
line (`bcEvt.cast_at` from `parseEqTimestamp`, `recordTargetBuffLanding:2713`).
No server-tick phase alignment — same limitation, same reason.

Rendering: our overlays poll the agent's local HTTP surface and read
`remaining_secs` / `total_secs` (`targetBuffsFor:2752-2755`), i.e. the countdown
is recomputed agent-side per poll. Equivalent to their 1 Hz push.

### 2.3 Level handling — richer than theirs

`_assumedCasterLevel()` (`:2325-2327`) returns **60 before `2026-10-01`, 65
after** — era-aware, which their engine is not.

Where the level comes from:

| Path | Level used | ref |
|---|---|---|
| `recordPetBuffLanding` | **owner's** `/who` level → era cap | `:2396` |
| `recordTargetBuffLanding`, `good===0` (debuff) | era cap | `:2683` |
| `recordTargetBuffLanding`, buff on our pet | owner's `/who` level → era cap | `:2685-2686` |
| `recordTargetBuffLanding`, other buff | **the TARGET's own `/who` level** → era cap | `:2687` |
| `_charmDurationSec` | owner's `/who` level → era cap | `:605` |
| bot-relayed `buff_casts` render | era cap | `:4634`, `:5609` |

`:2389-2395` records the bug this fallback was added for: without it, level-driven
formulas computed 0 ticks and the Charm tracker showed "fell off — rebuff"
instantly.

The last row is the defect — see §3.2.

### 2.4 Land detection — keyword-gated `cast_on_other` index

`_rebuildBuffMatchers` (`:25495-25547`) builds two suffix→candidates maps from
the catalog:

- `_buffLandingBySuffix` — requires `_isTrackedBuffName` (a curated keyword list,
  `:25471`) **and** `_isTimedDurationFormula(durf)`;
- `_debuffLandingBySuffix` — requires `good === 0` **and**
  `_isTimedDurationFormula(durf)`.

`_isTimedDurationFormula(f)` (`:25480-25483`) = `f > 0 && f < 50` — so
**formula 50/51 and formula ≥200 are never indexed**, deliberately.

Junk guard (`:25517-25543`): a suffix shared by **>8 distinct spell names** is
dropped from both indexes (their example: 33 knockback spells sharing "is struck
by a sudden force."), with a **slow-family rescue** — for the shaman-slow
"yawns." family (11 spells, over threshold) only the `_isSlowSpell` members are
kept so `parseDebuffLanding` still crowns a slow.

Three land parsers:

1. **`resolveSelfCastLanding`** (`:3253-3318`) — authoritative. We know what we
   cast (`_recentSelfCast`, 12 s window `:2771`), so we know the exact
   `cast_on_other` suffix. Matching is `bodyLower.endsWith(expectedLower)`
   (`:3279`) and the name is `body.slice(0, cut-1)` — the comment at `:3270-3276`
   records the multi-word bug this fixed ("A Soriz Slave slows down." split at
   the first space and lost the match). Target gate at `:3301-3304` with a
   **pet bypass** (a buff landing on our own pet is attributable even when the
   pet wasn't the live Zeal target — the `#117` Girdle of Karana case).
2. **`parseBuffLanding`** (`:25559-25622`) — bystander view of beneficial buffs.
   Two name shapes only (possessive `'s`, first space) and
   `_looksLikePlayerName` (`:25551`) requires a single capitalised word ⇒ **it
   cannot see buffs landing on mobs or multi-word names**. Ambiguity resolved by
   the observer's recent cast, preferring the cast whose recorded target matches.
3. **`parseDebuffLanding`** (`:25647-25684`) — bystander view of detrimentals.
   Peels 1..5 leading words plus the possessive form, `_looksLikeTargetName`
   (`:25629`) accepts article-led / backticked / hyphenated multi-word mobs.
   Ambiguous family → **`hits.reduce(max by raw h.dur)`** (`:25668`).

**Gap:** the catalog carries `cast_on_you` (`e.you`, populated by the bot at
`index.js:5266`) but **no index is ever built from it** — grep confirms zero
readers. Consequence: a debuff a mob lands on *us* ("You have been slowed.",
"You feel drowsy.") never enters `_buffLandingsByTarget`. See §3.6 for why this
is mostly moot for us.

### 2.5 Fade / refresh / cleanup

| Signal | Handled? | ref |
|---|---|---|
| `Your pet's X spell has worn off.` | ✅ sets `worn_off_at` on both stores | `notePetBuffWornOff:3331-3351` |
| `Your charm spell has worn off.` | ✅ charm tracker only | `:1238` |
| `Your X spell has worn off.` (self buff) | ❌ **no handler** — only user-authored triggers (`SUGGESTED_TRIGGERS:26710+`) fire overlay text; the landing store is untouched | — |
| `X effect fades from Y.` | ❌ **no handler anywhere** | — |
| `Your spell did not take hold.` | ❌ no handler | — |
| player death | ❌ no self-landing clear | — |
| mob death | ⚠️ only on **K→0** (last same-named instance) via `_clearNameObservations:28299-28304`, which `delete`s the whole target bucket | — |
| zone | ❌ no clear (matches theirs — correct) | — |

`worn_off_at` is written from exactly **two** places, both inside
`notePetBuffWornOff` (`:3342`, `:3348`) — confirmed by grep.

**Refresh** works: `mp.set(newKey, {...})` on the same `(target, spellLower)` key
overwrites in place (`:2710`, `:2415`).

**Overwrite** is where we are *ahead* of them — two mechanisms they have nothing
comparable to:
- `_resistLadderEffect` (`:2482-2500`) — 6 ranked ladders (4 resist schools +
  run speed). A higher link deletes lower links; a **lower cast over a higher
  link returns `{skip:true}`** because the cast was blocked in-game.
- `_categorizeBuff` (`:2501-2508`) over `_BUFF_KEYWORDS` (`:2448-2457`) — 8 slot
  categories; a new buff evicts the previous occupant of the same category.
- `_collapseObservedBuffSlots` (`:2530-2547`) does the same collapse on the
  merged local + cross-client list, newest-wins.

**Expiry / linger** — `targetBuffsFor:2726-2759` and `petBuffsForOwner:2609-2637`:
- `FELL_OFF_LINGER_MS = 5 min` (`:2331`) purple "fell off — rebuff" cue;
- HoTs (`_isHotBuff` = `regen` category, `:2551`) get **6 s** (one tick);
- pet path additionally caps at 6 s for any catalog duration **< 60 s**
  (`_shortFx`, `:2621` — "you don't rebuff a stun, you re-stun"). **The
  target path (`:2738`) does not have the `_shortFx` clause** — asymmetry.

`_shouldSuppressBuffLanding` (`:2661-2666`) keeps instant effects out entirely:
catalogued spells with no timed formula **and** no positive base are dropped, and
so are uncatalogued self-casts (overwhelmingly nukes/procs). Applied at both the
local store and the `buff_casts` upload (`:31745-31748`) so an instant nuke can't
ride the cross-client relay onto every client's Mob Info — the `#154` fix.

### 2.6 Catalog source

Bot endpoint `GET /api/agent/spell-catalog` (`index.js:5220-5305`), ETag'd,
1 h server cache, paged 1000/req from `eqemu_spells`. Selected columns
(`index.js:5256`): `id, name, cast_on_you, cast_on_other, spell_fades,
buffduration, buffdurationformula, cast_time, good_effect` → emitted as
`{id, name, you, other, fades, dur, durf, cast_ms, good}` (`:5265-5272`),
`version: 4`. Agent caches to `logsync.spell-catalog.json` and rebuilds the
matchers on load (`:25254-25269`).

**Catalog shape observed (live query against `zhtoekwakucbckvatfky`):**

| durf | spells | with land text | max base |
|---|---|---|---|
| 0 | 1711 | 1343 | 9000 |
| 1 | 245 | 238 | 1000 |
| 2 | 85 | 81 | 39 |
| 3 | 867 | 691 | 6000 |
| 4 | 52 | 52 | **50** |
| 5 | 133 | 124 | 18 |
| **6** | **74** | **74** | **35** |
| 7 | 178 | 174 | 360 |
| 8 | 85 | 84 | 360 |
| 9 | 64 | 63 | 360 |
| 10 | 171 | 167 | 600 |
| 11 | 131 | 126 | 5000 |
| 50 | 74 | 74 | 360 |
| 600 | 2 | 2 | 600 |
| 3600 | 61 | 15 | 20000 |

f6 base distribution: **25 spells at base 35**, 1 at 30, everything else ≤ 25.
`eqemu_spells` has **no `classes1..15` columns** — bard-song detection (§1.5) is
not expressible without a schema change.

### 2.7 Charm

- `CHARM_SPELLS` (`:542-595`) — a **curated** name → `{cls, dur}` map, both
  apostrophe and backtick spellings, with `catalogDur: true` opt-in for
  Tunare's Request only.
- `_charmDurationSec` (`:601-610`) — level-aware catalog duration for
  `catalogDur` entries, static map value otherwise. The comment at `:597-600`
  explains why the map stays authoritative: **Boltran's Agacerie has a duplicate
  catalog row with the wrong formula** (id 1705 f8/75 → 420 s vs id 1706 f10/205
  → 1140 s). Confirmed live: `SELECT` on name returns only id 1706.
- `_recordCharmSpellOnTarget` (`:1581-1619`) — charm spells have
  `cast_on_other = NULL` (confirmed live for Allure id 184 and Boltran's id
  1706), so no log line exists. We **synthesize** the landing into
  `_buffLandingsByTarget` and push it to `buff_casts` with `is_charm_spell`
  so *other* Mimic clients targeting the same pet see it. Nothing equivalent
  exists on their side.
- `_captureTargetBuffsOnCharm` (`:1505-1544`) — on charm land, sweep
  target-keyed entries into the owner key, gated by
  `PRE_CHARM_DEBUFF_WINDOW_SEC = 60` (`:1504`) so a stale entry from a
  previous same-named mob can't ride along, with a tie-break that prefers the
  longer `dur_ticks` to heal pre-v3.1.1 rows.

### 2.8 The Zeal path — our ground truth

`_zealBuffsForName` (`:28575-28593`) returns the target's **real remaining ticks
from Zeal's buff slots** (`b.ticks * 6`) when the target is one of our own
characters, and `buildMobInfo` (`:28607-28613`) prefers it over observed
landings. Cross-client, the same is true for other Mimic-running raiders.

This is the exact capability pq-companion's `LIMITATIONS.md` §11.2 lists as an
**unavailable future data source** ("a future Zeal build exposing the client's
real per-slot buff tick counts would make all received-buff timers exact"). They
have the pipe (`SetPipeBuffSlots`) but only log divergence from it. **We already
consume it.** Formula math is therefore, for us, a *fallback for mobs and
non-Mimic players* — which is precisely where §3.1 bites.

---

## 3. What they do correctly that we fail on

Ranked by real user-visible damage.

### 3.1 Formula 6 is missing the `+2` term — every slow in the game is 12 s short

**Them:** `duration.go:102` → `capToBase(level/2 + 2, base)`. Pinned by
`duration_test.go:107-109` (`f6 forlorn lvl57 → 30`, `lvl60 → 32`).
**Us:** `:2345` → `Math.ceil(lvl/2)` capped at base.

At L60, base 35: **theirs 32 ticks = 192 s, ours 30 ticks = 180 s**.

The 25 catalogued f6/base-35 spells are, essentially, *the entire slow line* plus
the Velious slow-debuffs — confirmed live: Tepid Deeds (185), Shiftless Deeds
(186), Drowsy (270), Languid Pace (302), Walking Sleep (505), Tagar's Insects
(506), Togor's Insects (507), Slow (954), Lethargy (1315), Tigir's Insects (1589),
**Forlorn Deeds (1712)**, Curse of Walking Sleep (2266), Plague of Insects (2527),
Shackle of Bone/Spirit (2542/2544), Sha's Lethargy (2634), Rag`Zhezum's Deathly
Embrace (2787), Sha's Advantage (2942), Vas Ren Slow (2948), Hinderance of the
Vas Ren (2949), Cloud of Grummus (3380), Sha`s Revenge (3462), Barb of Tallon
(2449), Burrowing Scarab (1016), Scarab Storm (1312).

**Scenario.** L60 enchanter lands Forlorn Deeds (id 1712, f6, base 35) on a raid
boss at 20:00:00. Truth: fades 20:03:12. Our Mob Info slow chip hits 0 and goes
purple **"fell off — rebuff" at 20:03:00**, and the `#130` slow tracker fires its
"Slow dropped" callout 12 s early. The shaman re-slows into a live slow: the cast
is wasted, and on a high-MR raid target that's a wasted 6 s of cast time plus mana
during the exact window where the raid is watching for a *real* slow drop.
Because the `_shortFx` clause doesn't apply on the target path (§2.5), the chip
then sits purple for the full 5 minutes while the mob is still slowed.

Note this bites hardest exactly where our Zeal ground-truth path (§2.8) *cannot*
help: debuffs on mobs.

### 3.2 Beneficial-buff duration scaled by the TARGET's level, not the caster's

**Them:** always the caster-side assumption (`defaultCasterLevel = 60`).
**Us:** `recordTargetBuffLanding:2687` uses `whoData.get(targetLower).level`.

EQ computes buff duration **on the caster**. Using the recipient's level is only
right for a self-buff.

**Scenario.** A L60 druid casts Chloroplast (id 145, f10, base 205) on a guildie's
L52 alt during a corpse run. Truth: `min(52... no — min(60*3+10, 205)` =
**190 ticks = 1140 s**. We compute at the *target's* 52: `min(52*3+10, 205)` =
**166 ticks = 996 s** — the chip goes purple **2 min 24 s early**. Same for
Regrowth of the Grove (1569, f10/205). Any f7/f8/f9/f10 buff on a sub-60 target
under-reports; f3 buffs (Aegolism 1447 base 1500, KEI 2570 base 1500, Clarity II
1693 base 350) are cap-dominated and unaffected, which is why this has stayed
hidden.

### 3.3 No explicit fade detection — a dispelled or overwritten effect keeps counting

**Them:** `parser.go:45`/`:48` → `engine.go:484-502`, removing the exact
`(spell, target)` pair; plus the untargeted-worn-off peel-one policy
(`:1742-1795`) that handles AoE mez correctly.
**Us:** the only fade signal we act on is `Your pet's X spell has worn off.`

**Scenario.** Chanter lands Tashania (id 678, f9, base 140 → `min(130,140)` =
130 ticks = 780 s) on a raid mob at 20:00:00. At 20:00:40 the mob's AoE dispel
strips it and EQ prints `Tashanian effect fades from <mob>.` Their timer
disappears. **Ours shows 12 more minutes of Tash remaining** — so nobody re-Tashes
and the raid eats resists for the rest of the fight. Identically for a self-buff
overwritten by a stronger version: `Your Clarity spell has worn off.` fires the
user's overlay trigger but leaves the landing store ticking.

Also missing: `Your spell did not take hold.` (their `:57`/`:473-482`). They don't
remove a timer on it either (nothing landed), but they *do* clear `lastCastSpell`
so it can't mis-disambiguate a later ambiguous land — we have no equivalent
invalidation on `_recentSelfCast`.

### 3.4 Death / kill cleanup is narrower than theirs

**Them:** `removeSelfTimers()` on player death (`:521-532`), `removeOnKill()` on
any kill matching the target name (`:1569`), **plus** the Zeal corpse-target
signal (`HandlePipeTarget:594-607`) which works even when the caster is too far
from the boss for the slain line to reach their log.
**Us:** `_clearNameObservations` (`:28299-28304`) fires only when a death drops
the same-name count K to 0.

**Scenario.** Two `a shissar taskmaster` are up. Our chanter mezzes both, one
dies. K goes 2→1, so the bucket is not cleared, and both mezzes' chips continue
to count down against the survivor's single target key. (Their orphan sweep has
the *opposite* failure — their own comment at `:1553-1561` admits an unrelated
pet kill wiped a boss debuff timer.)

This one is constrained by the documented Zeal boundary in `CLAUDE.md`
("Zeal pipe carries no spawn id — same-name mobs are NOT disambiguable"). Their
Zeal-corpse signal *is* portable and we don't use it for buff landings.

### 3.5 Permanent / literal-tick formulas produce bogus countdowns

**Them:** f50 → `0` with an explicit comment (`:119-123`) that returning EQMac's
`0xFFFF` would show "a bogus multi-day timer"; f≥200 → literal tick count.
**Us:** f50/51 → `cap ‖ 72000` (`:2336`), f≥200 and unknown → `cap` (`:2352`).

Low blast radius on the live catalog: only 4 land-text f50 spells with base>0
(Acting Spirit I id 1921, base 360 → we would show a 36-minute countdown for a
permanent buff), and the f≥200 set is 2 × f600 (base 600, so `cap` == `formula`
— identical answer) plus 13 f3600 familiars/test spells whose base is 0 and are
therefore already suppressed by `_shouldSuppressBuffLanding`. Worth fixing for
model correctness, not for user impact.

### 3.6 Things where their approach is better *in principle* but we should not chase

- **Self-land indexing** (`castindex.go:82` `youByText`, O(1) full-line map).
  We download `cast_on_you` and never index it. But our own character's buff
  window comes from **Zeal with real remaining ticks** (§2.8), which is strictly
  better than any formula estimate. Building a `you` index would only add value
  for non-Zeal users. **Skip.**
- **Bard-song base clamp** (§1.5). Requires `classes1..15`, absent from our
  catalog; and bard songs on our characters already come from Zeal's song window
  (ids 135-140, surfaced with real ticks at `:28587-28589`). **Skip.**
- **Focus / AA duration extension** (§1.8). Needs a Quarmy-style inventory
  export we don't have, and their own §11.2 admits it produces *wrong* answers
  for received buffs. Our documented "no-focus floor" model is the safer one.
  **Skip.**
- **Conservative ambiguity policy.** They drop an ambiguous land entirely rather
  than guess (`resolveLandedSpellName:1372-1376`). Ours crowns a representative.
  For their use case (self-cast tracking) dropping is right; for ours (bystander
  observation of raid debuffs) showing a representative is right. **Keep ours** —
  but see §4.4 for a bounded fix.
- **`soleClickableCandidate` inventory tie-break** (`:1383-1417`) — genuinely
  elegant (disambiguate a shared clicky land text by *what the player carries*).
  We have `item-clickies` from the bot; a future refinement, not a defect.

---

## 4. Adaptation plan

All sketches are original, plain JS, zero-dep, our comment idiom.

---

### 4.1 — **P0** · Fix formula 6 and the floor/ceil semantics

*Effort: ~20 min. Risk: low. Files: `packages/wolfpack-logsync/index.js` only.*

Minimal, surgical version — leaves every existing fallback (`f50 → cap`,
`default → cap`, `!lvl → cap`) untouched so nothing else can move. Replace the
switch body at `:2339-2353`:

```js
  // EQMac/Al'Kabor integer division is FLOOR, and formula 6 carries a +2 term
  // we never had. On our catalog that's 25 spells at base 35 — the whole slow
  // line (Forlorn Deeds, Tagar's/Togor's/Tigir's Insects, Languid Pace, Slow,
  // Shackle of Spirit, Cloud of Grummus …). At L60 the real answer is 32 ticks
  // (192s); we were computing 30 (180s), so Mob Info flipped the slow chip to
  // "fell off — rebuff" and the #130 tracker called "Slow dropped" 12s before
  // the mob actually un-slowed — long enough for the shaman to burn a re-slow
  // into a live slow. Everything else here is unchanged in effect at L60 (the
  // ceil→floor swap only moves odd-level results, and every f4 spell in the
  // catalog has base <= 50 so `cap` already equalled min(50, cap)).
  let t;
  switch (f) {
    case 1:  t = Math.floor(lvl / 2);          break;
    case 2:  t = (lvl <= 1) ? 6 : Math.floor(lvl / 2) + 5; break;
    case 3:  t = lvl * 30;                     break;
    case 4:  t = 50;                           break;   // capped below
    case 5:  t = 2;                            break;
    case 6:  t = Math.floor(lvl / 2) + 2;      break;   // ← the fix
    case 7:  t = lvl;                          break;
    case 8:  t = lvl + 10;                     break;
    case 9:  t = lvl * 2 + 10;                 break;
    case 10: t = lvl * 3 + 10;                 break;
    case 11: t = lvl * 30 + 90;                break;
    case 12: t = Math.max(1, Math.floor(lvl / 4)); break;
    default: return cap;
  }
```

`case 4` changing from `cap || 50` to a plain `50` is safe *and* more correct: the
existing `if (cap > 0 && t > cap) t = cap` at `:2355` reproduces
`capToBase(50, base)` exactly, and `cap === 0` now yields 50 rather than 0.

**Test vectors** (all verified against our live `eqemu_spells`):

| spell | id | f | base | level | expected ticks | expected sec | ours today |
|---|---|---|---|---|---|---|---|
| Forlorn Deeds | 1712 | 6 | 35 | 60 | **32** | **192** | 180 ✗ |
| Tagar's Insects | 506 | 6 | 35 | 60 | 32 | 192 | 180 ✗ |
| Forlorn Deeds | 1712 | 6 | 35 | 57 | **30** | **180** | 180 ✓* |
| (any f6 base 3) | — | 6 | 3 | 60 | 3 | 18 | 18 ✓ |
| Turgur's Insects | 1588 | 7 | 65 | 60 | 60 | 360 | 360 ✓ |
| Cripple | 1592 | 8 | 75 | 60 | 70 | 420 | 420 ✓ |
| Tashania | 678 | 9 | 140 | 60 | 130 | 780 | 780 ✓ |
| Chloroplast | 145 | 10 | 205 | 60 | 190 | 1140 | 1140 ✓ |
| Aegolism | 1447 | 3 | 1500 | 60 | 1500 | 9000 | 9000 ✓ |
| Clarity II | 1693 | 3 | 350 | 60 | 350 | 2100 | 2100 ✓ |
| Tunare's Request | 1556 | 3 | 1950 | 60 | 1800 | 10800 | 10800 ✓ |
| (f1, base 1000) | — | 1 | 1000 | 57 | **28** | **168** | 174 ✗ |
| (f2, base 39) | — | 2 | 39 | 55 | **32** | **192** | 198 ✗ |

\* right answer, wrong arithmetic — `ceil(28.5)=29` capped nowhere vs
`floor(28)+2=30`; coincidence, not correctness.

Ship as an agent patch on `beta` (`packages/wolfpack-logsync/package.json` bump
only, per the routing table).

---

### 4.2 — **P0** · Use the *caster's* level assumption for received buffs

*Effort: ~20 min. Risk: low. Behaviour change: sub-60 targets' buff chips get longer.*

Replace the level selection at `:2680-2689`:

```js
// Whose level scales this landing? EQ computes buff duration on the CASTER, so
// the recipient's level is only the right input when the recipient IS the
// caster. We were reading whoData for the TARGET on every beneficial buff,
// which under-reports any level-scaled buff put on a sub-60 character: a L60
// druid's Chloroplast (f10/205) on a L52 alt is 190 ticks (1140s), but scaled
// at 52 it computes 166 (996s) — the Mob Info chip flips to "fell off — rebuff"
// nearly two and a half minutes early. Priority order:
//   1. our own pet    → the owner cast it; use the owner's /who level
//   2. genuine self-buff (we cast it AND we are the target) → our own level
//   3. everything else → the era cap. A raid buff or a debuff comes from a
//      max-level raider whose identity the land line never carries, and
//      _assumedCasterLevel() already tracks the PoP unlock (60 → 65).
function _casterLevelForLanding(bcEvt, targetLower) {
  const petOwner = _petOwnerByName(targetLower);
  if (petOwner) return (whoData.get(petOwner) || {}).level || _assumedCasterLevel();
  const obs = String((bcEvt && bcEvt.observer) || '').toLowerCase();
  if (bcEvt && bcEvt._selfCast && obs && obs === targetLower) {
    return (whoData.get(obs) || {}).level || _assumedCasterLevel();
  }
  return _assumedCasterLevel();
}
```

then in `recordTargetBuffLanding`:

```js
  const lvl = _casterLevelForLanding(bcEvt, k);
```

(The `good === 0` branch collapses into this — debuffs already fell through to
the era cap, and now so does every buff we can't attribute to a known caster.)

**Test vectors:**

| case | spell | f/base | expected |
|---|---|---|---|
| L60 druid → L52 alt | Chloroplast 145 | 10/205 | 190 t = **1140 s** (was 996) |
| L60 druid → L52 alt | Regrowth of the Grove 1569 | 10/205 | 190 t = 1140 s (was 996) |
| self-buff, `/who` says L52 | Chloroplast 145 | 10/205 | 166 t = 996 s (correct — caster *is* the L52) |
| L55 owner → own pet | Boon of the Garou | 7/60 | 55 t = 330 s (owner level, unchanged) |
| unknown caster, any level | Aegolism 1447 | 3/1500 | 1500 t = 9000 s (cap-dominated, unchanged) |

---

### 4.3 — **P1** · Explicit fade detection for target + self landings

*Effort: ~1 h incl. a couple of live-log spot checks. Risk: low-medium (regex must
not swallow the two existing charm/pet lines).*

New detector, called from the tail dispatch next to `notePetBuffWornOff`
(`:31733`):

```js
// EQ prints two fade shapes we have never consumed. Without them a debuff that
// is dispelled, resisted-off, or overwritten keeps counting down to its full
// computed duration — a Tashania stripped 40s into a fight still shows twelve
// minutes left, so nobody re-Tashes. Marking worn_off_at (rather than deleting)
// reuses the existing "fell off — rebuff" linger in targetBuffsFor.
//   "Tashanian effect fades from Kelorek`Dar."  → names spell AND target
//   "Your Shiftless Deeds spell has worn off."  → names spell, target = us
// Ordering matters: "Your charm spell has worn off." (charm tracker, :1238) and
// "Your pet's X spell has worn off." (notePetBuffWornOff, :3331) each own their
// line and must not fall through here — the first would invent a spell called
// "charm", the second would look up a target named after the player.
const _FADE_FROM_RX = /\]\s+(.+?)\s+effect fades from\s+(.+?)\.\s*$/;
const _FADE_SELF_RX = /\]\s+Your\s+(.+?)\s+spell has worn off\.\s*$/i;

function noteBuffFadeLine(line, character) {
  if (!line) return;
  let m = line.match(_FADE_FROM_RX);
  if (m) { _markLandingWornOff(m[2], m[1]); return; }
  m = line.match(_FADE_SELF_RX);
  if (!m) return;
  const spell = m[1].trim();
  if (/^charm$/i.test(spell) || /^pet's\b/i.test(spell)) return;   // owned elsewhere
  if (character) _markLandingWornOff(character, spell);
}

// Fade lines often carry the LINE name rather than the spell name — EQ prints
// "Tashanian" for every member of the Tash family — so match exact first and
// fall back to a prefix match. Never matches more than the one target's bucket.
function _markLandingWornOff(targetName, spellName) {
  const mp = _buffLandingsByTarget.get(String(targetName || '').toLowerCase());
  if (!mp) return;
  const want = String(spellName || '').toLowerCase();
  if (!want) return;
  let hit = false;
  if (mp.has(want)) { mp.get(want).worn_off_at = Date.now(); hit = true; }
  else {
    for (const [k, b] of mp) {
      if (k.startsWith(want)) { b.worn_off_at = Date.now(); hit = true; }
    }
  }
  if (hit) _savePetStateSoon();
}
```

Wire-up (one line, alongside the existing pet handler at `:31733`):

```js
        if (!_sourceExcluded) noteBuffFadeLine(line, b.character);
```

**Test vectors (line → effect):**

| log line | expected |
|---|---|
| `[…] Tashanian effect fades from a shissar taskmaster.` | `_buffLandingsByTarget['a shissar taskmaster']` entry whose key starts `tashani` gets `worn_off_at` |
| `[…] Your Shiftless Deeds spell has worn off.` | `_buffLandingsByTarget['<char>']['shiftless deeds'].worn_off_at` set |
| `[…] Your charm spell has worn off.` | **no-op here** (charm tracker at `:1238` owns it) |
| `[…] Your pet's Girdle of Karana spell has worn off.` | **no-op here** (`notePetBuffWornOff` owns it) |
| `[…] Your Clarity spell has worn off.` with no landing recorded | no-op, no throw |

Consider also carrying the same signal to `buff_casts` so the bot's cure/debuff
queue retires the row cross-client — that's a bot-side follow-up on `main`, not
part of this agent patch.

---

### 4.4 — **P2** · Rank ambiguous debuff families by *computed* duration

*Effort: 10 min. Risk: minimal.*

`parseDebuffLanding:25668` picks `max(h.dur)` — but `buffduration` is a per-formula
**cap**, not a duration.

```js
    // Ambiguous family → representative. Rank by the COMPUTED duration, not the
    // raw buffduration: that column is a per-formula cap, so a f10/base-205 row
    // (190 ticks at 60) outranks a f3/base-200 row (a full 200 ticks) on the raw
    // number while being the shorter debuff. Evaluate at the era cap — the
    // caster of a bystander-observed debuff is a max-level raider.
    if (names.size > 1) {
      const _lvl = _assumedCasterLevel();
      const _ticks = (h) => _durTicksForLevel(h.durf, h.dur, _lvl);
      resolved = hits.reduce((best, h) => (_ticks(h) > _ticks(best) ? h : best), hits[0]);
    }
```

**Test vectors:**

| family (suffix) | members | winner | expected |
|---|---|---|---|
| `yawns.` | Turgur's 1588 (7/65 → 60 t), Tagar's 506 (6/35 → 32 t), Drowsy 270 (6/35 → 32 t) | Turgur's | 360 s (same answer as today, right reason) |
| synthetic f10/205 vs f3/200 | — | f3/200 | 200 t = 1200 s (today picks the f10 → 1140 s) |

---

### 4.5 — **P2** · Model "untimed" explicitly (f0 / f50 / f51 / unknown)

*Effort: ~45 min. Risk: medium — changes what `dur_ticks: 0` means downstream.*

Do this **after** 4.1 lands and only if we want the model clean; user impact is
4 spells today (§3.5).

```js
// Formulas with no countdown at all. EQMac reports 0xFFFF for permanent buffs;
// showing that verbatim would render a multi-day bar, and showing `cap` (what
// we do today) renders a fake one — Acting Spirit I (id 1921, f50, base 360)
// currently counts down 36 minutes for a buff that never ticks. Return null so
// callers can render a presence-only chip with no bar. Formula >= 200 is a
// LITERAL tick count in EQMac (the field IS the duration); on our catalog the
// only land-text case is f600/base-600, where `cap` already gave the same
// answer, so this costs nothing and removes a lurking wrong branch.
function _durTicksForLevelOrNull(formula, capTicks, level) {
  const f = Number(formula) || 0;
  if (f === 0 || f === 50 || f === 51) return null;      // instant / permanent
  if (f >= 200) return f;
  return _durTicksForLevel(f, capTicks, level);
}
```

Then in `targetBuffsFor:2732-2745` / `petBuffsForOwner:2610-2629`, guard the
expiry branch:

```js
    // dur_ticks === null → presence-only (permanent buff / instant with a base
    // we can't interpret). Never expire it, never flag fell_off, never draw a
    // proportional bar — just show the name.
    if (b.dur_ticks == null) {
      out.push({ name: b.name, remaining_secs: null, total_secs: null,
        observed_at_ms: b.landed_at, good: _spellGood(b.name), fell_off: false, owner: b.owner || null });
      continue;
    }
```

**Test vectors:** Acting Spirit I (1921, f50/360) → `null` (no countdown, was
2160 s); Captain Nalots Quickening (1925, f600/600) → 600 t = 3600 s (unchanged);
Familiar (2557, f3600/0) → 3600 t (currently suppressed upstream, unchanged in
practice).

---

### 4.6 — **P3** · Apply the pet path's `_shortFx` linger cap to the target path

*Effort: 5 min. Risk: none.*

`petBuffsForOwner:2621` caps the "fell off" linger at one tick for any catalog
duration under 60 s; `targetBuffsFor:2738` doesn't. Same one-liner, same
rationale ("you don't rebuff a stun, you re-stun"):

```js
    const _shortFx = ((Number(b && b.dur_ticks) || 0) * 6) > 0 && ((Number(b && b.dur_ticks) || 0) * 6) < 60;
    const lingerMs = (_isHotBuff(b && b.name) || _shortFx) ? 6_000 : FELL_OFF_LINGER_MS;
```

**Test vector:** a 12 s stun landing on a mob → purple cue for 6 s, not 5 min.

---

### 4.7 — **P3** · Zeal corpse-target as a debuff-clear signal

*Effort: ~30 min. Risk: medium (touches the mob-track death path).*

Their `HandlePipeTarget` (`engine.go:594-607`) treats a Zeal target of
`"<Name>'s corpse"` as an unambiguous death signal, explicitly because the log's
slain line never reaches a caster standing away from a raid boss. We already read
Zeal's target name (`_zealTargetForChar:2772`) and already have corpse-suffix
handling elsewhere. Feeding it into `_clearNameObservations` would clear a boss's
debuff bucket for a chanter who never saw the kill line.

**Caveat and why this stays P3:** `CLAUDE.md`'s Zeal boundary means a corpse
target proves *a* same-named mob died, not *which*. Gate it to K→0 exactly as
the log path already does, i.e. use it as an additional trigger for the existing
rule, never as a new rule. Do **not** copy their orphan sweep — their own comment
(`engine.go:1553-1561`) records it wiping a boss debuff on an unrelated pet kill.

---

### 4.8 — Explicitly **not** doing

| Idea | Why not |
|---|---|
| Index `cast_on_you` for self-lands | Zeal gives our own characters real remaining ticks (`:28575`); a formula estimate would be a downgrade. Only helps non-Zeal users. |
| Bard-song base-duration clamp | Needs `classes1..15`, absent from `eqemu_spells`; bard songs on our chars already come from Zeal's song window (`:28587`). |
| Item/AA duration focus (`buffmod`) | Needs an inventory export we don't have; their own §11.2 admits it's wrong for received buffs. Our "no-focus floor" is documented and safer. |
| Their drop-on-ambiguity policy | Correct for self-cast tracking, wrong for our bystander-observation use case. 4.4 is the bounded version. |
| Their untargeted-worn-off "peel one" policy | Only reachable once we have 4.3; and our AoE-mez story is already constrained by the no-spawn-id boundary. Revisit after 4.3 ships. |
| Curated `ambiguousLandGroups` | Our >8-name junk guard + slow rescue (`:25517-25543`) already covers the same ground data-driven-ly. |

---

## 5. Risks, effort, and what **not** to regress

### Effort / risk summary

| # | Item | Effort | Risk | Ship on |
|---|---|---|---|---|
| 4.1 | Formula 6 `+2`, floor semantics | 20 min | low | `beta`, agent bump |
| 4.2 | Caster-level for received buffs | 20 min | low | `beta`, agent bump |
| 4.3 | Explicit fade lines | 1 h | low-med | `beta`, agent bump |
| 4.4 | Family rank by computed duration | 10 min | minimal | `beta` |
| 4.5 | Untimed model (null ticks) | 45 min | **medium** | `beta`, after 4.1 |
| 4.6 | `_shortFx` on target path | 5 min | none | `beta` |
| 4.7 | Zeal corpse → debuff clear | 30 min | medium | `beta`, gated K→0 |

4.1 + 4.2 + 4.6 are one small commit and cover the entire user-visible defect
surface.

### Specific risks

- **4.1 is a visible behaviour change.** Every slow timer gets 12 s longer and
  the `#130` "Slow dropped" callout fires 12 s later. That is the *point*, but
  raid leads who have internalised the current cadence will notice. Worth a
  `CHANGELOGS` line even though it's an agent-only change.
- **4.1 touches `_charmDurationSec`** (`:606`). Verified inert: the only
  `catalogDur: true` entry is Tunare's Request (f3, base 1950) which is
  cap-dominated at every level ≥ 60.
- **4.2 changes what `whoData` is used for.** Confirm no other reader depends on
  `recordTargetBuffLanding` scaling by target level (grep says no; only `:2687`).
- **4.5 changes the meaning of `dur_ticks`** across the persisted pet-state file
  (`:2182-2243` serialise/restore) and the `buff_casts` upload shape. If a `null`
  reaches the bot's `dur_ticks` column or the cross-client relay unguarded, other
  clients could render `NaN`. Keep `null` agent-local; upload 0 with an explicit
  `untimed: true` if it ever needs to cross the wire. This is why it's P2 and
  gated behind 4.1.
- **4.3 regex ordering.** `_FADE_SELF_RX` must run *after* the charm and pet
  detectors in the dispatch, and its two guards must stay. A `Your pet's X spell
  has worn off.` line reaching `_markLandingWornOff(character, "pet's X")` would
  silently no-op today but is a trap if the store ever gets a `pet's …` key.
- **Cross-version skew.** Fixed durations flow into `buff_casts` and out again
  via `/api/agent/target-buffs`, so during rollout a fixed client and an
  unfixed client will disagree by 12 s on the same slow. Local-wins merge
  (`:28620-28624`) means each user sees their own client's number — acceptable,
  but worth knowing when a user reports "my timer doesn't match his."

### Do **not** regress — where our model is the better one

1. **Zeal per-slot remaining ticks** (`_zealBuffsForName:28575`, preferred in
   `buildMobInfo:28607-28613`). This is *ground truth* and pq-companion's
   `LIMITATIONS.md` §11.2 lists it as a data source they wish they had. Formula
   math must stay a fallback for mobs and non-Mimic players, never a replacement.
2. **Era-aware assumed level** (`_assumedCasterLevel:2325`, 60 → 65 at
   `2026-10-01`). Their engine hardcodes 60 (`models.go:21`) and will be wrong
   across the whole PoP-scaling range on unlock day.
3. **Curated `CHARM_SPELLS` durations** (`:542-595`) and the `catalogDur` opt-in
   (`:597-600`). A blanket catalog-first lookup regresses Boltran's Agacerie from
   420 s to 1140 s — the catalog's only row for that name (id 1706) carries the
   wrong formula. Their `GetSpellByExactName` would hit exactly that row.
4. **Charm synthesis + cross-client relay** (`_recordCharmSpellOnTarget:1581`,
   `is_charm_spell`). Charm spells have `cast_on_other = NULL`; they have no
   synthesis path and no relay, so their charm timers are local-only and their
   Mob Info equivalent shows nothing.
5. **`_captureTargetBuffsOnCharm`** (`:1505`) with the 60 s pre-charm window
   (`:1504`). Nothing comparable exists on their side — they never migrate a
   pre-charm debuff onto the pet's owner key.
6. **Slot / ladder overwrite** (`_resistLadderEffect:2482`, `_categorizeBuff:2501`,
   `_collapseObservedBuffSlots:2530`), including the *blocked-cast* semantics
   (`{skip:true}` when a higher ladder link is already up). Their engine has no
   slot model at all: a fresh Spirit of Wolf leaves a stale Journeyman's Boots
   row on the overlay forever.
7. **Graded "fell off — rebuff" linger** (`FELL_OFF_LINGER_MS:2331`,
   `_isHotBuff:2551`, `_shortFx:2621`). Their equivalent is a binary
   drop-or-keep-60-minutes toggle.
8. **Junk-text guard + slow rescue** (`:25517-25543`). Data-driven, and it
   handles families (33-spell knockback texts) that their curated
   `ambiguousLandGroups` list of two would never enumerate.
9. **`_shouldSuppressBuffLanding`** (`:2661`) applied at *both* the local store
   and the upload (`:31745`) — the `#154` fix that stops an instant nuke riding
   the relay onto every client. Their pipeline drops zero-duration spells at
   `engine.go:1068` but has no relay to protect.
10. **Multi-word / article-led target peeling** in `parseDebuffLanding`
    (`:25656-25657`, `_looksLikeTargetName:25629`). Theirs solves the same
    problem differently (anchored per-suffix regex); ours works and is tuned for
    our data. No reason to swap.
