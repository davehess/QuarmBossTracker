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
  | 'hp' | 'regen' | 'mana' | 'manaRegen' | 'haste' | 'runSpeed' | 'attack' | 'ds' | 'levitate' | 'resists';

export const CATEGORY_ORDER: BuffCategory[] = [
  'hp', 'regen', 'mana', 'manaRegen', 'haste', 'runSpeed', 'attack', 'ds', 'levitate', 'resists',
];

export const CATEGORY_LABELS: Record<BuffCategory, string> = {
  hp:        'HP',
  regen:     'HP Regen',
  mana:      'Mana',
  manaRegen: 'Mana Regen',
  haste:     'Haste',
  runSpeed:  'Run Speed',
  attack:    'Attack',
  ds:        'Dmg Shield',
  levitate:  'Levitate',
  resists:   'Resists',
};

// Keyword lists (lowercased substring match). Order within each list doesn't
// matter; order ACROSS categories is CATEGORY_ORDER (first hit wins), so the
// more specific/important categories should come earlier when a name could
// plausibly match two (e.g. "clarity" → manaRegen, never mana).
const KEYWORDS: Record<BuffCategory, string[]> = {
  // Max-HP / HP+stat group buffs. MUST cover everything analyzeHpSlots
  // recognizes — Khura's filled slot C while leaking into "Other" because
  // the two keyword lists drifted. POTG/POTC live here (hp wins first in
  // CATEGORY_ORDER) so the resists list's 'protection of' can't steal them.
  hp: [
    'aegolism', 'symbol of', 'temperance', 'hand of conviction', 'blessing of',
    'brell', 'riotous health', 'inner fire', 'courage', 'daring', 'bravery',
    'valor', 'resolution', 'heroic bond', 'virtue', 'health', 'center', 'fortitude',
    'khura', 'focus of spirit', 'arch shielding',
    'protection of the glades', 'protection of the cabbage', 'talisman of wunshi',
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
  // Attack-speed haste. ("Speed of the Shissar"/"Swift like the Wind" are
  // haste — they don't collide with SoW, which matches "spirit of wolf".)
  // Visions of Grandeur is the Velious-era enchanter group buff whose slot
  // 1 is +58% attack speed; users were seeing it land in "Other" because
  // none of the older patterns hit. Listed by full name rather than just
  // "visions" so we don't accidentally grab unrelated visions-of-X buffs.
  haste: [
    'haste', 'celerity', 'quickness', 'swift', 'speed of', 'augmentation',
    'alacrity', 'aanya', 'battle cry', 'warsong', 'verses of victory',
    'visions of grandeur',
  ],
  // Movement / run speed (SoW family + bard travel songs).
  runSpeed: [
    'spirit of wolf', 'spirit of the wolf', 'flight of eagle', 'pack spirit',
    'selo', 'journeyman', 'run speed', 'spirit of the shrew',
  ],
  // ATK / STR / offense (incl. the Beastlord/Druid avatar + warder lines).
  attack: [
    'strength', 'avatar', 'ferocity', 'champion', 'primal', 'war march',
    'savage', 'brutal', 'might of', 'tumultuous', 'aggression', 'bull',
    'call of the predator', 'feral avatar', 'ancient: feral',
  ],
  // Damage shields (buffs + bard DS songs).
  ds: ['thorn', 'thistle', 'shield of fire', 'shield of lava', 'bramblecoat', 'damage shield', 'legacy of', 'shield of barbs'],
  // Levitation — situational but worth a visible row (Hate trenches, Sky).
  levitate: ['levitat', 'dead men floating', 'dead man floating', 'flying'],
  // Resist buffs (single + group). "Circle of Seasons" is the Druid all-resist
  // group buff seen in raid dumps.
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

// Buffs that credit a SECOND category beyond their primary match. VoG is
// primarily haste but carries an ATK component; Spirit of Bihli is run speed
// with ATK. Single-category-wins kept them out of the Attack row, which made
// "Attack — missing" lie on raiders carrying them.
const SECONDARY_CATEGORY: [string, BuffCategory][] = [
  ['visions of grandeur', 'attack'],
  ['spirit of bihli',     'attack'],
  // POTG/POTC carry a mana-regen component — the reason casters take the
  // druid line over group Aego in HP slot A.
  ['protection of the glades',  'manaRegen'],
  ['protection of the cabbage', 'manaRegen'],
];
export function secondaryCategoriesFor(name: string): BuffCategory[] {
  const n = (name || '').toLowerCase();
  if (!n) return [];
  return SECONDARY_CATEGORY.filter(([k]) => n.includes(k)).map(([, c]) => c);
}

// ── Haste ranking ────────────────────────────────────────────────────────────
// EQ won't let a LOWER-tier haste land over a higher one — and some item/click
// hastes are higher % than VoG, so suggesting VoG to those raiders is wrong
// (they'd have to click the better buff off first!). Relative ordering only —
// DRAFT, tune against in-era percentages; unknown haste names rank 0 so the
// queue annotates instead of asserting.
const HASTE_RANK: [string, number][] = [
  ['quickness', 1],
  ['alacrity', 2],
  ['celerity', 3],
  ['augmentation', 3],
  ['swift like the wind', 4],
  ['aanya', 5],
  ['wonderous rapidity', 6],
  ['visions of grandeur', 7],
  ['speed of the shissar', 8],
];
export function hasteRank(name: string | null | undefined): number {
  const n = String(name || '').toLowerCase();
  if (!n) return 0;
  for (const [k, r] of HASTE_RANK) if (n.includes(k)) return r;
  return 0;   // unknown haste (item clicks, songs) — can't compare safely
}

// ── Upgrade chains ───────────────────────────────────────────────────────────
// Same buff line, low → high. When a raider carries an earlier link and the
// buffer's class can cast a later one, the queue shows a YELLOW upgrade item
// instead of silence (the category was "covered", just not by the best
// available — Aego when the cleric has Ancient: Gift of Aegolism, FoS when
// the shaman has Khura's, JBoots when Bihli adds ATK for melee).
export type UpgradeChain = {
  key: string;
  label: string;
  chain: string[];                 // lowercased substrings, low → high
  classes: string[];               // who can cast the top end
  roles?: Role[];                  // limit to these roles (default: all)
};
export const UPGRADE_CHAINS: UpgradeChain[] = [
  {
    key: 'aego',
    label: 'Aego line',
    chain: ['aegolism', 'blessing of aegolism', 'ancient: gift of aegolism'],
    classes: ['cleric'],
  },
  {
    key: 'focus',
    label: 'Focus line',
    chain: ['focus of spirit', 'khura'],
    classes: ['shaman'],
  },
  {
    key: 'bihli',
    label: 'Run speed + ATK',
    chain: ['journeyman', 'spirit of bihli'],
    classes: ['shaman'],
    roles: ['melee', 'tank'],
  },
];

// Index of the HIGHEST chain link a buff list carries (-1 = none). The chain
// arrays put more-specific names later, so we scan from the top down.
export function chainPosition(chain: string[], buffNames: string[]): number {
  let best = -1;
  for (const raw of buffNames) {
    const n = (raw || '').toLowerCase();
    for (let i = chain.length - 1; i >= 0; i--) {
      if (n.includes(chain[i]) && i > best) { best = i; break; }
    }
  }
  return best;
}

// ── Resist types ─────────────────────────────────────────────────────────────
// The single "resists" category hid which of the FIVE schools a raider is
// actually covered for — "Circle of Seasons" satisfied the bucket while a
// missing Group Resist Magic stayed invisible. Per-buff school mapping so the
// raid card can render MR/FR/CR/PR/DR rows and the buffer queue can flag the
// specific school a buffer's class provides.
export type ResistType = 'MR' | 'FR' | 'CR' | 'PR' | 'DR';
export const RESIST_TYPES: ResistType[] = ['MR', 'FR', 'CR', 'PR', 'DR'];
export const RESIST_LABELS: Record<ResistType, string> = {
  MR: 'Magic', FR: 'Fire', CR: 'Cold', PR: 'Poison', DR: 'Disease',
};

// All-school buffs first (substring match); then per-school keyword lists.
// Bard psalms: Warmth = cold (a warming song), Cooling = fire, Purity =
// poison, Vitality = disease, Guardian Rhythms = magic+all-ish (kept MR).
const RESIST_ALL_KEYWORDS = [
  'circle of seasons', 'aegis of bathezid', 'talisman of jasinth',
  'protection of the cabbage', 'mark of karn',
];
const RESIST_TYPE_KEYWORDS: Record<ResistType, string[]> = {
  MR: ['magic', 'guardian rhythms', 'psalm of veeshan', 'group resistance'],
  FR: ['fire', 'flame', 'psalm of cooling', 'inferno'],
  CR: ['cold', 'frost', 'psalm of warmth', 'ice'],
  PR: ['poison', 'psalm of purity', 'talisman of shadoo', 'venom'],
  DR: ['disease', 'psalm of vitality', 'talisman of shadoo', 'plague'],
};

/** Which resist schools a buff covers — empty when it isn't a resist buff. */
export function resistTypesFor(name: string): ResistType[] {
  const n = (name || '').toLowerCase();
  if (!n) return [];
  // Only consider names the resists category already recognizes, plus the
  // explicit all-school list — keeps "Fire Fist" (worn) etc. from matching
  // the FR keyword.
  const isResistBuff = KEYWORDS.resists.some(k => n.includes(k))
    || RESIST_ALL_KEYWORDS.some(k => n.includes(k))
    || /psalm of|guardian rhythms/.test(n);
  if (!isResistBuff) return [];
  if (RESIST_ALL_KEYWORDS.some(k => n.includes(k))) return [...RESIST_TYPES];
  const out: ResistType[] = [];
  for (const t of RESIST_TYPES) {
    if (RESIST_TYPE_KEYWORDS[t].some(k => n.includes(k))) out.push(t);
  }
  // Recognized resist buff with no school keyword (e.g. "Elemental Shield")
  // → conservative: fire + cold (the elemental pair).
  if (out.length === 0 && /elemental/.test(n)) return ['FR', 'CR'];
  return out;
}

// ── Bard songs ───────────────────────────────────────────────────────────────
// Agent v3.1.12+ tags buffs from Zeal's 6-slot song window with song:true.
// For older data we fall back to a name heuristic so the songs section isn't
// empty for raiders on yesterday's Mimic.
const SONG_NAME_RX = /psalm of|chant|chorus|melody|cantata|aria of|verses of|warsong|battlecry|guardian rhythms|selo|hymn|march of|anthem|jonthan|niv's|niv`s|cassindra|kelin|tuyen|denon|crission|lyssa|mcvaxius|vilia|solon|brusco/i;
export function isSongBuff(name: string | null | undefined, songFlag?: boolean | null): boolean {
  if (songFlag === true) return true;
  if (songFlag === false) return false;   // authoritative tag says buff window
  return SONG_NAME_RX.test(String(name || ''));
}

// ── Roles + "what good looks like" target profiles ──────────────────────────
// Which categories a character SHOULD have, by role. Seed defaults — tune to
// taste (e.g. officers may want DI/CHA tracked for tanks once we categorize
// those). A category that's expected-but-missing shows red on the grid.
export type Role = 'tank' | 'melee' | 'priest' | 'caster' | 'bard' | 'other';

export const ROLE_LABELS: Record<Role, string> = {
  tank: 'Tank', melee: 'Melee', priest: 'Priest', caster: 'Caster', bard: 'Bard', other: 'Other',
};

// HP is tracked separately via the three HP slots (every role wants all three),
// so it's not repeated here. These are the NON-HP categories expected per role.
export const ROLE_TARGETS: Record<Role, BuffCategory[]> = {
  tank:   ['haste', 'attack', 'ds', 'resists'],
  melee:  ['haste', 'attack', 'resists'],
  priest: ['mana', 'manaRegen', 'resists'],
  caster: ['mana', 'manaRegen', 'resists'],
  bard:   ['haste', 'resists'],
  other:  ['resists'],
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

// ── Curse detection ──────────────────────────────────────────────────────────
// Curses are debuffs that need a Remove (Greater) Curse cure. They land in the
// same buff window we already track via Zeal Type 1, so a Mimic-running raider
// who's afflicted shows the curse name in their buffs[] alongside their regular
// buffs. The /raid Cursed tab filters across the raid roster to show "who's
// cursed and with what" so the cure caster can see at a glance.
//
// Substring match, case-insensitive. Curated rather than wildcard so we don't
// flag SoW ("Spirit of Wolf") as a curse just because it has "of" in it.
// Send unrecognized curse names — the OFF column on /raid Cursed surfaces
// anything that's an "Other"-style debuff we don't yet pattern-match, and the
// list gets folded in.
const CURSE_KEYWORDS: string[] = [
  'gravel rain',          // Vyzh`dra (and other Bloodfields-line bosses)
  'sand storm', 'sandstorm',
  'curse of',             // Curse of Misery, Curse of the Garou, etc.
  "innoruuk's curse",     // Hate / planar
  'venom of',             // Venom of the Snake (necro DoT curse)
  'envenomed',
  'plague',               // Plague of <X>
  'pestilence',
  'splurt',                // Necro DoT that's typically cured as a curse
  'word of',              // Word of Pain / Word of Souls (cleric curses applied by mobs)
];

/** Is this buff name a curse-style debuff (needs Remove Curse to clear)? */
export function isCurseBuff(name: string | null | undefined): boolean {
  const n = String(name || '').toLowerCase().trim();
  if (!n) return false;
  for (const k of CURSE_KEYWORDS) {
    if (n.includes(k)) return true;
  }
  return false;
}

// EQ corpses register as their own "character" named "<Owner>'s corpse<id>"
// (e.g. "Hitya's corpse2854"). They leak into character_live_state / raid_roster
// but are NOT raiders, so the raid + buff views must filter them out.
const CORPSE_RX = /'s\s+corpse\d*$/i;
export function isCorpse(name: string | null | undefined): boolean {
  return !!name && CORPSE_RX.test(name.trim());
}

// ── HP buff slots ────────────────────────────────────────────────────────────
// EQ HP buffs stack in three slots; the grid shows whether each is filled so a
// buffer sees exactly which HP buff a raider is missing.
//   A — "POTG / Aegolism" slot: Druid Protection of the Glades / of the Cabbage
//       (these carry mana regen, preferred for casters/priests), Cleric Blessing
//       of / Ancient: Gift of Aegolism, Shaman Talisman of Wunshi.
//   B — Symbol slot: Cleric Symbol of Marzin / Naltron / Ryltan / Pinzarn / Transal.
//   C — secondary HP: Cleric Khura's Focusing, Brell's Mountainous Barrier,
//       Wizard Arch Shielding.
// AEGOLISM is special — Blessing of / Ancient: Gift of Aegolism fill BOTH A and B.
export type HpSlot = 'A' | 'B' | 'C';

export const HP_SLOT_LABELS: Record<HpSlot, string> = {
  A: 'HP · POTG/Aego',
  B: 'HP · Symbol',
  C: 'HP · Khura/Brell',
};
export const HP_SLOT_PROVIDER: Record<HpSlot, string> = {
  A: 'Druid (POTG/POTC) · Cleric (Aego) · Shaman (ToW)',
  B: 'Cleric (Symbol)',
  C: 'Shaman (Khura/FoS) · Cleric (Brell) · Wizard (Arch)',
};

const HP_SLOT_KEYWORDS: Record<HpSlot, string[]> = {
  A: ['protection of the glades', 'protection of the cabbage', 'talisman of wunshi'],
  B: ['symbol of'],
  C: ['khura', 'focus of spirit', 'brell', 'arch shielding'],
};
const AEGOLISM_KEYWORDS = ['aegolism'];

export type HpSlotState = { A: string | null; B: string | null; C: string | null };

/** Which of the three HP slots a character's buff list fills (and with what). */
export function analyzeHpSlots(buffNames: string[]): HpSlotState {
  const out: HpSlotState = { A: null, B: null, C: null };
  for (const raw of buffNames) {
    const n = (raw || '').toLowerCase();
    if (!n) continue;
    if (AEGOLISM_KEYWORDS.some(k => n.includes(k))) {   // fills A + B at once
      out.A = out.A || raw;
      out.B = out.B || raw;
      continue;
    }
    (['A', 'B', 'C'] as HpSlot[]).forEach(slot => {
      if (!out[slot] && HP_SLOT_KEYWORDS[slot].some(k => n.includes(k))) out[slot] = raw;
    });
  }
  return out;
}

// Every raid role wants all three HP slots filled. (Casters/priests ideally via
// POTG for the mana regen; melee/hybrids via Aegolism — but a filled slot is a
// filled slot, and the provider hint covers the nuance.)
export const HP_SLOTS: HpSlot[] = ['A', 'B', 'C'];

// ── Short display names ──────────────────────────────────────────────────────
// The buff-window names EQ reports are long ("Protection of the Glades") and
// blow out the grid columns. Raiders know them by their guild shorthand, so we
// render that instead and keep the full name on hover. First match wins; add
// rows as new buffs show up in the wild.
function capWord(s: string): string {
  return s ? s[0].toUpperCase() + s.slice(1).toLowerCase() : s;
}

const SHORT_BUFF_RULES: [RegExp, string][] = [
  // HP — POTG / Aego / Talisman slot
  [/protection of the glades/i, 'POTG'],
  [/protection of the cabbage/i, 'POTC'],
  [/aegolism/i, 'Aego'],
  [/talisman of wunshi/i, 'ToW'],
  // HP — Khura / Brell / Arch slot
  [/khura'?s? focusing/i, 'Khuras'],
  [/brell'?s? (?:mountainous barrier|steadfast bulwark|blessing)/i, 'Brell'],
  [/arch shielding/i, 'Arch'],
  // Mana regen
  [/koadic'?s endless intellect/i, 'KEI'],
  [/clarity ii/i, 'C2'],
  [/visions of grandeur/i, 'VoG'],
  [/gift of pure thought/i, 'GoPT'],
  // Run speed
  [/spirit of (?:the )?wolf/i, 'SOW'],
  [/flight of eagles?/i, 'FoE'],
  // Attack / STR / focus
  [/spirit of bihli/i, 'Bihli'],
  [/focus(?:ing)? of spirit/i, 'FoS'],
  // Haste
  [/speed of the shissar/i, 'Shissar'],
];

/** Guild-shorthand display name for a buff (POTG, KEI, SOW, …); full name if unknown. */
export function shortBuffName(name: string | null | undefined): string {
  const raw = (name || '').trim();
  if (!raw) return raw;
  // Symbol of <Deity> → "Sym <Deity>" (keeps which symbol, drops the prefix).
  const sym = raw.match(/symbol of (?:the )?(\w+)/i);
  if (sym) return 'Sym ' + capWord(sym[1]);
  for (const [rx, short] of SHORT_BUFF_RULES) if (rx.test(raw)) return short;
  return raw;
}

// ── Buff remaining time (from Zeal ticks) ────────────────────────────────────
// character_live_state.buffs carries each buff's remaining `ticks` (1 EQ tick =
// 6 s) as of the row's updated_at. We elapsed-adjust from that timestamp so the
// page shows a live-ish estimate, and tone it so a buffer can see who needs a
// top-off at a glance.
const SECS_PER_TICK = 6;
// Illusions / some clickies report a huge tick count → treat as permanent and
// show no countdown rather than a meaningless "9h59m".
const PERMANENT_TICKS = 6000; // ~10 h

export function buffRemainingSecs(
  ticks: number | null | undefined,
  updatedAtMs?: number | null,
): number | null {
  if (ticks == null || !Number.isFinite(ticks)) return null;
  if (ticks <= 0) return null;                 // expired / unknown
  if (ticks >= PERMANENT_TICKS) return null;   // permanent → no countdown
  let secs = ticks * SECS_PER_TICK;
  if (updatedAtMs != null && Number.isFinite(updatedAtMs)) {
    const elapsed = (Date.now() - updatedAtMs) / 1000;
    if (elapsed > 0) secs -= elapsed;
  }
  return secs > 0 ? secs : 0;
}

/** "1h12m" / "8m" / "45s" — or "?" when Zeal didn't report a duration. Empty
 *  string for permanent buffs (illusions / clickies). The two non-empty cases
 *  are visually distinguished by buffTimeTone → "unknown" gets its own tone. */
export function fmtBuffRemaining(
  ticks: number | null | undefined,
  updatedAtMs?: number | null,
): string {
  // Unknown — Zeal couldn't capture a tick count for this buff. Surface a "?"
  // so the chip still tells the buffer something is up rather than going blank
  // (blank reads as "all good, no countdown" — which is wrong here).
  if (ticks == null || !Number.isFinite(ticks) || ticks <= 0) return '?';
  // Permanent → no countdown chip at all; the name alone is the signal.
  if (ticks >= PERMANENT_TICKS) return '';
  const secs = buffRemainingSecs(ticks, updatedAtMs);
  if (secs == null) return '';
  const s = Math.round(secs);
  if (s >= 3600) {
    const h = Math.floor(s / 3600);
    const m = Math.round((s % 3600) / 60);
    return m ? `${h}h${m}m` : `${h}h`;
  }
  if (s >= 60) return `${Math.floor(s / 60)}m`;
  return `${s}s`;
}

export type BuffTimeTone = 'crit' | 'low' | 'ok' | 'none' | 'unknown';

/** crit ≤2m (refresh now) · low ≤6m (getting short) · ok · unknown (Zeal had
 *  no duration; the "?" chip uses this) · none (permanent, no chip). */
export function buffTimeTone(
  ticks: number | null | undefined,
  updatedAtMs?: number | null,
): BuffTimeTone {
  if (ticks == null || !Number.isFinite(ticks) || ticks <= 0) return 'unknown';
  if (ticks >= PERMANENT_TICKS) return 'none';
  const secs = buffRemainingSecs(ticks, updatedAtMs);
  if (secs == null) return 'none';
  if (secs <= 120) return 'crit';
  if (secs <= 360) return 'low';
  return 'ok';
}
