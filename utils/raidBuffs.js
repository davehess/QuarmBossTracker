// Raid buff categorization for the /api/agent/raid-buff-queue endpoint.
//
// KEEP IN SYNC with web/lib/buffs.ts — both files categorize the same buff
// names. The web version is canonical (the /raid + /buffs pages use it); this
// JS port serves the Mimic buff-queue overlay so the same "missing buffs / who
// is cursed" view is available locally without each overlay re-fetching the
// full live-state table. Update both together when adding a keyword.

const CATEGORY_ORDER = ['hp', 'regen', 'mana', 'manaRegen', 'haste', 'runSpeed', 'attack', 'ds', 'survival', 'levitate', 'seeInvis', 'invis', 'resists'];
const CATEGORY_LABELS = {
  hp: 'HP', regen: 'HP Regen', mana: 'Mana', manaRegen: 'Mana Regen',
  haste: 'Haste', runSpeed: 'Run Speed', attack: 'Attack', ds: 'Dmg Shield', survival: 'Survival', levitate: 'Levitate',
  seeInvis: 'See Invis', invis: 'Invis',
  resists: 'Resists',
};

const KEYWORDS = {
  // MUST cover everything analyzeHpSlots recognizes (drift = Khura's in
  // 'Other'); potg/potc here so resists' 'protection of' can't steal them.
  // The group Symbol line (Naltron/Marzin/Kazad "Mark") and Focus of the
  // Seventh are listed because the name has no stem the single-target spells
  // share ('symbol of' / 'focus of spirit') — they categorized as null, so a
  // raider carrying one read as missing HP (the guild lead, 2026-10-04: group
  // the buffs on /buffs). Kazad`s Mark carries a backtick in the catalog; the
  // apostrophe spelling is kept as a harmless alias.
  hp: ['aegolism','symbol of','temperance','hand of conviction','blessing of','brell','riotous health','inner fire','courage','daring','bravery','valor','resolution','heroism','heroic bond','virtue','health','center','fortitude','khura','focus of spirit','arch shielding','spiritual purity','talisman of kragg','talisman of tnarg','protection of the glades','protection of the cabbage','talisman of wunshi',
       "marzin's mark","naltron's mark",'kazad`s mark',"kazad's mark",'focus of the seventh'],
  // HoT (long-duration heal-over-time) is its own EQ buff slot — healers
  // want to know if it's open. Elixir family = Celestial/Ethereal/Supernal
  // (cleric + bard song HoTs).
  // HP regeneration over time. Nature's Recovery (lvl 49 druid line) and
  // its rank variants don't share a stem with the other regen spells so we
  // list them explicitly — without this they fall through categorizeBuff
  // and land in the dashboard's "Other" pile (the guild lead, 2026-06-22).
  regen: ['regrowth','regenerat','chloroplast','replenish','pack regen','elixir',
          "nature's recovery", 'natures recovery'],
  mana: ['brilliance','iridescence','gift of brilliance'],
  // 'boon of the clear mind' is the Enchanter's group mana regen (SPA 15) with
  // no shared stem. 'spiritual dominion' is the Beastlord's group mana + HP
  // regen (SPA 15 + SPA 0, the same shape as Spiritual Purity), NOT an attack
  // buff — checked against eqemu_spells 2026-10-04.
  manaRegen: ['clarity','koadic','endless intellect','breeze','clairvoyance','gift of insight','gift of pure thought','auspice','boon of the clear mind','spiritual dominion'],
  // 'vallon's quickening' (Enchanter group haste, SPA 11) shares no stem with
  // 'quickness'. 'speed of the brood' needs no entry — 'speed of' covers it.
  haste: ['haste','celerity','quickness','swift','speed of','augmentation','alacrity','aanya','battle cry','warsong','verses of victory','visions of grandeur','beta vog',"vallon's quickening"],
  // Spirit of Bih`Li carries a backtick in the catalog, so the old 'spirit of
  // bihli' spelling (SECONDARY_CATEGORY, UPGRADE_CHAINS) never matched it.
  // 'flight of eagle' already covers Flight of Eagles; Spirit of Eagle is the
  // single-target sibling (SPA 3).
  runSpeed: ['spirit of wolf','spirit of the wolf','flight of eagle','pack spirit','selo','journeyman','run speed','spirit of the shrew','spirit of bih`li','spirit of eagle'],
  // Spirit of the Predator (Ranger group ATK, SPA 2). Spiritual Vigor is the
  // Beastlord group sibling of Spiritual Strength/Brawn (ATK +40 and max HP
  // +225) — attack is its first effect; its HP half is not mapped to a slot.
  // Talisman of the Brute is SPA 7 (STA), not attack, so it stays unlisted.
  attack: ['strength','avatar','ferocity','champion','primal','war march','savage','brutal','might of','tumultuous','aggression','bull','call of the predator','feral avatar','ancient: feral','spirit of the predator','spiritual vigor'],
  // Damage shields. Mage line: Shield of Flame / Cadeau of Flame /
  // Inferno Shield. Boon of Immolation (Magician L53, group) / Barrier of
  // Combustion.
  // Fiery Might is HP+DS combo (SPA 0 + 59 in catalog). All have SPA 59
  // in eqemu_spells.raw.eff — the catalog-derived layer (next commit) is
  // the real fix; this keyword list is the safety net.
  ds: ['thorn','thistle','shield of fire','shield of lava','bramblecoat',
       'damage shield','legacy of','shield of barbs',
       'cadeau of flame','shield of flame','inferno shield','fiery might',
       'barrier of combustion','boon of immolation',
       // Magician group DS (SPA 59): Aegis of Ro L60, Maelstrom of Ro L63.
       'aegis of ro','maelstrom of ro',
       'aura of vinitras','aura of the defender'],
  // Survival / absorption slots: Divine Aura (cleric self-invuln), Kazumi's
  // Note of Preservation (bard absorption song), Bestowal of Divinity (group
  // DA-flag), Quivering Veil of Xarn (necro lich-save). Each occupies a real
  // buff-window slot — surface them so the healer/bard knows "DA slot open".
  survival: ['divine aura','kazumi','bestowal of divinity','quivering veil','death pact','divine intervention'],
  levitate: ['levitat','dead men floating','dead man floating','flying'],
  // See Invisible and Invisibility — separate categories so the dashboard
  // can show "do I have it" rather than burying these in Other. ORDER
  // MATTERS here: 'invis' substring also appears inside 'invisib' so we
  // place seeInvis first; categorizeBuff returns the first hit and 'see
  // invis' is the more-specific match. We also have an entry for the
  // 'see invisible' clicky-form name and the Ranger/Druid Camouflage line
  // that confers invis (the guild lead, 2026-06-22). 'invis' alone matches both
  // 'invisible' and 'invisibility'.
  seeInvis: ['see invis'],
  invis:    ['invisib', 'camouflage', 'cloak of shadows', 'shauri'],
  resists: ['resist','endure','protection of','talisman of altuna','talisman of jasinth','talisman of shadoo','talisman of epuration','circle of','aegis of bathezid','colossal','elemental'],
};

