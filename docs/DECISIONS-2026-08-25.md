# Decisions — 2026-08-25

## PoP parchment pools come from the quest scripts, not spell levels (Lacunanight's catch)

> "The spells I think are double dipping on the Matrix page … Necros have 9
> spells but shows 12" → "Necro turns in a Glyphed and can only get 3 spells
> which the matrix shows as correct but we have 4 spells at 65 but because we
> can get one through cleric with a 64 scroll it is not counted."

First night with site access (via the new invite flow) and he found a real
data bug — with the Quarm quest source in hand. The v1 page inferred parchment
pools from spell LEVELS (one-witness cleric inference, flagged as such in its
own header). The second witness broke it: pools are hand-curated per class in
the trainer scripts, and multi-class scrolls (Destroy Undead, cleric 64 /
necro 65) live in ONE class's pool.

**The fix was already in our database.** `scripted_npc_turnins` (the
ProjectEQ quest mirror, imported 2026-06) holds every PoK trainer's exact
per-parchment reward list. Verified against Lacunanight's live-Quarm
screenshot: the necro Glyphed trio (Blood of Thule / Child of Bertoxxulous /
Word of Terris) matches byte-for-byte.

- **`pop_parchment_pools` view** (migration 20260825030000): per (class,
  tier, scroll). The trainer's class is DERIVED — `bit_and` over the pool's
  scroll class-bitmasks resolves to exactly one class bit for all 13 PoK
  trainers (verified; both druid Wanderers collapse to one pool) — so a
  script re-import updates pools with no view change.
- **`pop_spell_needs` v2**: gains a `tier` column (the parchment that buys
  the spell FOR THAT CHARACTER'S CLASS); membership now also matches
  `'Song: %'` — **the old `'Spell: %'` filter silently dropped every bard
  reward** (Minstrel Eoweril's 19 rewards are all Songs). Bard pools: 8/8/3.
- **/pop matrix**: buckets by script-truth tier, plus an **Other** column for
  needed-but-not-from-your-turn-ins (research, or another class's tradeable
  scroll) — visible instead of miscounted, which was the "double dipping".
- **Spell-page badges** name the parchment from the pools; a PoP spell
  outside the class's pools says "not a turn-in" rather than guessing.

**Known divergence, deliberately left open:** our mirrored necro Ethereal
pool holds 7 scrolls; Lacunanight counted 8 in Quarm's (Lua) script. Quarm's
fork differs by ~one spell there. ProjectEQ ≈ Quarm everywhere we could
verify, so the mirror ships as the source — but the reconcile needs Quarm's
actual script files (⚠ needs a local session via
`docs/HANDOFF-pop-quest-extract.md`, or Lacunanight's copy of the repo).

**Queued, found while here:** `character_missing_spells` (the non-PoP
missing-spells path) likely has the same `'Spell: %'`-only filter — bards
under-served there too. Not expanded tonight (minimal diff).

## Per-class spell levels: `spell_level_seed.level` is the MINIMUM, not the truth

> Lacunanight, following his own catch: "Spell: Petrifying Earth is a Cleric 64
> spell but get it under Ethereal parchment (61-62) spells. Cleric turn in
> quest. … So is the quarm DB incorrect or was it adjusted to give some spells
> at lesser parchments. Who knows."

Neither. The Quarm DB is right, and it wasn't adjusted — **two errors of ours
stacked into one confusing display**, and he'd caught the first one an hour
earlier:

1. **The "(61-62)" label was our own inference**, deleted the same night
   (20260825030000). Vicar Ceraen's Ethereal list genuinely holds Petrifying
   Earth and Pacification. Verified: our cleric pools match his PQDI page
   exactly, 25/25 spells across all three tiers (13/7/5).
2. **The level we showed for Petrifying Earth — 62 — was the NECROMANCER's.**
   `spell_level_seed` stores one integer per spell, and the 2026-07-08 PQDI
   scrape stored the **minimum across all classes**, keeping per-class truth
   only in a free-text `note` ("Cleric 64, Shaman 64, Necromancer 62").
   Verified across all 308 seeds: `level` = min(note levels) in every row.

**Measured blast radius:** 355 class rows over 308 spells; **19 rows (15
spells) show a level wrong for that class**. Worst is 25 levels — Shadow Sight
displays necro 24 to a shadow knight whose level is 49. Infusion of Spirit
shows a beastlord 49 when theirs is 61. This affected every surface reading a
level, not just PoP.

**The fix** (20260825050000): promote the note to a real relation,
`spell_class_levels` (spell_id, class_name, class_key, level), and have
`pop_spell_needs` v3 return `COALESCE(class level, seed minimum)`. The note is
machine-readable and parsed cleanly — 308/308 seeds, 355 rows, 11 class
tokens, all valid class names, zero unknown tokens.

**Guarded because the failure mode is silent.** A regex that stops matching
doesn't error — it drops per-class levels and restores the old wrongness.
`spell_class_levels_parse_ok` is the health view; `test/spell-class-levels.test.js`
extracts the regex FROM the shipped migration and runs it against real notes.
Mutation-checked: narrowing the class pattern to exclude spaces kills two
tests (Shadow Knight).

**The deeper lesson, worth stating.** Both bugs were the same shape: a
single value standing in for a per-class fact — one level for all classes, one
level band for all pools. This platform's spell data is inherently
per-(spell, class), and any future collapse of that will be wrong the same way.

**Still open:** other consumers of `spell_level_seed.level` (character spell
pages, `character_missing_spells`) have the same substitution and should move
to `spell_class_levels` — those pages know the character's class, so the join
is available. Not done tonight (minimal diff); queued in STATUS.

## …and the same bug twice more in `character_missing_spells` (the pages he's reading next)

Followed the queued item to the character spell pages before Lacunanight got
there. Same root cause, two more instances, and **the worse one was not the
seed**:

```
scribe_level := coalesce(l.lvl, sd.level)
```

- **`l.lvl` was `min(spell_level)` over `character_spellbook` grouped by SPELL
  NAME ONLY** — a guild-wide minimum across every class, and it takes
  precedence, so it was the value actually shown. Live proof: three
  necromancers hold Shadow Sight at 24, one shadow knight holds it at 49 → the
  function returned **24 to every shadow knight**.
- `sd.level` is the seed minimum (fixed in 20260825050000).

**The spellbook data was never wrong** — necro 24 / SK 49 matches the PQDI
note exactly. Only the `GROUP BY` threw the class away. So group by
(spell, class) and prefer the observed same-class level: it comes from a real
Quarm spellbook export, which outranks a pqdi.cc scrape wherever the two could
disagree (relevant given the open Quarm-fork question above).

Resolution order, most to least authoritative:
1. observed level from a **same-class** spellbook (live Quarm truth)
2. `spell_class_levels` — the class's level from the PQDI note
3. `spell_level_seed.level` — the cross-class minimum, last resort

**Bards, again.** `i.name like 'Spell: %'` matched exactly **1** bard-flagged
item; their scrolls are `'Song: %'`, of which there are **107**. So a bard's
missing-spell page was effectively empty and had been since the function
shipped. Same omission `pop_spell_needs` had — worth noting the filter was
copied between them, which is how one wrong assumption became three.

Verified after: SK Shadow Sight now 49; bards return 42–60 missing rows.
Function signature unchanged, so no web change — the pages just get correct
numbers.
