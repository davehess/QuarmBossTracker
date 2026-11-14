// Made-up people for the design lab. NONE of these is anybody: the names follow the repo's convention for worked
// examples (CLAUDE.md, "attribution: by ROLE, never by character name") and were checked against the character and
// NPC tables when the convention was set. A draft that needs a raid's worth of names takes them from here, never
// from the database and never from memory of real members.
//
// Boss, zone, spell and item names in a draft are game data and may be real.
export type LabClass =
  | 'Warrior' | 'Cleric' | 'Paladin' | 'Ranger' | 'Shadow Knight' | 'Druid' | 'Monk' | 'Bard' | 'Rogue'
  | 'Shaman' | 'Necromancer' | 'Wizard' | 'Magician' | 'Enchanter' | 'Beastlord';

export type LabPerson = { name: string; cls: LabClass; level: number };

const P = (name: string, cls: LabClass, level = 65): LabPerson => ({ name, cls, level });

/** 42 invented raiders with a believable class spread. Stable order, so a draft's rows do not shuffle between loads. */
export const LAB_RAID: LabPerson[] = [
  P('Aldenmar', 'Warrior'), P('Brackwyn', 'Cleric'), P('Corvale', 'Enchanter'), P('Rethlan', 'Monk'),
  P('Nyssara', 'Druid'), P('Zarrin', 'Wizard'), P('Holdfast', 'Paladin'), P('Maerwyn', 'Shaman'),
  P('Tolvane', 'Rogue'), P('Ysolde', 'Bard'), P('Quillon', 'Magician'), P('Dravik', 'Shadow Knight'),
  P('Elsbeth', 'Cleric'), P('Fenwick', 'Ranger'), P('Garrow', 'Necromancer'), P('Isolwen', 'Beastlord'),
  P('Jorund', 'Warrior'), P('Kestrel', 'Rogue'), P('Lorcan', 'Monk'), P('Merrin', 'Cleric'),
  P('Norvane', 'Wizard'), P('Orlaith', 'Druid'), P('Perrin', 'Bard'), P('Rowanne', 'Enchanter'),
  P('Sigrun', 'Shaman'), P('Thessaly', 'Magician'), P('Ulric', 'Paladin'), P('Vesper', 'Necromancer'),
  P('Wystan', 'Ranger'), P('Xanthe', 'Cleric'), P('Yorick', 'Rogue'), P('Zephyra', 'Wizard'),
  P('Ambrose', 'Monk'), P('Brannoc', 'Warrior'), P('Cendra', 'Druid'), P('Dunmore', 'Shadow Knight'),
  P('Eirlys', 'Shaman'), P('Faolan', 'Beastlord'), P('Gwendra', 'Enchanter'), P('Hollis', 'Bard'),
  P('Ilara', 'Cleric', 62), P('Jessamy', 'Magician', 60),
];

/** A stable pseudo-random number in [0, 1) from a string and a salt: made-up numbers that do not change per render. */
export function labRand(key: string, salt = 0): number {
  let h = 2166136261 ^ salt;
  for (let i = 0; i < key.length; i++) { h ^= key.charCodeAt(i); h = Math.imul(h, 16777619); }
  h ^= h >>> 13; h = Math.imul(h, 0x5bd1e995); h ^= h >>> 15;
  return (h >>> 0) / 4294967296;
}
/** An integer in [lo, hi] for a key. */
export const labInt = (key: string, lo: number, hi: number, salt = 0): number => lo + Math.floor(labRand(key, salt) * (hi - lo + 1));
