// Buff categorization for the guild Buffs page.
//
// We get each character's CURRENT buff list (name + remaining ticks) from
// character_live_state, synced by the local agent's Zeal feed. To make "who's
// missing what" legible we bucket each buff name into a category (HP, haste,
// damage shield, …). EQ/Quarm spell names are stable enough to keyword-match;
// anything we don't recognize lands in "Other" so nothing is silently dropped.
//
// ⚠️ BEST-EFFORT MAP. Quarm is Classic→Luclin (PoP locked), and Zeal reports the
// raw buff-window name. This list is seeded from era spell knowledge and WILL
// have gaps until tuned against a real raid's buff names — send the "Other"
// column's contents and we fold them in. Categorization is intentionally
// conservative: first matching category wins, in CATEGORY_ORDER priority.

export type BuffCategory =
  | 'hp' | 'regen' | 'mana' | 'manaRegen' | 'haste' | 'attack' | 'ds' | 'resists';

export const CATEGORY_ORDER: BuffCategory[] = [
  'hp', 'regen', 'mana', 'manaRegen', 'haste', 'attack', 'ds', 'resists',
];

export const CATEGORY_LABELS: Record<BuffCategory, string> = {
  hp:        'HP',
  regen:     'HP Regen',
  mana:      'Mana',
  manaRegen: 'Mana Regen',
  haste:     'Haste',
  attack:    'Attack',
  ds:        'Dmg Shield',
  resists:   'Resists',
};

// Keyword lists (lowercased substring match). Order within each list doesn't
// matter; order ACROSS categories is CATEGORY_ORDER (first hit wins), so the
// more specific/important categories should come earlier when a name could
// plausibly match two (e.g. "clarity" → manaRegen, never mana).
const KEYWORDS: Record<BuffCategory, string[]> = {
  // Max-HP / HP+stat group buffs.
  hp: [
    'aegolism', 'symbol of', 'temperance', 'hand of conviction', 'blessing of',
    'brell', 'riotous health', 'inner fire', 'courage', 'daring', 'bravery',
    'valor', 'resolution', 'heroic bond', 'virtue', 'health', 'center', 'fortitude',
  ],
  // HP regeneration over time.
  regen: ['regrowth', 'regenerat', 'chloroplast', 'replenish', 'pack regen'],
  // Max-mana boosts.
  mana: ['brilliance', 'iridescence', 'gift of brilliance'],
  // Mana regeneration (Clarity/KEI family).
  manaRegen: [
    'clarity', 'koadic', 'endless intellect', 'breeze', 'clairvoyance',
    'gift of insight', 'gift of pure thought', 'auspice',
  ],
  // Attack-speed haste.
  haste: [
    'haste', 'celerity', 'quickness', 'swift', 'speed of', 'augmentation',
    'alacrity', 'aanya', 'battle cry', 'warsong', 'verses of victory',
  ],
  // ATK / STR / offense.
  attack: [
    'strength', 'avatar', 'ferocity', 'champion', 'primal', 'war march',
    'savage', 'brutal', 'might of', 'tumultuous', 'aggression', 'bull',
  ],
  // Damage shields.
  ds: ['thorn', 'thistle', 'shield of fire', 'shield of lava', 'bramblecoat', 'damage shield', 'legacy of'],
  // Resist buffs (single + group).
  resists: [
    'resist', 'endure', 'protection of', 'talisman of altuna', 'talisman of jasinth',
    'talisman of shadoo', 'circle of', 'aegis of bathezid', 'colossal', 'elemental',
  ],
};

/** Bucket a buff name → category, or null ("Other") if unrecognized. */
export function categorizeBuff(name: string): BuffCategory | null {
  const n = (name || '').toLowerCase();
  if (!n) return null;
  for (const cat of CATEGORY_ORDER) {
    if (KEYWORDS[cat].some(k => n.includes(k))) return cat;
  }
  return null;
}

// ── Roles + "what good looks like" target profiles ──────────────────────────
// Which categories a character SHOULD have, by role. Seed defaults — tune to
// taste (e.g. officers may want DI/CHA tracked for tanks once we categorize
// those). A category that's expected-but-missing shows red on the grid.
export type Role = 'tank' | 'melee' | 'priest' | 'caster' | 'bard' | 'other';

export const ROLE_LABELS: Record<Role, string> = {
  tank: 'Tank', melee: 'Melee', priest: 'Priest', caster: 'Caster', bard: 'Bard', other: 'Other',
};

export const ROLE_TARGETS: Record<Role, BuffCategory[]> = {
  tank:   ['hp', 'haste', 'attack', 'ds', 'resists'],
  melee:  ['hp', 'haste', 'attack', 'resists'],
  priest: ['hp', 'mana', 'manaRegen', 'resists'],
  caster: ['hp', 'mana', 'manaRegen', 'resists'],
  bard:   ['hp', 'haste', 'resists'],
  other:  ['hp', 'resists'],
};

const CLASS_ROLE: Record<string, Role> = {
  warrior: 'tank', war: 'tank', paladin: 'tank', pal: 'tank',
  'shadow knight': 'tank', shadowknight: 'tank', shd: 'tank', sk: 'tank',
  rogue: 'melee', rog: 'melee', monk: 'melee', mnk: 'melee',
  berserker: 'melee', ber: 'melee', ranger: 'melee', rng: 'melee',
  beastlord: 'melee', bst: 'melee',
  cleric: 'priest', clr: 'priest', druid: 'priest', dru: 'priest',
  shaman: 'priest', shm: 'priest',
  wizard: 'caster', wiz: 'caster', magician: 'caster', mage: 'caster', mag: 'caster',
  necromancer: 'caster', necro: 'caster', nec: 'caster', enchanter: 'caster', enc: 'caster',
  bard: 'bard', brd: 'bard',
};

export function classToRole(className: string | null | undefined): Role {
  if (!className) return 'other';
  return CLASS_ROLE[className.toLowerCase().trim()] || 'other';
}
