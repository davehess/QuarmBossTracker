// utils/classTitles.js — EQ level-title → base class normalization (bot side).
//
// EverQuest's /who shows the LEVEL TITLE for a character's class, not the base
// class: a level-60 Beastlord reads "Savage Lord", a level-65 Warrior reads
// "Overlord", a level-55 Enchanter reads "Beguiler". Those raw titles leak into
// who_observations, parse "Top Classes" cards, /whois, the threat list, etc.
// unless we fold them back to the base class. This is the bot-side mirror of the
// agent's CLASS_TITLES (packages/wolfpack-logsync/index.js) — keep them in sync.
//
// Coverage: every tier a Project Quarm character can reach — 51 / 55 / 60
// (Kunark) and 65 (Planes of Power). Berserker is post-PoP (Gates of Discord)
// and cannot appear on Quarm, so it is intentionally omitted. The base name
// (sub-51) and any unrecognized string pass through unchanged.
const BY_CLASS = {                            // [51, 55, 60, 65]
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

const TITLE_TO_CLASS = (() => {
  const map = new Map();
  for (const [base, titles] of Object.entries(BY_CLASS)) {
    map.set(base.toLowerCase(), base);                 // base name → itself
    for (const t of titles) map.set(t.toLowerCase(), base);
  }
  map.set('shadowknight', 'Shadow Knight');            // common spelling variant
  return map;
})();

// Fold a /who class string (base name OR level title) to its base class.
// Returns the input unchanged when null/empty or unrecognized — never throws,
// never invents a class. Idempotent (normalize(normalize(x)) === normalize(x)).
function normalizeClass(raw) {
  if (!raw) return raw;
  const key = String(raw).trim().toLowerCase();
  return TITLE_TO_CLASS.get(key) || String(raw).trim();
}

module.exports = { normalizeClass, BY_CLASS, TITLE_TO_CLASS };
