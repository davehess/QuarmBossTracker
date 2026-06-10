// Raid buff categorization for the /api/agent/raid-buff-queue endpoint.
//
// KEEP IN SYNC with web/lib/buffs.ts — both files categorize the same buff
// names. The web version is canonical (the /raid + /buffs pages use it); this
// JS port serves the Mimic buff-queue overlay so the same "missing buffs / who
// is cursed" view is available locally without each overlay re-fetching the
// full live-state table. Update both together when adding a keyword.

const CATEGORY_ORDER = ['hp', 'regen', 'mana', 'manaRegen', 'haste', 'runSpeed', 'attack', 'ds', 'levitate', 'resists'];
const CATEGORY_LABELS = {
  hp: 'HP', regen: 'HP Regen', mana: 'Mana', manaRegen: 'Mana Regen',
  haste: 'Haste', runSpeed: 'Run Speed', attack: 'Attack', ds: 'Dmg Shield', levitate: 'Levitate', resists: 'Resists',
};

const KEYWORDS = {
  // MUST cover everything analyzeHpSlots recognizes (drift = Khura's in
  // 'Other'); potg/potc here so resists' 'protection of' can't steal them.
  hp: ['aegolism','symbol of','temperance','hand of conviction','blessing of','brell','riotous health','inner fire','courage','daring','bravery','valor','resolution','heroic bond','virtue','health','center','fortitude','khura','focus of spirit','arch shielding','protection of the glades','protection of the cabbage','talisman of wunshi'],
  regen: ['regrowth','regenerat','chloroplast','replenish','pack regen'],
  mana: ['brilliance','iridescence','gift of brilliance'],
  manaRegen: ['clarity','koadic','endless intellect','breeze','clairvoyance','gift of insight','gift of pure thought','auspice'],
  haste: ['haste','celerity','quickness','swift','speed of','augmentation','alacrity','aanya','battle cry','warsong','verses of victory','visions of grandeur'],
  runSpeed: ['spirit of wolf','spirit of the wolf','flight of eagle','pack spirit','selo','journeyman','run speed','spirit of the shrew'],
  attack: ['strength','avatar','ferocity','champion','primal','war march','savage','brutal','might of','tumultuous','aggression','bull','call of the predator','feral avatar','ancient: feral'],
  ds: ['thorn','thistle','shield of fire','shield of lava','bramblecoat','damage shield','legacy of','shield of barbs'],
  levitate: ['levitat','dead men floating','dead man floating','flying'],
  resists: ['resist','endure','protection of','talisman of altuna','talisman of jasinth','talisman of shadoo','talisman of epuration','circle of','aegis of bathezid','colossal','elemental'],
};

// Buffs crediting a SECOND category beyond their primary: VoG/Bihli carry
// ATK; POTG/POTC carry mana regen (why a caster with POTG doesn't need the
// cleric's group Aego AND shouldn't be flagged missing mana regen).
const SECONDARY_CATEGORY = [
  ['visions of grandeur', 'attack'],
  ['spirit of bihli', 'attack'],
  ['protection of the glades', 'manaRegen'],
  ['protection of the cabbage', 'manaRegen'],
];
function secondaryCategoriesFor(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return [];
  return SECONDARY_CATEGORY.filter(([k]) => n.includes(k)).map(([, c]) => c);
}

function categorizeBuff(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return null;
  for (const cat of CATEGORY_ORDER) {
    for (const k of KEYWORDS[cat]) if (n.includes(k)) return cat;
  }
  return null;
}

const ROLE_TARGETS = {
  tank:   ['haste', 'attack', 'ds', 'resists'],
  melee:  ['haste', 'attack', 'resists'],
  priest: ['mana', 'manaRegen', 'resists'],
  caster: ['mana', 'manaRegen', 'resists'],
  bard:   ['haste', 'resists'],
  other:  ['resists'],
};
const CLASS_ROLE = {
  warrior:'tank',war:'tank',paladin:'tank',pal:'tank','shadow knight':'tank',shadowknight:'tank',shd:'tank',sk:'tank',
  rogue:'melee',rog:'melee',monk:'melee',mnk:'melee',berserker:'melee',ber:'melee',ranger:'melee',rng:'melee',beastlord:'melee',bst:'melee',
  cleric:'priest',clr:'priest',druid:'priest',dru:'priest',shaman:'priest',shm:'priest',
  wizard:'caster',wiz:'caster',magician:'caster',mage:'caster',mag:'caster',
  necromancer:'caster',necro:'caster',nec:'caster',enchanter:'caster',enc:'caster',
  bard:'bard',brd:'bard',
};
function classToRole(c) {
  if (!c) return 'other';
  return CLASS_ROLE[String(c).toLowerCase().trim()] || 'other';
}

