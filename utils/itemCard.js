// utils/itemCard.js — a compact item card for the Mimic overlays (FB-73: hovering a dropped item on
// Target Info's Loot tab). One eqemu_items row in, display text out: { id, name, flags, lines }.
// The overlay only paints strings, so the decoding lives here and not in a page.
//
// The bit tables are EQ's own and match web/lib/itemDecode.ts (the website's item card); they are
// duplicated rather than shared because the website is TypeScript in another deploy.
//
// Two eqemu_items columns do not mean what they are named (see web/lib/itemDecode.ts):
//   nodrop  — INVERTED on this mirror: false = NO DROP
//   lore    — a LORE item has a leading "*" on the lore text; lore_flag is false on every row
'use strict';

// The columns a card reads, for the route's select.
const ITEM_CARD_COLUMNS = 'id,name,lore,nodrop,magic,slots,classes,races,required_level,recommended_level,'
  + 'ac,hp,mana,damage,delay,str,sta,dex,agi,intel,wis,cha,mr,cr,dr,fr,pr,attack,haste,regen,manaregen,'
  + 'damageshield,weight,price,clickeffect,clicklevel,casttime,proc_effect,focus_effect,worneffect';

const CLASS_TAGS = [
  [1, 'WAR'], [2, 'CLR'], [4, 'PAL'], [8, 'RNG'], [16, 'SHD'], [32, 'DRU'], [64, 'MNK'], [128, 'BRD'],
  [256, 'ROG'], [512, 'SHM'], [1024, 'NEC'], [2048, 'WIZ'], [4096, 'MAG'], [8192, 'ENC'], [16384, 'BST'],
];
const RACE_TAGS = [
  [1, 'HUM'], [2, 'BAR'], [4, 'ERU'], [8, 'ELF'], [16, 'HIE'], [32, 'DEF'], [64, 'HEL'], [128, 'DWF'],
  [256, 'TRL'], [512, 'OGR'], [1024, 'HFL'], [2048, 'GNM'], [4096, 'IKS'], [8192, 'VAH'], [16384, 'FRG'],
];
const ALL_CLASS = 32767;
const ALL_RACE = 32767;
const CLASSIC_RACE = ALL_RACE & ~16384;       // Froglok is not on every "all races" item

// EQ's paired slots (both ears, wrists, fingers) have a bit each; the labels collapse at display time.
const SLOT_TAGS = [
  [1, 'CHARM'], [2, 'EAR'], [4, 'HEAD'], [8, 'FACE'], [16, 'EAR'], [32, 'NECK'], [64, 'SHOULDERS'],
  [128, 'ARMS'], [256, 'BACK'], [512, 'WRIST'], [1024, 'WRIST'], [2048, 'RANGE'], [4096, 'HANDS'],
  [8192, 'PRIMARY'], [16384, 'SECONDARY'], [32768, 'FINGER'], [65536, 'FINGER'], [131072, 'CHEST'],
  [262144, 'LEGS'], [524288, 'FEET'], [1048576, 'WAIST'], [2097152, 'AMMO'],
];

const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const signed = (n) => (n > 0 ? '+' + n : String(n));

function decodeMask(mask, tags, all, classic) {
  const m = num(mask);
  if (!m) return '';
  if ((m & all) === all || (classic && (m & classic) === classic)) return 'ALL';
  return tags.filter(([b]) => (m & b) > 0).map(([, t]) => t).join(' ');
}

function decodeSlots(slots) {
  const m = num(slots);
  if (!m) return '';
  const hits = [];
  for (const [b, t] of SLOT_TAGS) {
    if (Math.floor(m / b) % 2 === 1 && !hits.includes(t)) hits.push(t);   // m can pass 2^31: no bitwise
  }
  return hits.join(' ');
}

// EQ price is in copper.
function fmtPrice(cp) {
  const c = num(cp);
  if (c <= 0) return '';
  const pp = Math.floor(c / 1000);
  if (pp >= 1) return pp.toLocaleString('en-US') + ' pp';
  const gp = Math.floor(c / 100);
  return gp >= 1 ? gp + ' gp' : c + ' cp';
}

// Weight is stored in tenths of a stone.
const fmtWeight = (w) => (num(w) / 10).toFixed(1).replace(/\.0$/, '');

// `spellNames`: Map or plain object of spell id -> name (the route reads them for the effect ids).
function spellName(spellNames, id) {
  const n = spellNames && (typeof spellNames.get === 'function' ? spellNames.get(id) : spellNames[id]);
  return n || 'spell #' + id;
}

