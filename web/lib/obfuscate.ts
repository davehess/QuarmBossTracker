// Demo / obfuscation mode. When enabled (cookie set), every character name
// the site would render gets swapped for a class-appropriate fictional
// character — Legolas for a Ranger, Gandalf for a Wizard, Bruce Lee for a
// Monk, etc. Used for screenshots, recruiting posts, and demos when
// exposing real character names would be inappropriate.
//
// Deterministic: same (guild + real name) always maps to the same fake
// name within a guild, so cross-page references stay consistent and
// repeated screenshots tell the same story. The guild salt comes from an
// env var so officers can rotate it if a mapping gets de-anonymized.
//
// Cookie name: `demo_mode`. Value `1` = enabled, anything else (or absent)
// = off. Set by web/components/DemoToggle.tsx via a server action.

import { cookies } from 'next/headers';

const SALT = process.env.DEMO_OBFUSCATE_SALT || 'wolfpack';

// Class → ordered pool of fictional character names. Pools deliberately
// thematic so an obfuscated screenshot still reads as the right archetype
// (Monks all look like martial artists, Wizards all look like spellcasters,
// etc.) — preserves the visual story of the data.
//
// Sizes vary; bigger pools = fewer collisions inside a class. Aim for
// ~roster-per-class × 2 minimum.
const NAMES: Record<string, string[]> = {
  'Bard': [
    'Pied Piper', 'Orpheus', 'Hendrix', 'Mozart', 'Beethoven', 'Lemmy',
    'Bowie', 'Prince', 'Sinatra', 'Bard the Bowman', 'Elton John',
    'McCartney', 'Dolly Parton', 'Springsteen', 'Aragorn the Minstrel',
    'Lindsey Stirling',
  ],
  'Beastlord': [
    'Tarzan', 'Mowgli', 'Kratos', 'Aquaman', 'Wolverine', 'Beastmaster',
    'Geralt', 'Conan the Wild', 'Drogo', 'Hagrid', 'Eragon', 'Daenerys',
  ],
  'Cleric': [
    'Mother Teresa', 'Joan of Arc', 'Galadriel', 'Friar Tuck',
    'Father Brown', 'Brother Cadfael', 'Pope Gregory', 'Saint Christopher',
    'Father Karras', 'Sister Mary Eunice', 'Saint Francis',
    'Brother Marcus', 'High Septon', 'Cardinal Richelieu',
    'Bishop Brennan',
  ],
  'Druid': [
    'Radagast', 'Treebeard', 'Druid Cathbad', 'Morrigan', 'Mother Nature',
    'Old Man Willow', 'Yavanna', 'Tom Bombadil', 'Pan', 'Cernunnos',
    'Witch Hazel', 'Green Man',
  ],
  'Enchanter': [
    'Merlin', 'Loki', 'Mesmer', 'Mystique', 'Sirius Black',
    'Doctor Strange', 'Hypnos', 'Saruman', 'Trickster Coyote',
    'Anansi', 'Q', 'Jadis',
  ],
  'Magician': [
    'Houdini', 'Copperfield', 'Mandrake', 'Penn Jillette', 'Mickey Apprentice',
    'Newt Scamander', 'Sabrina Spellman', 'Zatanna', 'Hermione',
    'Doctor Fate', 'Mickey the Sorcerer', 'Strange Disciple',
  ],
  'Monk': [
    'Bruce Lee', 'Jackie Chan', 'Ip Man', 'Master Splinter', 'Kung Fu Panda',
    'Liu Kang', 'Iron Fist', 'Shifu', 'Kenshin', 'Toph', 'Donatello',
    'Mister Miyagi', 'Daredevil', 'Mr. Han', 'Goku',
  ],
  'Necromancer': [
    'Morgana', 'Voldemort', 'Sauron', 'Dr. Frankenstein', 'Nicodemus',
    "Kel'Thuzad", 'Death Eater', 'Nazgul', 'Ringwraith', 'The Lich King',
    'Skeletor', 'Bellatrix', 'Mordred',
  ],
  'Paladin': [
    'Sir Galahad', 'King Arthur', 'Captain America', 'Sir Lancelot',
    'Sir Gawain', 'Roland', 'Don Quixote', 'Sir Percival', 'Sir Bedivere',
    'Wonder Woman', 'Sir Cedric', 'Joan d\'Arc',
  ],
  'Ranger': [
    'Legolas', 'Aragorn', 'Robin Hood', 'Katniss', 'Hawkeye', 'Green Arrow',
    'Drizzt', 'Princess Mononoke', 'Faramir', 'Tauriel', 'Strider',
    'Halt', 'Will Treaty', 'Sylvanas',
  ],
  'Rogue': [
    'Han Solo', 'Catwoman', 'Locke Lamora', 'Ezio', 'Garrett',
    'Bilbo', 'Sly Cooper', 'Carmen Sandiego', 'Selina Kyle', 'Vesper',
    'Black Widow', 'Arsene Lupin', 'Loki Jr.', 'Artful Dodger',
  ],
  'Shadow Knight': [
    'Darth Vader', 'Anakin', 'Death Knight', 'Witch King', 'Doctor Doom',
    'Lord Soth', 'Arthas', 'Sephiroth', 'Sauron Jr.', 'Magneto',
    'Kylo Ren', 'Sith Lord',
  ],
  'Shaman': [
    'Avatar Aang', 'Thrall', 'Witch Doctor', 'Medicine Man',
    'Chief Two Eagles', 'Old Bear', 'Pocahontas', 'Tonto', 'Storm',
    'Mama Odie', 'Iroh', 'Shaman King',
  ],
  'Warrior': [
    'Conan', 'Hercules', 'Spartacus', 'Brienne', 'Thor', 'Achilles',
    'Boromir', 'Gimli', 'Lagertha', 'Beowulf', 'Eowyn', 'Hektor',
    'Goliath', 'Leonidas', 'William Wallace',
  ],
  'Wizard': [
    'Gandalf', 'Dumbledore', 'Rincewind', 'Doctor Strange', 'Tim the Enchanter',
    'Yen Sid', 'Saruman', 'Elminster', 'Khelben', 'Pug', 'Raistlin',
    'Howl', 'Belgarath',
  ],
};

const FALLBACK_POOL = [
  'Adventurer', 'Hero', 'Mercenary', 'Outlander', 'Drifter',
  'Wayfarer', 'Stranger', 'Sellsword', 'Rover', 'Vagabond',
];

function fnv1a(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export type DemoMode = 'off' | 'on';

// Read the cookie. Safe to call from any Server Component / Server Action.
export function getDemoMode(): DemoMode {
  try {
    return cookies().get('demo_mode')?.value === '1' ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

// Map a real character name + class to a fictional one. Deterministic per
// (salt, real-name) so the same character always shows the same fake name.
//
// Falls back to "Adventurer N" when the class is unknown or pool is empty.
export function fakeNameFor(realName: string, className: string | null | undefined): string {
  const key = `${SALT}|${(realName || '').toLowerCase()}`;
  const pool = (className && NAMES[className]) || FALLBACK_POOL;
  const idx = fnv1a(key) % pool.length;
  return pool[idx];
}

// Helper: apply obfuscation conditionally. Mode 'off' returns the original
// name unchanged. Use this at every render site so toggling is one-line.
export function maybeFake(mode: DemoMode, realName: string, className: string | null | undefined): string {
  if (mode === 'off') return realName;
  return fakeNameFor(realName, className);
}
