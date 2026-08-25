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