// The spell ids a card will name, so the route can read just those.
function itemCardSpellIds(row) {
  const ids = [];
  for (const k of ['clickeffect', 'proc_effect', 'focus_effect', 'worneffect']) {
    const id = num(row && row[k]);
    if (id > 0 && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

function buildItemCard(row, spellNames) {
  if (!row || !row.id || !row.name) return null;
  const flags = [];
  if (row.magic) flags.push('MAGIC ITEM');
  if (typeof row.lore === 'string' && row.lore.startsWith('*')) flags.push('LORE ITEM');
  if (row.nodrop === false) flags.push('NO DROP');       // inverted column: false = NO DROP
  const lines = [];

  const slot = decodeSlots(row.slots);
  if (slot) lines.push('Slot: ' + slot);

  const wep = [];
  if (num(row.damage)) wep.push('DMG: ' + num(row.damage));
  if (num(row.delay)) wep.push('Delay: ' + num(row.delay));
  if (wep.length) lines.push(wep.join('   '));

  const core = [];
  if (num(row.ac)) core.push('AC: ' + num(row.ac));
  if (num(row.hp)) core.push('HP: ' + signed(num(row.hp)));
  if (num(row.mana)) core.push('Mana: ' + signed(num(row.mana)));
  if (core.length) lines.push(core.join('   '));

  const stats = [['STR', 'str'], ['STA', 'sta'], ['AGI', 'agi'], ['DEX', 'dex'], ['WIS', 'wis'], ['INT', 'intel'], ['CHA', 'cha']]
    .filter(([, k]) => num(row[k])).map(([l, k]) => l + ' ' + signed(num(row[k])));
  if (stats.length) lines.push(stats.join('  '));

  const res = [['MR', 'mr'], ['CR', 'cr'], ['DR', 'dr'], ['FR', 'fr'], ['PR', 'pr']]
    .filter(([, k]) => num(row[k])).map(([l, k]) => l + ' ' + signed(num(row[k])));
  if (res.length) lines.push(res.join('  '));

  const extra = [];
  if (num(row.attack)) extra.push('Atk ' + signed(num(row.attack)));
  if (num(row.haste)) extra.push('Haste ' + signed(num(row.haste)) + '%');
  if (num(row.regen)) extra.push('HP Regen ' + signed(num(row.regen)));
  if (num(row.manaregen)) extra.push('Mana Regen ' + signed(num(row.manaregen)));
  if (num(row.damageshield)) extra.push('DS ' + signed(num(row.damageshield)));
  if (extra.length) lines.push(extra.join('  '));

  const cls = decodeMask(row.classes, CLASS_TAGS, ALL_CLASS);
  if (cls) lines.push('Class: ' + cls);
  const race = decodeMask(row.races, RACE_TAGS, ALL_RACE, CLASSIC_RACE);
  if (race) lines.push('Race: ' + race);
  if (num(row.required_level)) lines.push('Required level: ' + num(row.required_level));
  if (num(row.recommended_level)) lines.push('Recommended level: ' + num(row.recommended_level));

  const click = num(row.clickeffect);
  if (click > 0) {
    const cast = num(row.casttime);
    lines.push('Click: ' + spellName(spellNames, click)
      + (num(row.clicklevel) ? ' (level ' + num(row.clicklevel) + ')' : '')
      + (cast > 0 ? ' · cast ' + (cast / 1000).toFixed(1).replace(/\.0$/, '') + 's' : ''));
  }
  if (num(row.proc_effect) > 0) lines.push('Proc: ' + spellName(spellNames, num(row.proc_effect)));
  if (num(row.focus_effect) > 0) lines.push('Focus: ' + spellName(spellNames, num(row.focus_effect)));
  if (num(row.worneffect) > 0) lines.push('Worn: ' + spellName(spellNames, num(row.worneffect)));

  const wv = [];
  if (num(row.weight)) wv.push('WT: ' + fmtWeight(row.weight));
  const price = fmtPrice(row.price);
  if (price) wv.push('Value: ' + price);
  if (wv.length) lines.push(wv.join('   '));

  return { id: num(row.id), name: String(row.name), flags: flags.join(' · '), lines };
}

module.exports = { ITEM_CARD_COLUMNS, buildItemCard, itemCardSpellIds, decodeSlots, decodeMask, CLASS_TAGS, RACE_TAGS };
