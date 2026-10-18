// The Flag lab's pure model (/admin/flag-lab): fake members for the PoP flag matrix and the fake window the
// hail board preview is built from. No IO, no database, no clock: every name below is an invented token, and
// nothing here is ever saved.
//
// The flag half mirrors how web/app/pop/page.tsx merges a character's flags, so the matrix the lab draws is
// the matrix /pop would draw for the same inputs: Mimic's recorded flag first, then /who's sighting, then
// loot, and the owner's own tick LAST, so any proof outranks a tick (the guild lead, 2026-10-03). The gate
// rules themselves are not here: the lab calls gateState / proofFor (popGateCell.ts) and zoneAccess /
// missingFor (popFlags.ts) exactly as /pop does.

import { HAIL_BOSSES, HAIL_FLAGGERS, stayMs, type HailData, type HailFlagRow, type HailWindow, type HailCfg } from './hailBoardView';

export type LabSource = 'mimic' | 'who' | 'loot' | 'self';
export const LAB_SOURCES: { key: LabSource; label: string; letter: string }[] = [
  { key: 'mimic', label: 'Mimic recorded flag', letter: 'M' },
  { key: 'who',   label: '/who sighting',       letter: 'W' },
  { key: 'loot',  label: 'Loot',                letter: 'L' },
  { key: 'self',  label: 'Self-tick',           letter: 'T' },
];

export const LAB_CLASSES = [
  'Bard', 'Beastlord', 'Berserker', 'Cleric', 'Druid', 'Enchanter', 'Magician', 'Monk',
  'Necromancer', 'Paladin', 'Ranger', 'Rogue', 'Shadow Knight', 'Shaman', 'Warrior', 'Wizard',
];

export type LabMember = {
  id: string;
  name: string;
  cls: string;
  level: number;
  /** flag key → every source that says this character holds it. */
  flags: Record<string, LabSource[]>;
};

// What /pop calls a CharFlags, reduced to what the gate rules read. seen / looted hold only the flags that
// source alone proves (a flag Mimic holds is never in seen, a flag /who holds is never in looted), and self
// holds only the flags nothing else proves.
export type LabFlagState = {
  flags: Set<string>;
  seen: Map<string, true>;
  looted: Map<string, true>;
  self: Set<string>;
};

export function deriveFlags(m: Pick<LabMember, 'flags'>): LabFlagState {
  const out: LabFlagState = { flags: new Set(), seen: new Map(), looted: new Map(), self: new Set() };
  const has = (f: string, s: LabSource) => (m.flags[f] ?? []).includes(s);
  const keys = Object.keys(m.flags).filter(f => (m.flags[f] ?? []).length > 0);
  for (const f of keys) if (has(f, 'mimic')) out.flags.add(f);
  for (const f of keys) if (has(f, 'who') && !out.flags.has(f)) { out.flags.add(f); out.seen.set(f, true); }
  for (const f of keys) if (has(f, 'loot') && !out.flags.has(f)) { out.flags.add(f); out.looted.set(f, true); }
  for (const f of keys) if (has(f, 'self') && !out.flags.has(f)) { out.flags.add(f); out.self.add(f); }
  return out;
}

/** Add `source` to a flag's sources, or take it away when it is already there. Returns a new record. */
export function toggleSource(
  flags: Record<string, LabSource[]>, flag: string, source: LabSource,
): Record<string, LabSource[]> {
  const cur = flags[flag] ?? [];
  const next = cur.includes(source) ? cur.filter(s => s !== source) : [...cur, source];
  const out = { ...flags };
  if (next.length) out[flag] = next; else delete out[flag];
  return out;
}

const all = (keys: string[], ...sources: LabSource[]): Record<string, LabSource[]> =>
  Object.fromEntries(keys.map(k => [k, [...sources]]));

