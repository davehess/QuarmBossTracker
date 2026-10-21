// Buff groups — the pure half of /buffs ?v=b (one card per raid group) and ?v=c (one section per buff
// line). No React, no Supabase: rows in, a plain structure out, so the rules run under vitest.
//
// The guild lead, 2026-10-04: "we should be grouping people for buffs on /buffs — treat that like the
// buff queue as well". The reason it matters is one EverQuest fact: in this era (Classic through PoP,
// no Target Group Buff) a GROUP buff lands on the CASTER'S OWN group. So the useful sentence is not
// "the raid is short on Haste" but "4 of 6 in group 3 are short on Haste, and the enchanter IN group 3
// can group-cast it" — or, when nobody capable is in that group, "no enchanter in this group:
// single-target, or move someone". A caster in another group never covers it, so we never say so.
// (Quarm's own Target-Group-Buff behaviour is unverified; the wording is right either way.)
//
// "Missing" is the grid's own rule, not a new one: a line is missing when the character's role expects
// it (ROLE_TARGETS) and nothing in their buff list categorizes into it, or — for the three HP slots,
// which every role wants — when analyzeHpSlots left the slot empty. A raider who is in the raid but not
// running the agent is UNKNOWN, never missing (the page's caveat banner says the same).

import {
  CATEGORY_LABELS, ROLE_TARGETS,
  type BuffCategory, type HpSlot, type HpSlotState, type Role,
} from './buffs';
import { groupRaids, type RaidRosterRow } from './raidGroups';

export type LineKey =
  | 'hp:A' | 'hp:B' | 'hp:C'
  | 'haste' | 'manaRegen' | 'runSpeed' | 'attack' | 'ds' | 'resists';

// The order lines are listed in when two have the same number missing (and the tie-break everywhere).
export const LINE_ORDER: LineKey[] = [
  'hp:A', 'hp:B', 'hp:C', 'haste', 'manaRegen', 'runSpeed', 'attack', 'ds', 'resists',
];

export const LINE_LABELS: Record<LineKey, string> = {
  'hp:A': 'HP A (Aego)',
  'hp:B': 'HP B (Symbol)',
  'hp:C': 'HP C (Khura)',
  haste: CATEGORY_LABELS.haste,
  manaRegen: CATEGORY_LABELS.manaRegen,
  runSpeed: CATEGORY_LABELS.runSpeed,
  attack: CATEGORY_LABELS.attack,
  ds: CATEGORY_LABELS.ds,
  resists: CATEGORY_LABELS.resists,
};

