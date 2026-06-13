// web/lib/class-titles.ts — EQ level title ↔ base class (web side).
//
// EverQuest grants a class a new LEVEL TITLE at 51 / 55 / 60 / 65 — a level-60
// Beastlord is a "Savage Lord", a level-65 Warrior an "Overlord". We store the
// BASE class (folded by the agent + bot), but a character page can show the
// flavorful title the player actually wore: "Savage Lord (Beastlord)". The
// title is a deterministic function of (base class, level), so we compute it
// rather than persist it. Mirror of utils/classTitles.js (bot) and the agent's
// CLASS_TITLES — keep the three in sync.
//
// Berserker is post-PoP (Gates of Discord) and cannot appear on Quarm.
const BY_CLASS: Record<string, [string, string, string, string]> = {
  // base class      [51,              55,            60,            65]
  Warrior:         ['Champion', 'Myrmidon', 'Warlord', 'Overlord'],
  Cleric:          ['Vicar', 'Templar', 'High Priest', 'Archon'],
  Paladin:         ['Cavalier', 'Knight', 'Crusader', 'Lord Protector'],
  Ranger:          ['Pathfinder', 'Outrider', 'Warder', 'Forest Stalker'],
  'Shadow Knight': ['Reaver', 'Revenant', 'Grave Lord', 'Dread Lord'],
  Druid:           ['Wanderer', 'Preserver', 'Hierophant', 'Storm Warden'],
  Monk:            ['Disciple', 'Master', 'Grandmaster', 'Transcendent'],
  Bard:            ['Minstrel', 'Troubadour', 'Virtuoso', 'Maestro'],
  Rogue:           ['Rake', 'Blackguard', 'Assassin', 'Deceiver'],
  Shaman:          ['Mystic', 'Luminary', 'Oracle', 'Prophet'],
  Necromancer:     ['Heretic', 'Defiler', 'Warlock', 'Arch Lich'],
  Wizard:          ['Channeler', 'Evoker', 'Sorcerer', 'Arcanist'],
  Magician:        ['Elementalist', 'Conjurer', 'Arch Mage', 'Arch Convoker'],
  Enchanter:       ['Illusionist', 'Beguiler', 'Phantasmist', 'Coercer'],
  Beastlord:       ['Primalist', 'Animist', 'Savage Lord', 'Feral Lord'],
};

// title (any tier) or base name, lowercased → canonical base class.
const TITLE_TO_CLASS: Record<string, string> = (() => {
  const m: Record<string, string> = {};
  for (const [base, titles] of Object.entries(BY_CLASS)) {
    m[base.toLowerCase()] = base;
    for (const t of titles) m[t.toLowerCase()] = base;
  }
  m['shadowknight'] = 'Shadow Knight';
  return m;
})();

/** Fold a class string (base name OR level title) to its base class. */
export function normalizeClass(raw: string | null | undefined): string | null {
  if (!raw) return raw ?? null;
  const key = String(raw).trim().toLowerCase();
  return TITLE_TO_CLASS[key] || String(raw).trim();
}

/**
 * The /who level title for a class at a given level (EQ tiers 51/55/60/65).
 * Returns null below 51 or when class/level is unknown — i.e. "no special
 * title, just show the base class". Accepts a base name or a title for `cls`.
 */
export function titleForClass(cls: string | null | undefined, level: number | null | undefined): string | null {
  const base = normalizeClass(cls);
  if (!base || level == null) return null;
  const titles = BY_CLASS[base];
  if (!titles) return null;
  if (level >= 65) return titles[3];
  if (level >= 60) return titles[2];
  if (level >= 55) return titles[1];
  if (level >= 51) return titles[0];
  return null;
}

/**
 * Display string for a character's class: the worn level title with the base
 * class in parentheses — "Savage Lord (Beastlord)" — falling back to just the
 * base class when there's no title (sub-51 or unknown level). Returns null when
 * there's no class at all.
 */
export function classDisplay(cls: string | null | undefined, level: number | null | undefined): string | null {
  const base = normalizeClass(cls);
  if (!base) return null;
  const title = titleForClass(base, level);
  return title && title !== base ? `${title} (${base})` : base;
}
