# DESIGN — capturing instant boss mechanics (#206)

*Written 2026-08-04 (overnight design pass). Unbuilt. This is the write-up of
the discard audit Uilnayar asked for on 2026-08-03.*

**The ask:**

> we need to get an audit of what's being discarded. if it's something that
> affects everyone we need to pair it up to an affect on the fight and start
> dialing in these callouts when it makes sense. this is the pattern recognition
> we talked about when we discussed our raid strategies evolving with more
> repetition and reporters.

---

## 1. The audit result

Scope: every distinct spell castable by an NPC we have **actually fought**
(`encounters.npc_id` → `eqemu_npc_types.npc_spells_id` →
`eqemu_npc_spells_entries`). Re-runnable — the query is in §6.

| | count | can we see it today? |
|---|---:|---|
| Timed spells (`buffduration > 0`) with an on-other message | **113** | **yes** — the buff-landing index catches these |
| Timed, no on-other message | 7 | no (nothing to match) |
| **Instant spells (`buffduration = 0`) with an on-other message** | **138** | **NO — this is the gap** |
| Instant, no on-other message | 5 | no (nothing to match) |
| **total distinct boss spells** | **263** | |

**138 mechanics emit a perfectly good log line that nothing in our pipeline
reads.** Not because the line is missing — because of *how* we look for things.

### Why they're invisible: two gates, neither built for this

1. **The buff-landing index is keyed on DURATION.** It exists to answer "what is
   currently on this target, and when does it fall off" — so it indexes spells
   with a duration. An instant spell has none, so it is structurally
   unindexable there. Not a bug; a category error.
2. **`shouldKeep` is default-DROP.** It keeps *positively identified* combat
   lines — damage numbers, slain lines, heals, casts. `"<Name>'s soul fades into
   darkness."` is none of those, so it never reaches `parseEvent` at all.

`triggerVisibleLine` (default-KEEP) is the exception that proves the point: it
was added precisely because 9 of 17 shipped trigger templates could never fire
under `shouldKeep`. **Triggers can already see these lines.** What's missing is
that nobody has written the triggers, and nothing *records* them for analysis.

### What's actually in the 138

| category | n | of which AE (`targettype = 8`) |
|---|---:|---:|
| direct damage | 89 | 23 |
| unclassified marker (SPA 10) | 11 | 2 |
| **self/ally HEAL** | **10** | 0 |
| SPA 21 (stun) | 10 | 1 |
| summon pet | 9 | 0 |
| **dispel** (SPA 27) | 4 | 1 |
| SPA 79 (instant HP) | 2 | 0 |
| gate/teleport | 1 | 0 |
| ≥5k nuke (death-touch class) | 1 | 0 |

Named examples, all invisible today, all on mobs we have fought:

- **`Complete Healing`** — *"\<mob\> is completely healed."* A boss healing
  itself to full. We have a whole encounter-splitter heuristic
  (`find_or_create_encounter`, the ≥0.9×HP sequential-kill splitter) that exists
  to reason about mobs going back to full — and the mob is **announcing it in
  plain text** while we infer it from damage totals. Recall the Lord of Ire case
  (2026-07-13) where a full-heal reset knitted two fights into one.
- **`Nullify Magic` / `Annul Magic` / `Beholder Dispel`** — *"\<name\> feels
  dispelled."* Raiders losing buffs mid-fight. The buff queue currently learns
  this only by the buff eventually not being there.
- **`Touch of Vinitras`** (−20,000) — a death touch.
- **23 AE direct-damage spells** — the "AoE dance" class of mechanic. We hand-write
  a trigger per AE we happen to notice; there are 23 in mobs we've *already
  killed*.
- **`Gate`** — *"\<mob\> fades away."* The boss left. That is an encounter
  outcome we currently record as "the fight just stopped".
- **`Fling`** — *"\<name\> is knocked into the air by a massive force."*

## 2. The design: a third capture path

Two paths exist. Add a third, parallel to them, with its own key:

| path | keyed on | answers |
|---|---|---|
| `shouldKeep` → `parseEvent` | damage/heal numbers | "who did how much" |
| buff-landing index | spell **duration** | "what's on this target, for how long" |
| **NEW: mechanic index** | **catalog `cast_on_other` text** | **"what did the boss just DO"** |

### How it works

