// PoP spell turn-ins — which parchment buys which spell, per class.
//
// Hitya 2026-08-20: "look at the PoP spell quests. Add some of that
// information to the spells page so people know what they need to turn in."
//
// v1 inferred the pools from spell LEVELS (Ethereal→61-62, Spectral→63-64,
// Glyphed→65), derived from the one quest script we could read (cleric) and
// explicitly flagged as one-witness. The second witness killed it
// (Lacunanight, 2026-08-25, with Quarm's necro script in hand): the pools are
// HAND-CURATED per class. The necro Glyphed awards exactly three spells, not
// "every level-65 necro spell", and Destroy Undead (cleric 64 / necro 65)
// lives in the CLERIC Spectral pool — the level rule overcounted necro 12
// where the quest gives ~8.
//
// v2 reads the actual scripts: the `pop_parchment_pools` view over our
// ProjectEQ turn-in mirror (scripted_npc_turnins), per (class, tier, scroll).
// Verified byte-for-byte against Lacunanight's live-Quarm screenshot on the
// necro Glyphed trio; one known ±1 divergence on necro Ethereal is recorded in
// the migration header (20260825030000). There is deliberately NO level
// fallback — a spell absent from a class's pools shows as "not from your
// turn-ins", which is information, not a gap.

export type TurnInKey = 'ethereal' | 'spectral' | 'glyphed';

export type TurnIn = {
  key: TurnInKey;
  item: string;
  itemId: number;
  blurb: string;
};

export const POP_TURN_INS: Record<TurnInKey, TurnIn> = {
  ethereal: {
    key: 'ethereal', item: 'Ethereal Parchment', itemId: 29112,
    blurb: 'Turn in to your class trainer in PoK for a random spell from their Ethereal list (mostly level 61-62).',
  },
  spectral: {
    key: 'spectral', item: 'Spectral Parchment', itemId: 29131,
    blurb: 'Turn in to your class trainer in PoK for a random spell from their Spectral list (mostly level 63-64).',
  },
  glyphed: {
    key: 'glyphed', item: 'Glyphed Rune Word', itemId: 29132,
    blurb: 'Turn in to your class trainer in PoK for a random spell from their Glyphed list (mostly level 65).',
  },
};

export const POP_TURN_IN_ORDER: TurnInKey[] = ['ethereal', 'spectral', 'glyphed'];

/** A row of the pop_parchment_pools view. */
export type PoolRow = {
  class_name: string;
  tier: TurnInKey;
  scroll_item_id: number;
  spell_name: string;
};

const normClass = (c: string | null | undefined) =>
  String(c || '').toLowerCase().replace(/\s+/g, '');

/** spell name (lowercased) → tier, for ONE class. The lookup the badge and
 *  matrix code use — keyed by name because every consumer already has the
 *  spell's display name, and the view's names are catalog-canonical. */
export function poolTierByName(pools: PoolRow[], charClass: string | null | undefined): Record<string, TurnInKey> {
  const want = normClass(charClass);
  const out: Record<string, TurnInKey> = {};
  for (const p of pools) {
    if (normClass(p.class_name) !== want) continue;
    out[p.spell_name.toLowerCase()] = p.tier;
  }
  return out;
}
