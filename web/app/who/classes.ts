// Canonical EQ base classes — the set the agent normalizes /who level-titles
// down to. Kept in its own (non-'use server') module so both the server
// actions and the client table can import it; a 'use server' file may only
// export async functions.
export const BASE_CLASSES = [
  'Warrior', 'Cleric', 'Paladin', 'Ranger', 'Shadow Knight', 'Druid',
  'Monk', 'Bard', 'Rogue', 'Shaman', 'Necromancer', 'Wizard',
  'Magician', 'Enchanter',
] as const;
