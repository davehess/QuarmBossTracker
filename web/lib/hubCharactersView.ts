// One character's card on raidmimic.com/characters: what its flags prove, and what it needs next. Reads the PoP
// "what's next" logic (web/lib/popNextSteps.ts), which takes plain catalog flag keys, so the hub rows feed it directly;
// nothing here reads pop_flags or any Wolf Pack table. Pure.

import { nextCard, nextSteps, type NextCard } from './popNextSteps';
import { stepLabel, stepZone } from './popFlagsPaste';

export type CharacterView = {
  name: string;
  proof: string;
  /** Distinct flag keys the character has (a re-upload at a new time repeats keys; they count once). */
  flagCount: number;
  next: NextCard;
  /** The flags it has, grouped by zone card in catalog order, each in plain words. */
  groups: { zone: string; labels: string[] }[];
  lastExport: string | null;
};

export function characterView(name: string, proof: string, rows: { flag_key: string; earned_at: string }[]): CharacterView {
  const keys = [...new Set(rows.map(r => r.flag_key))];
  const byZone = new Map<string, Set<string>>();
  for (const k of keys) {
    const z = stepZone(k);
    if (!byZone.has(z)) byZone.set(z, new Set());
    byZone.get(z)!.add(stepLabel(k));
  }
  const last = rows.reduce<string | null>((m, r) => (m === null || r.earned_at > m ? r.earned_at : m), null);
  return {
    name, proof,
    flagCount: keys.length,
    next: nextCard(nextSteps({ done: [], flags: keys })),
    groups: [...byZone.entries()].map(([zone, labels]) => ({ zone, labels: [...labels] })),
    lastExport: last,
  };
}
