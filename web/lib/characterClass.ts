// Canonical class and race lists for the officer "Set class" control, and the validation the server action runs.
// Classes are the base-class keys of lib/class-titles.ts (Berserker is post-PoP and cannot appear on Quarm);
// races are spelled the way the characters table already stores them (OpenDKP's spelling, e.g. 'Half-Elf').
// Pure, so test/character-class.test.js runs it directly.

export const EQ_CLASSES = [
  'Bard', 'Beastlord', 'Cleric', 'Druid', 'Enchanter', 'Magician', 'Monk', 'Necromancer',
  'Paladin', 'Ranger', 'Rogue', 'Shadow Knight', 'Shaman', 'Warrior', 'Wizard',
] as const;

export const EQ_RACES = [
  'Barbarian', 'Dark Elf', 'Dwarf', 'Erudite', 'Gnome', 'Half-Elf', 'Halfling', 'High Elf',
  'Human', 'Iksar', 'Ogre', 'Troll', 'Vah Shir', 'Wood Elf',
] as const;

export function isUnknownClass(v: string | null | undefined): boolean {
  const s = String(v ?? '').trim().toLowerCase();
  return s === '' || s === 'unknown';
}

function canon(list: readonly string[], raw: unknown): string | null {
  const key = String(raw ?? '').trim().toLowerCase();
  return list.find(x => x.toLowerCase() === key) ?? null;
}

/** Validate the officer's pick. An empty race means "leave the race as it is" (race: null). */
export function validateClassRace(rawClass: unknown, rawRace: unknown):
  { ok: true; cls: string; race: string | null } | { ok: false; error: string } {
  const cls = canon(EQ_CLASSES, rawClass);
  if (!cls) return { ok: false, error: 'pick one of the listed classes' };
  if (String(rawRace ?? '').trim() === '') return { ok: true, cls, race: null };
  const race = canon(EQ_RACES, rawRace);
  if (!race) return { ok: false, error: 'pick one of the listed races' };
  return { ok: true, cls, race };
}

/** The most common real class in a list of /who sightings, with its count; null when there is none. */
export function topSighting(classes: Array<string | null | undefined>): { cls: string; count: number } | null {
  const tally = new Map<string, number>();
  for (const c of classes) {
    if (isUnknownClass(c)) continue;
    const k = canon(EQ_CLASSES, c);
    if (k) tally.set(k, (tally.get(k) ?? 0) + 1);
  }
  let best: { cls: string; count: number } | null = null;
  for (const [cls, count] of tally) if (!best || count > best.count) best = { cls, count };
  return best;
}