export type LabPreset = { id: string; label: string; blurb: string; flags: Record<string, LabSource[]> };
export const LAB_PRESETS: LabPreset[] = [
  { id: 'none', label: 'No flags', blurb: 'Tier one only.', flags: {} },
  { id: 'torment', label: 'Fully flagged to Torment',
    blurb: 'Grummus, the Carprin key, Bertoxxulous, the hedge event and Terris Thule, then both Tranquility thank-yous.',
    flags: all(['grummus_dead', 'carprin_cycle', 'bert_dead', 'fuirstel_5', 'hedge_event', 'tthule_dead', 'thelin_4'], 'mimic') },
  { id: 'justice', label: 'Justice + Mavuin only',
    blurb: 'The Justice flag alone: opens Valor and Storms, nothing else.', flags: all(['trial_justice'], 'mimic') },
  { id: 'ticks', label: 'Ticked only (their word)',
    blurb: 'Two flags on the owner\'s say-so: gold ☑ in every gate that needs them.', flags: all(['trial_justice', 'grummus_dead'], 'self') },
  { id: 'outrank', label: 'Tick + proof (proof wins)',
    blurb: 'Each flag is ticked AND proven another way: the mark must show the proof, not the tick.',
    flags: { trial_justice: ['self', 'who'], grummus_dead: ['self', 'loot'], hedge_event: ['self', 'mimic'] } },
];

export const LAB_FAKE_NAMES = [
  'Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Tavish', 'Merrowyn',
  'Ulric', 'Wenlow', 'Odessa', 'Pellam',
];

/** Letters only, 2 to 24: the same shape the bot accepts as a character name. */
export const isLabName = (s: string) => /^[A-Za-z]{2,24}$/.test(s.trim());

// ── Hail board scenario ────────────────────────────────────────────────────────────────────────────────

export type LabHailState = 'still' | 'still_prior_missing' | 'hailed_flag' | 'hailed_seen' | 'hailed_marked' | 'already';
export const LAB_HAIL_STATES: { key: LabHailState; label: string }[] = [
  { key: 'still', label: 'Still to hail' },
  { key: 'still_prior_missing', label: 'Still (missing the step before)' },
  { key: 'hailed_flag', label: 'Hailed (flag landed)' },
  { key: 'hailed_seen', label: 'Hailed (witnessed)' },
  { key: 'hailed_marked', label: 'Hailed (officer tapped)' },
  { key: 'already', label: 'Already flagged' },
];

export type LabHailMember = { name: string; state: LabHailState };

/** The fake "now" for the hail preview: a fixed instant, so the lab renders the same on server and client. */
export const FAKE_NOW = Date.parse('2026-10-18T01:30:00Z');
const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();

export const hailCfgs = (): HailCfg[] => [...HAIL_BOSSES, ...HAIL_FLAGGERS];

/**
 * A window + the flag rows around it, shaped for buildViews, for a boss killed `minutesSinceKill` before
 * FAKE_NOW with the given roster. Each state is made by the rows the real board reads:
 *  - already: a recital row for the first `done` key (held, however it was stored)
 *  - hailed_flag: an `event` grant row for it, after the kill
 *  - hailed_seen: a `hail` row naming the NPC
 *  - hailed_marked: a tap in the window's marks
 *  - still_prior_missing: the raider is in the recital set but holds no prerequisite
 *    (a boss with no prerequisite, like the Behemoth, can only show plain still)
 */
export function buildHailScenario(
  cfg: HailCfg, minutesSinceKill: number, roster: LabHailMember[],
): { window: HailWindow; data: HailData; nowMs: number } {
  const opened = FAKE_NOW - minutesSinceKill * MIN;
  const expires = opened + stayMs(cfg);
  const rows: HailFlagRow[] = [];
  const known = new Set<string>();
  const marks: NonNullable<HailWindow['marks']> = {};
  const afterKill = iso(opened + Math.min(2, Math.max(minutesSinceKill, 0) / 2) * MIN);
  for (const m of roster) {
    const k = m.name.toLowerCase();
    if (m.state === 'already') rows.push({ character: m.name, flag_key: cfg.done[0], source: 'recital', earned_at: iso(opened - 60 * MIN) });
    else if (m.state === 'hailed_flag') rows.push({ character: m.name, flag_key: cfg.done[0], source: 'event', earned_at: afterKill });
    else if (m.state === 'hailed_seen') rows.push({ character: m.name, flag_key: 'hail', source: 'hail', npc: cfg.npcKeys[0], zone: null, earned_at: afterKill });
    else if (m.state === 'hailed_marked') marks[k] = { name: m.name, by: 'An officer', at: afterKill };
    else if (m.state === 'still_prior_missing') known.add(k);
  }
  const window: HailWindow = {
    id: `${cfg.id}:${Math.floor(opened / 1000)}`, boss_id: cfg.id, boss_name: cfg.name, npc_name: cfg.npc,
    zone: cfg.zone, opened_at: iso(opened), expires_at: iso(expires),
    roster: roster.map(m => m.name), uploaders: [], marks,
  };
  return { window, data: { rows, known }, nowMs: FAKE_NOW };
}