// Buffs crediting a SECOND category beyond their primary: VoG/Bihli carry
// ATK; POTG/POTC carry mana regen (why a caster with POTG doesn't need the
// cleric's Aego AND shouldn't be flagged missing mana regen).
const SECONDARY_CATEGORY = [
  ['visions of grandeur', 'attack'],
  ['beta vog', 'attack'],   // Quarm PoP-beta VoG — same +ATK rider
  ['spirit of bihli', 'attack'],
  // The catalog spells it "Spirit of Bih`Li" (backtick), so the line above
  // never matched; without this a Bih`Li holder read as missing Attack.
  ['spirit of bih`li', 'attack'],
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
  // Mana (max-mana, Gift of Brilliance line) intentionally dropped: KEI /
  // Clarity already covers the practical "caster has mana to burn" need,
  // so flagging it as a separate gap had Enchanters queueing Mana AND
  // Mana Regen for the same target. Max-mana still categorizes for the
  // detail panel — it just isn't a queue gap anymore.
  priest: ['manaRegen', 'resists'],
  caster: ['manaRegen', 'resists'],
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
  enchanter: ['manaRegen', 'haste', 'resists'],
  // Bard 'attack' dropped: the group ATK comes from the epic Dance of the
  // Blade proc, which fires from normal melee anyhow — queueing it just
  // tells the bard to do what they are already doing. Their haste / mana
  // regen / DS songs are the actionable lines.
  bard:      ['haste', 'runSpeed', 'manaRegen', 'ds'],
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
// Which HP slots a class can FILL — drives the queue's "missing" detection
// so a Cleric isn't nagged about slot C they can't provide. Slot membership
// in HP_SLOT_KEYWORDS still recognizes any slot-C buff as FILLED if a
// Shaman/Wizard cast it; this list is purely "what gaps to surface".
//   Cleric:   A (Aego line), B (Symbol line) — no C in our setup
//   Druid:    A (POTG/POTC)
//   Shaman:   A (Wunshi), C (Khura/Kragg/Tnarg/Inner Fire/Focus of Spirit)
//   Wizard:   C (Arch Shielding)
//   Paladin:  A, B (lower-level Cleric line + Symbol)
//   Magician: none — they provide DS, not HP
const CLASS_HP_SLOTS = {
  cleric:   ['A', 'B'],
  druid:    ['A'],
  shaman:   ['A', 'C'],
  wizard:   ['C'],
  paladin:  ['A', 'B'],
  magician: [],
  enchanter: [],
  necromancer: [],
};
function classHpSlots(c) {
  return CLASS_HP_SLOTS[String(c || '').toLowerCase().trim()] || [];
}
const HP_SLOT_KEYWORDS = {
  // Slot A — Cleric "Type One" HP+AC line (per user spec):
  //   Courage L1 → Center L9 → Daring L19 → Bravery L24 → Valor L34 →
  //   Resolution L44 → Heroism L49 → Heroic Bond L54 → Fortitude L55 →
  //   Aegolism L60 (SINGLE-target, targettype 5; fills A+B via
  //   AEGOLISM_KEYWORDS) → Blessing of Aegolism L60 (group, targettype 41).
  // Plus druid POTG (group, 41) / POTC (single, 5) and shaman Wunshi (not in
  // the eqemu_spells mirror, targettype unchecked) / Temperance (single, 5).
  // Checked against eqemu_spells 2026-10-04: the group/single split matters
  // to the buff-groups view, which only calls a spell "group-castable" when
  // its targettype is 41 or 3.
  A: ['protection of the glades', 'protection of the cabbage', 'talisman of wunshi',
      'temperance', 'courage', 'center', 'daring', 'bravery', 'valor', 'resolution',
      'heroism', 'heroic bond', 'fortitude'],
  // Slot B — Cleric "Symbol of" line: Transal (L14) → Ryltan (L24) →
  // Pinzarn (L34) → Naltron (L44) → Marzin (L54). All match "symbol of".
  // The GROUP versions are named "<Name>'s Mark" (Naltron's Mark L58, Marzin's
  // Mark L60, Kazad`s Mark L63 — backtick in the catalog) and share no stem
  // with it, so they are listed by name.
  B: ['symbol of', "marzin's mark", "naltron's mark", 'kazad`s mark', "kazad's mark"],
  // Slot C — Shaman HP line ascending: Inner Fire (L1) → Talisman of Tnarg
  // (L49) → Talisman of Kragg (L55) → Focus of Spirit (L57) → Khura's
  // Focusing (L60, group) → Focus of the Seventh (L65, group). Everything up
  // to Focus of Spirit is single-target (targettype 5); Khura's Focusing is
  // targettype 41 (group). Plus the Paladin's Brell's line + Wizard Arch
  // Shielding. All same slot; higher overwrites lower.
  C: ['khura', 'focus of spirit', 'talisman of kragg', 'talisman of tnarg', 'inner fire',
      'brell', 'arch shielding', 'spiritual purity', 'focus of the seventh'],
};
// 'virtue' — Virtue is the PoP successor to Aegolism (same Type-One slot) and
// matches Quarm's PoP-beta reward "Beta Virtue" too. Beta buffs OUTRANK the
// era tops (the guild lead, 2026-07-09) — without this, a Beta Virtue holder read as
// HP slots A+B empty and the queue told clerics to land Aego over the
// strictly better buff. Kept in sync with web/lib/buffs.ts.
const AEGOLISM_KEYWORDS = ['aegolism', 'virtue'];
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

// Categories a raider already holds → the buff names filling each, with the
// SECONDARY credits (VoG/Bih`Li → attack, POTG/POTC → mana regen) folded in.
// This is the byCategory build the raid-buff-queue handler used inline; both
// it and missingLines() call it so "missing" can't drift between the queue
// and the group view.
function buffCategoriesPresent(buffNames) {
  const byCategory = {};
  for (const name of (buffNames || [])) {
    if (!name) continue;
    const cat = categorizeBuff(name);
    if (cat) (byCategory[cat] = byCategory[cat] || []).push(name);
    for (const sec of secondaryCategoriesFor(name)) {
      if (sec !== cat && !(byCategory[sec] = byCategory[sec] || []).includes(name)) byCategory[sec].push(name);
    }
  }
  return byCategory;
}

// ── Buff groups (the guild lead, 2026-10-04: "we should be grouping people for
// buffs on /buffs — treat that like the buff queue as well") ─────────────────
// The GROUP version of each buff line, per caster class, best first. A group
// buff lands on the CASTER'S OWN group, so the call-out is "4 of 6 in G3 miss
// Haste — the enchanter in G3 can group-cast it". `lvl` is the class level
// (PQDI, 2026-10-04) and gates which spell a member is named for; an entry
// without one is always eligible. Every id/name/targettype was read back from
// eqemu_spells the same day: targettype 41 (group) except Kazad`s Mark, which
// is 3 (group v1) — the only two group types. Single-target siblings (Aegolism,
// Temperance, POTC, Focus of Spirit, Spirit of Eagle) are deliberately absent.
const GROUP_SPELLS = {
  'hp:A': [
    { cls: 'cleric', spell: 'Hand of Virtue',            id: 3479, lvl: 65 },
    { cls: 'cleric', spell: 'Ancient: Gift of Aegolism', id: 2122, lvl: 60 },
    { cls: 'cleric', spell: 'Blessing of Aegolism',      id: 2510, lvl: 60 },
  ],
  'hp:B': [
    { cls: 'cleric', spell: 'Kazad`s Mark',  id: 3047, lvl: 63 },
    { cls: 'cleric', spell: "Marzin's Mark", id: 2893, lvl: 60 },
    { cls: 'cleric', spell: "Naltron's Mark", id: 1774, lvl: 58 },
  ],
  'hp:C': [
    { cls: 'shaman',  spell: 'Focus of the Seventh',        id: 3397, lvl: 65 },
    { cls: 'shaman',  spell: "Khura's Focusing",            id: 2530, lvl: 60 },
    { cls: 'paladin', spell: "Brell's Mountainous Barrier", id: 2590, lvl: 60 },
  ],
  haste: [
    { cls: 'enchanter', spell: "Vallon's Quickening", id: 3178, lvl: 65 },
    { cls: 'enchanter', spell: 'Speed of the Brood',  id: 2895, lvl: 60 },
  ],
  manaRegen: [
    { cls: 'enchanter', spell: "Koadic's Endless Intellect", id: 2570, lvl: 60 },
    { cls: 'enchanter', spell: 'Gift of Pure Thought',       id: 1695, lvl: 59 },
    { cls: 'enchanter', spell: 'Boon of the Clear Mind',     id: 1694, lvl: 52 },
    { cls: 'beastlord', spell: 'Spiritual Dominion',         id: 3460, lvl: 64 },
  ],
  runSpeed: [
    { cls: 'druid',  spell: 'Flight of Eagles', id: 3185, lvl: 62 },
    { cls: 'druid',  spell: 'Pack Spirit',      id: 169,  lvl: 39 },
    { cls: 'shaman', spell: 'Spirit of Bih`Li', id: 2524, lvl: 39 },
  ],
  attack: [
    { cls: 'ranger',    spell: 'Spirit of the Predator', id: 3417, lvl: 64 },
    { cls: 'ranger',    spell: 'Call of the Predator',   id: 1464, lvl: 60 },
    { cls: 'beastlord', spell: 'Spiritual Vigor',        id: 3456, lvl: 62 },
  ],
  ds: [
    { cls: 'druid',    spell: 'Legacy of Thorn',    id: 1561, lvl: 59 },
    { cls: 'druid',    spell: 'Legacy of Spike',    id: 1727, lvl: 51 },
    { cls: 'magician', spell: 'Maelstrom of Ro',    id: 3486, lvl: 63 },
    { cls: 'magician', spell: 'Aegis of Ro',        id: 1669, lvl: 60 },
    { cls: 'magician', spell: 'Boon of Immolation', id: 1668, lvl: 53 },
  ],
  resists: [
    { cls: 'druid',     spell: 'Circle of Seasons',  id: 2519, lvl: 58 },
    { cls: 'enchanter', spell: 'Group Resist Magic', id: 72,   lvl: 49 },
  ],
};
// Display order of the lines when counts tie.
const GROUP_LINE_KEYS = Object.keys(GROUP_SPELLS);

// 'hp:B' → 'HP B' (the label the buff queue's `missing` uses for an HP slot);
// a category key → its CATEGORY_LABELS entry.
function lineLabel(key) {
  const k = String(key || '');
  if (k.startsWith('hp:')) return 'HP ' + k.slice(3);
  return CATEGORY_LABELS[k] || k;
}

// The buff LINES one raider is missing, as GROUP_SPELLS keys. Same rule as the
// queue: an HP slot is a gap for anyone, every other line only when their role
// expects it (ROLE_TARGETS — a cleric is not missing haste they don't need).
// The queue narrows this to what the BUFFER'S class provides; the group view
// shows every line, so that filter is not applied here.
function missingLines(buffNames, role) {
  const names = (buffNames || []).filter(Boolean);
  const slots = analyzeHpSlots(names);
  const byCat = buffCategoriesPresent(names);
  const expected = ROLE_TARGETS[role] || [];
  const out = [];
  for (const key of GROUP_LINE_KEYS) {
    if (key.startsWith('hp:')) { if (!slots[key.slice(3)]) out.push(key); }
    else if (expected.includes(key) && !(byCat[key] || []).length) out.push(key);
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

// Upgrade chains — surfaced as "Focus line ↑" / "Aego line ↑" hints on a
// queue row when the raider carries a lower link than the buffer's class
// can cast. Each chain ENDS at the realistic raid-cast max (e.g. Aegolism,
// Khura's Focusing); rare quest-spell tops like Blessing of Aegolism or
// Ancient: Gift aren't in the chain so a cleric who landed standard Aego
// isn't nagged. Kept in sync with web/lib/buffs.ts UPGRADE_CHAINS.
const UPGRADE_CHAINS = [
  {
    key: 'aego', label: 'Aego line',
    chain: ['courage','center','daring','bravery','valor','resolution',
            'heroism','heroic bond','fortitude','temperance','aegolism'],
    classes: ['cleric'],
  },
  {
    key: 'symbol', label: 'Symbol line',
    chain: ['symbol of transal','symbol of ryltan','symbol of pinzarn',
            'symbol of naltron','symbol of marzin'],
    classes: ['cleric'],
  },
  {
    key: 'focus', label: 'Focus line',
    chain: ['inner fire','talisman of tnarg','talisman of kragg',
            'focus of spirit','khura'],
    classes: ['shaman'],
  },
  {
    key: 'bihli', label: 'Run speed + ATK',
    chain: ['journeyman','spirit of bihli'],
    classes: ['shaman'],
    roles: ['melee','tank'],
  },
];
// Highest chain link present in a buff list (-1 = none).
function chainPosition(chain, buffNames) {
  let best = -1;
  for (const raw of (buffNames || [])) {
    const n = String(raw || '').toLowerCase();
    if (!n) continue;
    for (let i = chain.length - 1; i >= 0; i--) {
      if (n.includes(chain[i]) && i > best) { best = i; break; }
    }
  }
  return best;
}

module.exports = {
  CATEGORY_ORDER, CATEGORY_LABELS,
  categorizeBuff, secondaryCategoriesFor, classToRole, classProvides, ROLE_TARGETS,
  analyzeHpSlots, HP_SLOTS, classHpSlots, isCurseBuff, isCorpse,
  RESIST_TYPES, RESIST_LABELS, resistTypesFor, isSongBuff,
  UPGRADE_CHAINS, chainPosition,
  GROUP_SPELLS, GROUP_LINE_KEYS, lineLabel, buffCategoriesPresent, missingLines,
};