// Which categories a class provides as group buffs — used to filter the buff
// queue to "raiders missing buffs THIS class can fix" instead of every gap.
const CLASS_PROVIDES = {
  cleric:    ['hp', 'regen', 'resists'],
  druid:     ['hp', 'regen', 'runSpeed', 'ds', 'resists'],
  shaman:    ['hp', 'attack', 'haste', 'regen', 'resists'],
  enchanter: ['mana', 'manaRegen', 'haste', 'resists'],
  bard:      ['haste', 'runSpeed', 'attack', 'manaRegen', 'ds'],
  paladin:   ['hp', 'resists'],
  ranger:    ['regen', 'ds'],
  beastlord: ['attack', 'regen'],
  magician:  ['ds'],
  wizard:    ['hp'],
};
function classProvides(c) {
  return CLASS_PROVIDES[String(c || '').toLowerCase().trim()] || [];
}

const HP_SLOTS = ['A', 'B', 'C'];
const HP_SLOT_KEYWORDS = {
  A: ['protection of the glades', 'protection of the cabbage', 'talisman of wunshi'],
  B: ['symbol of'],
  C: ['khura', 'brell', 'arch shielding'],
};
const AEGOLISM_KEYWORDS = ['aegolism'];
function analyzeHpSlots(buffNames) {
  const out = { A: null, B: null, C: null };
  for (const raw of (buffNames || [])) {
    const n = String(raw || '').toLowerCase();
    if (!n) continue;
    if (AEGOLISM_KEYWORDS.some(k => n.includes(k))) { out.A = out.A || raw; out.B = out.B || raw; continue; }
    for (const s of HP_SLOTS) if (!out[s] && HP_SLOT_KEYWORDS[s].some(k => n.includes(k))) out[s] = raw;
  }
  return out;
}

// ── Resist schools + songs (synced from web/lib/buffs.ts) ────────────────────
const RESIST_TYPES = ['MR', 'FR', 'CR', 'PR', 'DR'];
const RESIST_LABELS = { MR: 'Magic', FR: 'Fire', CR: 'Cold', PR: 'Poison', DR: 'Disease' };
const RESIST_ALL_KEYWORDS = [
  'aegis of bathezid', 'protection of the cabbage', 'mark of karn',
];
const RESIST_TYPE_KEYWORDS = {
  MR: ['magic', 'guardian rhythms', 'psalm of veeshan', 'group resistance'],
  FR: ['fire', 'flame', 'psalm of cooling', 'inferno', 'circle of seasons'],
  CR: ['cold', 'frost', 'psalm of warmth', 'ice', 'circle of seasons'],
  PR: ['poison', 'psalm of purity', 'talisman of shadoo', 'talisman of jasinth', 'talisman of epuration', 'venom'],
  DR: ['disease', 'psalm of vitality', 'talisman of shadoo', 'talisman of jasinth', 'talisman of epuration', 'plague'],
};
function resistTypesFor(name) {
  const n = String(name || '').toLowerCase();
  if (!n) return [];
  const isResistBuff = KEYWORDS.resists.some(k => n.includes(k))
    || RESIST_ALL_KEYWORDS.some(k => n.includes(k))
    || /psalm of|guardian rhythms/.test(n);
  if (!isResistBuff) return [];
  if (RESIST_ALL_KEYWORDS.some(k => n.includes(k))) return RESIST_TYPES.slice();
  const out = [];
  for (const t of RESIST_TYPES) {
    if (RESIST_TYPE_KEYWORDS[t].some(k => n.includes(k))) out.push(t);
  }
  if (out.length === 0 && /elemental/.test(n)) return ['FR', 'CR'];
  return out;
}

const SONG_NAME_RX = /psalm of|chant|chorus|melody|cantata|aria of|verses of|warsong|battlecry|guardian rhythms|selo|hymn|march of|anthem|jonthan|niv's|niv`s|cassindra|kelin|tuyen|denon|crission|lyssa|mcvaxius|vilia|solon|brusco/i;
function isSongBuff(name, songFlag) {
  if (songFlag === true) return true;
  if (songFlag === false) return false;   // authoritative Zeal song-window tag
  return SONG_NAME_RX.test(String(name || ''));
}

const CURSE_KEYWORDS = ['gravel rain','sand storm','sandstorm','curse of',"innoruuk's curse",'venom of','envenomed','plague','pestilence','splurt','word of'];
function isCurseBuff(name) {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return false;
  return CURSE_KEYWORDS.some(k => n.includes(k));
}

const CORPSE_RX = /'s\s+corpse\d*$/i;
function isCorpse(name) {
  return !!name && CORPSE_RX.test(String(name).trim());
}

module.exports = {
  CATEGORY_ORDER, CATEGORY_LABELS,
  categorizeBuff, secondaryCategoriesFor, classToRole, classProvides, ROLE_TARGETS,
  analyzeHpSlots, HP_SLOTS, isCurseBuff, isCorpse,
  RESIST_TYPES, RESIST_LABELS, resistTypesFor, isSongBuff,
};