**Build the matcher from the catalog, not by hand.** For the NPCs in the current
zone (or better: the current encounter's mob and its spell list), pull
`cast_on_other` for every spell with a message and compile a name-anchored
matcher. This is the same shape as `CHARM_SPELLS` / `SLOW_SPELLS`, except
**derived** rather than curated — 263 entries is far past hand-maintenance, and
hand-curation is exactly what produced the dead DI trigger (see
`DESIGN-di-callout.md` §0).

Serve it like the existing catalogs: an **ETag'd endpoint** next to
`spell-catalog` / `item-clickies`, scoped to the mobs the guild fights, cached
agent-side.

### What a match produces

A `mechanic_event`: `{ encounter_hint, mob, spell_id, spell_name, victim,
at, observer }`. Three consumers, in increasing ambition:

1. **Record it.** Even with no callout, this immediately gives us "what actually
   happens during this fight, in order" — the thing the ask calls pattern
   recognition. Correlate against the (now honest) deaths and the threat
   snapshots and you can answer *"we wipe 40 seconds in — what fires at 40
   seconds?"* with data instead of memory.
2. **Auto-suggest callouts.** A mechanic that recurs across N pulls of the same
   boss and correlates with deaths is a callout candidate. Surface it on
   `/admin/triggers` as *"Va Dyn Khar casts Ceticious Cloud ~every 45s; 6 of the
   last 9 deaths were within 10s of it. Make a trigger?"* — **propose, don't
   auto-create.** Officer confirms.
3. **Live callouts** through the existing trigger/TTS/overlay path (#207), with
   the mechanic index supplying the pattern instead of a human guessing it.

### Why derived beats hand-written

Every hand-written pattern we've audited has had a defect: the DI trigger matched
nothing (invented text), the AOE_DANCE trigger watched the wrong spell's text,
the pet Death Touch capture can't match multi-word names, and a batch of
`^`-anchored triggers were dead (#190). A pattern generated from the same catalog
row the server uses **cannot be wrong about the text**. It can still be wrong
about *relevance* — which is what the human confirmation step in (2) is for.

## 3. Scope limits (state them, don't discover them)

- **`cast_on_other` has no name placeholder.** The stored text is the *suffix*
  (`"feels dispelled."`); the client prepends the target name. So the matcher is
  `^(?<victim>.+?) <suffix>$` and inherits the same multi-word-name problem that
  bit the pet Death Touch capture (#169) — `a glyph covered serpent feels
  dispelled.` needs a non-greedy leading capture and NO capital-initial anchor.
- **Some suffixes are ambiguous across spells.** `"feels much better."` belongs to
  Healing, Greater Healing, and Superior Healing alike. Same class of problem as
  buff-cast `spell_id` resolution (bot 3.1.6), and the same answer: resolve when
  unique, record the *name* and leave `spell_id` NULL when not. **Never guess.**
- **Zone/mob scoping is mandatory.** A guild-wide text matcher merges mobs across
  zones — precisely the bug #141 fixed for Mob Info. Scope to the observer's
  zone from the start.
- **Volume.** 23 AE spells × a raid × a long fight is a lot of rows if we record
  one per victim per cast. Record per CAST with a victim count, not per victim,
  unless the per-victim detail earns its keep.

## 4. Adjacent finding — a second site still carries the old death belief

While tracing the parse gates: `_deadMobNameFromLine`
(`packages/wolfpack-logsync/index.js`, ~line 28300 on **both** `main` and
`beta`) still matches `/\]\s+(.+?)\s+die[ds]\.\s*$/i`. `parseEvent` was corrected
to `died.` only in agent 3.5.11; **this second site was not.**

It feeds `_cancelTimersOnMobDeath`, which cancels a boss-buster countdown when
the named target dies. Narrow but real failure mode: a countdown timer whose
target is a **player** (a "\<name\>, get out" style callout) is cancelled if that
player **feigns**, since the feign emits `"<Name> dies."` and this matcher accepts
it. SKs and monks are exactly the classes that both feign and get called out.
Mob-targeted timers are unaffected in practice — NPCs emit `died.`.

I have not demonstrated it against a real log, so treat it as **plausible, not
confirmed**. It's a one-character fix (`die[ds]` → `died`) in two places on
`beta` plus a test. Deliberately not made during a design pass.

## 5. Related standing gap

`#75`'s audit found three `KEEP_PATTERNS` misses that are *also* real data loss
today (Quarm two-line DS flavor, bystander exceptional heals, spell crits) — two
of those were fixed in agent 3.4.44. The pattern is the same as this doc's: **the
default-DROP gate silently defines what the platform is able to know.** Any future
"why don't we track X" question should check `shouldKeep` before concluding the
data doesn't exist.

## 6. The audit query (re-runnable)

```sql
with fought as (select distinct npc_id from encounters where npc_id is not null),
npcs as (
  select n.id, n.npc_spells_id from eqemu_npc_types n
  join fought f on f.npc_id = n.id where coalesce(n.npc_spells_id,0) > 0),
sp as (
  select distinct s.spellid from eqemu_npc_spells_entries s
  join npcs on npcs.npc_spells_id = s.npc_spells_id)
select count(*) total,
  count(*) filter (where sl.buffduration > 0 and coalesce(sl.cast_on_other,'') <> '') timed_visible,
  count(*) filter (where coalesce(sl.buffduration,0) = 0 and coalesce(sl.cast_on_other,'') <> '') instant_gap
from sp join eqemu_spells sl on sl.id = sp.spellid;
```

Re-run it after any expansion unlock — the gap grows with the boss list, and
**PoP unlocks 2026-10-01**.

## 7. Open questions for Hitya

- **Record-only first, or go straight to callouts?** Recording is safe, cheap,
  and makes the callout question answerable with evidence instead of opinion.
  Recommend record-only for one raid cycle, then propose callouts from what it
  finds.
- **How aggressive should auto-suggest be?** "Fires every pull" is a low bar;
  "correlates with deaths" is a high one and needs a few nights of clean
  (post-feign-fix) death data first.
- **Scope to raid targets only, or everything?** Everything is more complete and
  noisier. Raid targets are what the callouts are for.