// The GROUP version of each line, per caster class — best first, with the level each needs, so a call-out
// names the best spell the caster's level allows (unknown level → the best). Every id/name/targettype
// was read back from eqemu_spells on 2026-10-04 (targettype 41 = group, 3 = the older group type;
// Kazad`s Mark is the only 3). Group and single versions share a landing line but have different buff
// names, which is why this table is keyed by NAME. KEEP IN SYNC with GROUP_SPELLS in utils/raidBuffs.js
// (test/buff-groups-web.test.js compares the two).
export type GroupSpell = { cls: string; spell: string; id: number; lvl: number };
export const GROUP_SPELLS: Record<LineKey, GroupSpell[]> = {
  'hp:A': [
    { cls: 'cleric', spell: 'Hand of Virtue',            id: 3479, lvl: 65 },
    { cls: 'cleric', spell: 'Ancient: Gift of Aegolism', id: 2122, lvl: 60 },
    { cls: 'cleric', spell: 'Blessing of Aegolism',      id: 2510, lvl: 60 },
  ],
  'hp:B': [
    { cls: 'cleric', spell: 'Kazad`s Mark',   id: 3047, lvl: 63 },
    { cls: 'cleric', spell: "Marzin's Mark",  id: 2893, lvl: 60 },
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

// A line needs a call-out once two or more members of ONE group are missing it: one straggler is just a
// single-target cast, two is a group cast worth a sentence.
export const CALLOUT_MIN = 2;

// Same threshold the grid dims a row at (BuffsGrid STALE_MS): their buff list is older than this.
export const STALE_SYNC_MS = 30 * 60 * 1000;

// Zeal's raid has twelve groups. The value for "not in a group" is unverified (raid_roster is empty
// off-raid), so null, 0, negatives and anything past twelve all read as ungrouped.
export const MAX_RAID_GROUP = 12;
export function normalizeGroup(g: number | null | undefined): number | null {
  return typeof g === 'number' && Number.isInteger(g) && g >= 1 && g <= MAX_RAID_GROUP ? g : null;
}

const CLASS_ALIAS: Record<string, string> = {
  clr: 'cleric', cle: 'cleric', dru: 'druid', shm: 'shaman', enc: 'enchanter',
  mag: 'magician', mage: 'magician', rng: 'ranger', pal: 'paladin',
};
/** Lower-case full class name — "ENC" and "Enchanter" are the same caster. */
export function canonClass(c: string | null | undefined): string {
  const s = String(c || '').toLowerCase().trim();
  return CLASS_ALIAS[s] ?? s;
}
const capWord = (s: string): string => (s ? s[0].toUpperCase() + s.slice(1) : s);

// ── Freshest roster row per member ───────────────────────────────────────────
// raid_roster holds one row per UPLOADER per member, so a name usually has several rows and the old
// "last row wins" kept whichever the database happened to return last — often a stale one. The
// freshest captured_at wins (the bot does the same). A row with no timestamp loses to any that has one.
const ts = (iso: string | null | undefined): number => {
  const t = Date.parse(iso || '');
  return Number.isFinite(t) ? t : -Infinity;
};
export function freshestByName<R extends { name: string; captured_at?: string | null }>(
  rows: R[],
): Map<string, R> {
  const out = new Map<string, R>();
  for (const r of rows || []) {
    if (!r || !r.name) continue;
    const k = r.name.toLowerCase();
    const prev = out.get(k);
    if (!prev || ts(r.captured_at) >= ts(prev.captured_at)) out.set(k, r);
  }
  return out;
}

// ── Which raid is which ──────────────────────────────────────────────────────
// Two raids at once both have a "group 1", so everything is split by raid first. This is /raid's own
// split (web/lib/raidGroups.ts, labelled by leader the way /raid labels its tabs); a row no live raid
// claims stays with the raid its uploader is in, exactly as /raid does.
export type RaidLabel = { key: string; label: string };
export function splitRaids(rosterRows: RaidRosterRow[], now?: number) {
  const split = groupRaids(rosterRows, now == null ? {} : { now });
  const raids: RaidLabel[] = split.multi
    ? split.raids.map((r, i) => ({ key: r.key, label: 'Raid ' + (i + 1) + ' — ' + r.leader + ' (' + r.size + ')' }))
    : [];
  /** The raid key for a member, or null when only one raid runs (or nothing claims them). */
  const keyFor = (name: string, uploaderId?: string | null): string | null =>
    split.multi
      ? (split.raidForName(String(name || '').toLowerCase()) ?? split.raidForUploader(uploaderId))?.key ?? null
      : null;
  return { multi: split.multi, raids, keyFor };
}

// ── Grouping ─────────────────────────────────────────────────────────────────
export type GroupInput = {
  name: string;
  className: string | null;
  role: Role;
  group: number | null;              // raw group_num — normalized here
  raidKey?: string | null;           // from splitRaids().keyFor; null/undefined when one raid runs
  noAgent?: boolean;                 // in the raid, not running the agent → buffs unknown
  stale?: boolean;                   // buff list older than STALE_SYNC_MS
  level?: number | null;             // from raid_roster; picks the best group spell this caster can cast
  byCategory: Record<string, string[]>;
  hpSlots: HpSlotState;
};

export type GroupMember = {
  name: string;
  className: string;
  role: Role;
  missing: LineKey[];
  noAgent: boolean;
  stale: boolean;
};

export type GroupCaster = { name: string; cls: string; spell: string };

export type LineGap = {
  key: LineKey;
  label: string;
  missing: string[];                 // names IN THIS GROUP missing the line
  expected: number;                  // members of this group who want it and report buffs (the "of N")
  casters: GroupCaster[];            // members OF THIS GROUP who can group-cast it (empty = none)
  casterClasses: string[];           // who could, for the no-caster note ("Enchanter")
};

export type GroupCard = {
  group: number | null;              // null = ungrouped
  members: GroupMember[];
  lines: LineGap[];                  // only lines with at least one member missing, most missing first
  unknown: number;                   // members whose buffs we cannot see
};

export type RaidSection = {
  key: string | null;
  label: string | null;              // null when only one raid runs
  size: number;
  groups: GroupCard[];               // by group number, ungrouped last
};

/** Lines this member is missing, by the grid's role-expected rule. */
export function missingLinesFor(m: Pick<GroupInput, 'role' | 'noAgent' | 'byCategory' | 'hpSlots'>): LineKey[] {
  if (m.noAgent) return [];
  const out: LineKey[] = [];
  for (const key of LINE_ORDER) if (lineIsExpected(m.role, key) && lineIsEmpty(m, key)) out.push(key);
  return out;
}

function lineIsExpected(role: Role, key: LineKey): boolean {
  if (key.startsWith('hp:')) return true;   // every role wants all three HP slots
  return (ROLE_TARGETS[role] || []).includes(key as BuffCategory);
}
function lineIsEmpty(m: Pick<GroupInput, 'byCategory' | 'hpSlots'>, key: LineKey): boolean {
  if (key.startsWith('hp:')) return !m.hpSlots[key.slice(3) as HpSlot];
  return !(m.byCategory?.[key]?.length);
}

/** The classes (display case) that could group-cast a line. */
export function casterClassesFor(key: LineKey): string[] {
  return [...new Set(GROUP_SPELLS[key].map(s => s.cls))].map(capWord);
}

/** Members of THIS group who can group-cast the line — never anyone from another group. */
function castersIn(members: GroupInput[], key: LineKey): GroupCaster[] {
  const out: GroupCaster[] = [];
  for (const m of members) {
    const cls = canonClass(m.className);
    const lvl = typeof m.level === 'number' && m.level > 0 ? m.level : Infinity;   // unknown level → the best
    const spell = GROUP_SPELLS[key].find(s => s.cls === cls && s.lvl <= lvl);
    if (spell) out.push({ name: m.name, cls: capWord(cls), spell: spell.spell });
  }
  return out;
}

const byNameAsc = (a: string, b: string) => a.localeCompare(b);

function buildCard(group: number | null, inputs: GroupInput[]): GroupCard {
  const members: GroupMember[] = inputs.map(m => ({
    name: m.name,
    className: m.className || 'Unknown',
    role: m.role,
    missing: missingLinesFor(m),
    noAgent: !!m.noAgent,
    stale: !!m.stale,
  }));
  members.sort((a, b) => b.missing.length - a.missing.length || byNameAsc(a.name, b.name));

  const lines: LineGap[] = [];
  for (const key of LINE_ORDER) {
    const missing = members.filter(m => m.missing.includes(key)).map(m => m.name).sort(byNameAsc);
    if (!missing.length) continue;
    const expected = inputs.filter(m => !m.noAgent && lineIsExpected(m.role, key)).length;
    lines.push({
      key,
      label: LINE_LABELS[key],
      missing,
      expected,
      // An ungrouped raider is alone: a group buff cast on them reaches nobody else, and nobody ungrouped
      // shares a group with them — so "ungrouped" has no casters by construction.
      casters: group === null ? [] : castersIn(inputs, key),
      casterClasses: casterClassesFor(key),
    });
  }
  lines.sort((a, b) => b.missing.length - a.missing.length || LINE_ORDER.indexOf(a.key) - LINE_ORDER.indexOf(b.key));

  return { group, members, lines, unknown: members.filter(m => m.noAgent).length };
}

function buildSection(key: string | null, label: string | null, inputs: GroupInput[]): RaidSection {
  const byGroup = new Map<number | null, GroupInput[]>();
  for (const m of inputs) {
    const g = normalizeGroup(m.group);
    const arr = byGroup.get(g);
    if (arr) arr.push(m); else byGroup.set(g, [m]);
  }
  const groups = [...byGroup.entries()]
    .sort(([a], [b]) => (a === null ? 1 : 0) - (b === null ? 1 : 0) || (a ?? 0) - (b ?? 0))
    .map(([g, ms]) => buildCard(g, ms));
  return { key, label, size: inputs.length, groups };
}

export const UNPLACED_LABEL = 'Not placed in a live raid';

/**
 * Raid members → one section per raid → one card per group (ungrouped last).
 * `raids` is splitRaids().raids — empty when one raid runs, in which case everyone is one unlabelled
 * section. With several raids, a member no raid claims goes in a trailing "not placed" section rather
 * than into somebody's raid.
 */
export function buildBuffGroups(members: GroupInput[], raids: RaidLabel[] = []): RaidSection[] {
  if (!raids.length) return members.length ? [buildSection(null, null, members)] : [];
  const out: RaidSection[] = [];
  const claimed = new Set<GroupInput>();
  for (const r of raids) {
    const mine = members.filter(m => m.raidKey === r.key);
    mine.forEach(m => claimed.add(m));
    if (mine.length) out.push(buildSection(r.key, r.label, mine));
  }
  const rest = members.filter(m => !claimed.has(m));
  if (rest.length) out.push(buildSection(null, UNPLACED_LABEL, rest));
  return out;
}

/** The lines a group card calls out: two or more members of THIS group missing it. An ungrouped
 *  card has none — those raiders are not a group, so there is nothing to group-cast. */
export function calloutLines(card: GroupCard): LineGap[] {
  return card.group === null ? [] : card.lines.filter(l => l.missing.length >= CALLOUT_MIN);
}

// ── Display helpers (kept here so the wording is under test) ─────────────────
/** "no enchanter in this group — single-target, or move someone" */
export function noCasterText(classes: string[]): string {
  const who = classes.map(c => c.toLowerCase());
  const list = who.length > 1 ? who.slice(0, -1).join(', ') + ' or ' + who[who.length - 1] : who[0] || 'caster';
  return 'no ' + list + ' in this group — single-target, or move someone';
}

/** Casters folded by class + spell: [{ names: ['Corvale', 'Zarrin'], cls: 'Enchanter', spell: "Vallon's Quickening" }] */
export function casterGroups(casters: GroupCaster[]): { names: string[]; cls: string; spell: string }[] {
  const out: { names: string[]; cls: string; spell: string }[] = [];
  for (const c of casters) {
    const hit = out.find(o => o.cls === c.cls && o.spell === c.spell);
    if (hit) hit.names.push(c.name); else out.push({ names: [c.name], cls: c.cls, spell: c.spell });
  }
  return out;
}

// ── ?v=c: the same data, turned around — one section per buff line ───────────
export type LineRow = Pick<LineGap, 'missing' | 'expected' | 'casters' | 'casterClasses'> & { group: number };
export type Straggler = { name: string; group: number | null };
export type LineSection = {
  key: LineKey;
  label: string;
  total: number;                     // missing across the whole raid
  rows: LineRow[];                   // groups with CALLOUT_MIN+ missing, by group number
  stragglers: Straggler[];           // everyone else missing it (alone in their group, or ungrouped)
};

// A line no role expects can never be "missing" by the grid's rule (Run Speed today), so saying it is
// covered would be a claim nobody measured. It is reported apart as untracked.
export function lineIsTracked(key: LineKey): boolean {
  return key.startsWith('hp:') || (Object.values(ROLE_TARGETS) as BuffCategory[][]).some(t => t.includes(key as BuffCategory));
}

export function buildLineView(section: RaidSection): { lines: LineSection[]; covered: LineKey[]; untracked: LineKey[] } {
  const lines: LineSection[] = [];
  const covered: LineKey[] = [];
  const untracked: LineKey[] = [];
  for (const key of LINE_ORDER) {
    const rows: LineRow[] = [];
    const stragglers: Straggler[] = [];
    let total = 0;
    for (const card of section.groups) {
      const gap = card.lines.find(l => l.key === key);
      if (!gap) continue;
      total += gap.missing.length;
      if (card.group !== null && gap.missing.length >= CALLOUT_MIN) {
        rows.push({ group: card.group, missing: gap.missing, expected: gap.expected, casters: gap.casters, casterClasses: gap.casterClasses });
      } else {
        for (const name of gap.missing) stragglers.push({ name, group: card.group });
      }
    }
    if (!total) { (lineIsTracked(key) ? covered : untracked).push(key); continue; }
    lines.push({ key, label: LINE_LABELS[key], total, rows, stragglers });
  }
  lines.sort((a, b) => b.total - a.total || LINE_ORDER.indexOf(a.key) - LINE_ORDER.indexOf(b.key));
  return { lines, covered, untracked };
}
