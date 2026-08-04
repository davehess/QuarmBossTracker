# RUNBOOK — the 37 `^`-anchored triggers that can never fire (#190)

*Written 2026-08-04. This quantifies and fixes a KNOWN open item — `#190 dead
^-anchored guild triggers batch` in `STATUS.md`. The database write is prepared
below but **not applied**: it needs your go-ahead.*

---

## 1. The finding

**37 of our 109 enabled guild triggers cannot match any log line.** Eight of them
are the Feeblemind / Shadow Poison / Wave of Death callouts built in this
session — including the Feeblemind one that was explicitly rushed out ahead of a
raid. They have never fired and never could.

### Why

`evaluateTriggersAgainstLine` runs each pattern against the **raw log line**,
which begins with the EQ timestamp:

```
[Sun Aug 02 21:10:01 2026] Uilnayar looks somewhat dimwitted.
```

Patterns compile with flags `'i'` — **no `m`** (`_applyGuildTriggersResponse`) —
so `^` anchors to the start of the whole string, not the start of the message.
A pattern like `^{s} looks somewhat dimwitted\.$` requires the line to *begin*
with the name. It begins with `[`.

`_translateDotNetRegex` passes `^` through untouched; it only rewrites `(?>` and
`{s}`-family placeholders. Nothing anywhere strips the timestamp before matching
— sibling code paths in the same tail loop strip it explicitly when they need to
(`line.replace(/^\[.+?\]\s*/, '')`), which is the proof that `line` still carries
it.

### Verified, not reasoned

Lifting the shipped `_translateDotNetRegex` out of the agent and running the real
compiled patterns against real-shaped lines:

| trigger | bare message | with `[timestamp] ` prefix |
|---|---|---|
| Shaman Slow landed | matches | **NO MATCH** |
| Feeblemind — landed | matches | **NO MATCH** |
| Shadow Poison — cure | matches | **NO MATCH** |
| Wave of Death — ON YOU | matches | **NO MATCH** |
| Enrage (Begin) | matches | **NO MATCH** |
| Death touch — RIP | matches | **NO MATCH** |
| Carnage *(no `^`)* | matches | match |

The unanchored control matters: it proves the failure is the anchor, not the
message text.

## 2. The fix

Replace the leading `^` with `^\[.+?\]\s+` — anchor past the timestamp instead of
removing the anchor. Confirmed to restore matching **and** to capture cleanly,
including multi-word and backtick names:

| trigger | captured `{s}` after fix |
|---|---|
| Feeblemind — landed | `Uilnayar` |
| Shadow Poison — cure | `Aten Ha Ra` |
| Wave of Death — serpent AE | `` Rhag`Zhezum `` |
| Enrage (Begin) | `a shissar disciple` |

> **Do NOT "fix" this by just deleting the `^`.** The `{s}` character class
> (`[\w'`\ -]`) includes **space**, so an unanchored pattern matches starting at
> the space after `]` and captures **` Uilnayar`** with a leading space. That
> silently corrupts every name-keyed thing downstream — TTS, the charm-pet
> suppression check, `require_raid_member`. The explicit prefix consumes the
> separator with `\s+` and hands back a clean name.

## 3. Apply it — staged, because 37 at once is a wall of noise

### Stage 1 — the eight from this session *(recommended: run this one)*

These were requested, built, and shipped broken. Fixing them delivers what was
asked and adds no callouts nobody asked for. All are boss-specific (Thought
Horror Overfiend, Vex Thal, Ssra serpents), so the noise floor barely moves.

```sql
update guild_triggers
set pattern    = '^\[.+?\]\s+' || substring(pattern from 2),
    updated_at = now()
where enabled
  and created_at >= '2026-08-03'
  and pattern like '^%'
  and pattern not like '^\\[%'
returning name, pattern;
```

Expect **8 rows**: Feeblemind ×3, Shadow Poison ×3, Wave of Death ×2.

### Stage 2 — the other 29 *(your call, and it is a real call)*

Same statement without the `created_at` filter. **This is not a free win.** These
29 have been silently dormant for a long time, and the raid's sense of "normal
callout volume" was formed without them. Turning them all on the day before a
Vex Thal night could be a wall of TTS mid-fight. They include every slow-landed
callout (Shaman, Enchanter, Druid, Magician, Bard, Shaman-plague), Enrage
begin/end, Cripple, Malo, Tashania, Ensnare, Gate/Gating, Mark of Karn, Mana
Burn, Death touch — RIP, and the Hail helpers.

Suggested order rather than a big-bang: enable the **boss-mechanic** ones first
(Death touch, Enrage, Waves of the Deep Sea, Chaos Breath, Cloud of
Disempowerment, The Dain's Justice), watch one raid, then decide on the
slow-landed family — six simultaneous slow callouts on every pull is the most
likely source of "make it stop".

**Either stage reaches the fleet in ~2 minutes** (guild-trigger poll; the
no-change gate is `max(updated_at)`, which the statement bumps). No release, no
Mimic update. Reverting is the same statement in reverse.

### Verify after applying

```sql
select count(*) still_dead from guild_triggers
where enabled and pattern like '^%' and pattern not like '^\\[%';
```

Then, in game, trip one deliberately — `Enrage (Begin)` on any trash pull is the
cheapest — and confirm the overlay line and TTS.

## 4. The full list of 37

★ = created 2026-08-03/04 in this session (Stage 1).

**Boss mechanics / raid-critical**
★ Feeblemind — landed / — ON YOU / — faded (Overfiend) ·
★ Shadow Poison — cure {s} / — ON YOU / — gone ·
★ Wave of Death — ON YOU / — serpent AE (Ssra) ·
Death touch — RIP · Chaos Breath · Cloud of Disempowerment ·
Waves of the Deep Sea · Asphyxiate · The Dain's Justice · Mark of Karn

**Debuff landed (the noisy family)**
Shaman Slow landed · Shaman Plague Slow landed · Enchanter Slow landed ·
Druid Slow landed · Magician Slow landed · Bard Slow landed ·
Sha's Advantage · Cripple · Malo · Tashania · Ensnared ·
Fufil's Curtailing Chant

**Mob behaviour**
Enrage (Begin) · Enrage (End) · Gated · Gating

**Self / utility**
Casting Spell · Mana Burn Casting · Mana Burn Fades ·
Resisted (your cast) · Hail Me · Hail Corpse

## 5. Stop this recurring

Three separate trigger defects have now been found by inspection rather than by
anything automatic: the invented Divine Intervention pattern
(`DESIGN-di-callout.md` §0), the mis-signatured AOE_DANCE entry, and these 37.
Every one of them was **enabled**, which is what made them invisible — an enabled
trigger reads as coverage on `/admin/triggers` and in everyone's memory.

Two cheap guards, in order of value:

1. **Reject a `^`-anchored pattern at save time** on `/admin/triggers` — or
   silently rewrite it to `^\[.+?\]\s+`, since a human writing `^` always means
   "start of the message". A trigger that cannot fire should not be creatable.
   This is the one that would have caught all 37 *and* the eight I added.
2. **Flag enabled-but-never-fired on `/admin/triggers`.** Needs the durable fire
   record from `DESIGN-callout-overlay.md` §3.1, so it comes later — but it is
   the general detector, and it also catches the invented-text case that a
   syntax check cannot.
