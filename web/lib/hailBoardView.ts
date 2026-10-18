// A port of the pure half of utils/hailBoard.js for the officer Flag lab (/admin/flag-lab): the HAIL_BOSSES
// and HAIL_FLAGGERS tables and buildViews(). The website imports nothing from outside web/, so this is a COPY,
// and test/flag-lab-hail-parity.test.js runs it against the bot's own buildViews on one fixture so the two
// cannot drift unnoticed. Pure TypeScript: no IO, no clock (the caller passes `nowMs`, which buildViews does
// not even read; the bot's withClock does the ms_left sum, ported below as withClock).
//
// ⚠ KEEP IN SYNC with utils/hailBoard.js. The facts behind each row (script caps, depop minutes) are written up
// in that file's comments; they are not repeated here.

const MIN = 60_000;
export const WINDOW_MS = 20 * MIN;       // a Planar Projection's stay
export const FLAG_SLACK_MS = 90 * 1000;  // a grant this far BEFORE the kill still counts

const PROJECTION = ['planar projection', 'projection'];

export type HailCfg = {
  id: string;
  name: string;
  names?: string[];
  zone: string;
  zoneShort: string;
  npc: string;
  npcKeys: string[];
  minutes?: number;
  flagCap?: number;
  flagTicks?: number;
  opensOn?: string[];
  done: string[];
  checklist: string | null;
  prior: string[][];
};

export const HAIL_BOSSES: HailCfg[] = [
  { id: 'grummus', name: 'Grummus', names: ['grummus'], zone: 'Plane of Disease', zoneShort: 'podisease',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 144, flagTicks: 2,
    done: ['fuirstel_2', 'fuirstel_3', 'fuirstel_4', 'fuirstel_5'], checklist: 'cl_grummus', prior: [['fuirstel_1']] },
  { id: 'bertoxxulous', name: 'Bertoxxulous', names: ['bertoxxulous'], zone: 'The Crypt of Decay', zoneShort: 'codecay',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['fuirstel_4', 'fuirstel_5', 'bert_dead'], checklist: 'cl_bertox', prior: [['fuirstel_3']] },
  { id: 'terris_thule', name: 'Terris-Thule', names: ['terris thule'], zone: 'The Lair of Terris Thule', zoneShort: 'nightmareb',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['thelin_3', 'thelin_4', 'tthule_dead'], checklist: 'cl_terris', prior: [['thelin_2', 'hedge_event']] },
  { id: 'aerin_dar', name: 'Aerin`Dar', names: ['aerin`dar', 'aerin dar'], zone: 'Plane of Valor', zoneShort: 'povalor',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['aerindar_2', 'aerindar_dead'], checklist: null, prior: [['mavuin_3', 'trial_justice']] },
  { id: 'saryrn', name: 'Saryrn', names: ['saryrn'], zone: 'Plane of Torment', zoneShort: 'potorment',
    npc: 'A Planar Projection', npcKeys: PROJECTION, minutes: 30, flagCap: 72,
    done: ['saryrn_1', 'saryrn_dead', 'cipher_1'], checklist: 'cl_saryrn', prior: [['tylis_2', 'keeper_dead']] },
  { id: 'keeper_of_sorrows', name: 'The Keeper of Sorrows', names: ['the keeper of sorrows', 'keeper of sorrows'],
    zone: 'Plane of Torment', zoneShort: 'potorment',
    npc: 'Tylis Newleaf', npcKeys: ['tylis newleaf', 'tylis'], minutes: 30, flagCap: 72,
    done: ['tylis_2', 'keeper_dead'], checklist: 'cl_keeper', prior: [['tylis_1']] },
  { id: 'lord_mithaniel_marr', name: 'Lord Mithaniel Marr', names: ['lord mithaniel marr', 'mithaniel marr'],
    zone: 'Temple of Marr', zoneShort: 'hohonorb',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 144, flagTicks: 2,
    done: ['mmarr_1', 'marr_dead', 'cipher_1'], checklist: 'cl_mmarr', prior: [['hohtrials_111', 'hoh_trials']] },
  { id: 'manaetic_behemoth', name: 'Manaetic Behemoth', names: ['manaetic behemoth'],
    zone: 'Plane of Innovation', zoneShort: 'poinnovation',
    npc: 'Giwin Mirakon', npcKeys: ['giwin mirakon', 'giwin'], minutes: 10, flagCap: 72,
    done: ['behemoth_dead', 'zeks_2', 'zeks_3', 'zeks_4', 'zeks_5', 'zeks_6', 'zeks_7'], checklist: 'cl_behemoth', prior: [] },
  { id: 'tallon_zek', name: 'Tallon Zek', names: ['tallon zek'], zone: 'Plane of Tactics', zoneShort: 'potactics',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['tallon_dead', 'zeks_4', 'zeks_5', 'zeks_6', 'zeks_7'], checklist: 'cl_tallon',
    prior: [['zeks_2', 'zeks_3', 'behemoth_dead']] },
  { id: 'vallon_zek', name: 'Vallon Zek', names: ['vallon zek'], zone: 'Plane of Tactics', zoneShort: 'potactics',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['vallon_dead', 'zeks_3', 'zeks_5', 'zeks_6', 'zeks_7'], checklist: 'cl_vallon',
    prior: [['zeks_2', 'zeks_4', 'behemoth_dead']] },
  { id: 'rallos_zek_warlord', name: 'Rallos Zek the Warlord', names: ['rallos zek the warlord', 'rallos zek'],
    zone: 'Plane of Tactics', zoneShort: 'potactics',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['zeks_7', 'rallos_dead'], checklist: 'cl_rallos', prior: [['zeks_6']] },
  { id: 'solusek_ro', name: 'Solusek Ro', names: ['solusek ro'], zone: 'Tower of Solusek Ro', zoneShort: 'solrotower',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['pofire_2', 'solro_dead'], checklist: 'cl_solusek',
    prior: [['pofire_1'], ['zeks_7'], ['sol_room_1'], ['sol_room_2'], ['sol_room_3'], ['sol_room_4'], ['sol_room_5']] },
  { id: 'arbitor_of_earth', name: 'A Mystical Arbitor of Earth',
    names: ['a mystical arbitor of earth', 'the arbitor of earth', 'arbitor of earth'],
    zone: 'Plane of Earth', zoneShort: 'poeartha',
    npc: 'A Planar Projection', npcKeys: PROJECTION, flagCap: 72,
    done: ['earthb_key_1', 'arbitor_dead'], checklist: null, prior: [] },
];

export const HAIL_FLAGGERS: HailCfg[] = [
  { id: 'hedge_maze', name: 'Hedge maze', zone: 'Plane of Nightmare', zoneShort: 'ponightmare',
    npc: 'Hedge maze — Thelin Poxbourne (unlocks the Lair of Terris Thule)',
    npcKeys: ['thelin poxbourne', 'thelin'], minutes: 10,
    opensOn: ['thelin_2', 'cl_maze'],
    done: ['thelin_2', 'thelin_3', 'thelin_4', 'hedge_event'], checklist: 'cl_maze', prior: [['thelin_1']] },
];

const BY_ID = new Map([...HAIL_BOSSES, ...HAIL_FLAGGERS].map(b => [b.id, b]));

// Row sources that prove a state HELD, not when it began (see PROOF_SOURCES in the bot).
const PROOF_SOURCES = new Set(['recital', 'tick', 'who']);

export type HailWindow = {
  id: string; boss_id: string; boss_name: string; npc_name: string; zone: string;
  opened_at: string; expires_at: string;
  roster: string[];
  marks?: Record<string, { name?: string; by?: string | null; at?: string }>;
  uploaders?: string[];
};
export type HailFlagRow = {
  character: string; flag_key: string; source: string; earned_at: string;
  npc?: string | null; zone?: string | null;
};
export type HailData = { rows?: HailFlagRow[]; known?: Set<string> };
export type HailedHow = { name: string; how: 'flag' | 'seen' | 'marked'; by?: string };
export type HailView = {
  id: string; boss_id: string; boss_name: string; npc_name: string; zone: string;
  opened_at: string; expires_at: string;
  flag_cap: number | null; flags_granted: number; flags_left: number | null;
  still: { name: string; prior_missing: boolean }[];
  hailed: HailedHow[];
  already_flagged: string[];
  seen_by: number;
};

const lc = (s: unknown) => String(s || '').toLowerCase();
const nameOf = (x: string | { name: string }) => (typeof x === 'string' ? x : x.name);
const byName = (a: string | { name: string }, b: string | { name: string }) =>
  (lc(nameOf(a)) < lc(nameOf(b)) ? -1 : lc(nameOf(a)) > lc(nameOf(b)) ? 1 : 0);

// "Hail, a planar projection" / "Hail, Giwin": the NPC the way a raider typed it, minus the article.
function npcKey(s: unknown): string { return lc(s).replace(/^(a|an|the)\s+/, '').replace(/[^a-z` ]/g, '').replace(/\s+/g, ' ').trim(); }

// utils/popFlagStages.js ZONE_BY_ID + zoneShort(): a zone id or a short name → the short name.
const ZONE_BY_ID: Record<number, string> = {
  200: 'codecay', 201: 'pojustice', 202: 'poknowledge', 203: 'potranquility', 204: 'ponightmare',
  205: 'podisease', 206: 'poinnovation', 207: 'potorment', 208: 'povalor', 209: 'bothunder',
  210: 'postorms', 211: 'hohonora', 212: 'solrotower', 213: 'powar', 214: 'potactics', 215: 'poair',
  216: 'powater', 217: 'pofire', 218: 'poeartha', 219: 'potimea', 220: 'hohonorb', 221: 'nightmareb',
  222: 'poearthb', 223: 'potimeb',
};
function zoneShort(zone: unknown): string | null {
  if (zone == null || zone === '') return null;
  const n = Number(zone);
  if (Number.isInteger(n) && ZONE_BY_ID[n]) return ZONE_BY_ID[n];
  return String(zone).toLowerCase();
}

function hailFits(cfg: HailCfg, r: { npc?: string | null; zone?: string | null }, t: number, cutoff: number, until: number): boolean {
  return !!(npcKey(r.npc) && cfg.npcKeys.includes(npcKey(r.npc))
    && (!r.zone || zoneShort(r.zone) === cfg.zoneShort)
    && t >= cutoff && t <= until);
}

type Row = HailFlagRow & { t: number };

export function buildViews(windows: HailWindow[], data: HailData | null | undefined, _nowMs?: number): Map<string, HailView> {
  const rows = (data && data.rows) || [];
  const known = (data && data.known) || new Set<string>();
  const byChar = new Map<string, Row[]>();
  for (const r of rows) {
    const k = lc(r.character);
    if (!byChar.has(k)) byChar.set(k, []);
    byChar.get(k)!.push({ ...r, t: Date.parse(r.earned_at) });
  }
  const usedHail = new Set<Row>();
  const ordered = windows.slice().sort((a, b) => Date.parse(a.opened_at) - Date.parse(b.opened_at));
  const views = new Map<string, HailView>();
  for (const w of ordered) {
    const cfg = BY_ID.get(w.boss_id);
    if (!cfg) continue;
    const opened = Date.parse(w.opened_at), expires = Date.parse(w.expires_at);
    const cutoff = opened - FLAG_SLACK_MS, until = expires + FLAG_SLACK_MS;
    const still: { name: string; prior_missing: boolean }[] = [];
    const hailed: HailedHow[] = [];
    const already: string[] = [];
    const feeders = new Set<string>(w.uploaders || []);
    for (const name of w.roster) {
      const k = lc(name);
      const mine = byChar.get(k) || [];
      const keys = new Set(mine.map(r => r.flag_key));
      const hailRow = mine.find(r => r.flag_key === 'hail' && !usedHail.has(r) && hailFits(cfg, r, r.t, cutoff, until));
      if (hailRow) usedHail.add(hailRow);
      const grant = (r: Row) => r.t >= cutoff && r.t <= until && (r.source === 'event' || r.source === 'checklist');
      const doneRows = mine.filter(r => cfg.done.includes(r.flag_key));
      const before = doneRows.some(r => PROOF_SOURCES.has(r.source) || r.t < cutoff);
      const flagNow = doneRows.some(grant) || !!(cfg.checklist && mine.some(r => r.flag_key === cfg.checklist && grant(r)));
      if (mine.some(grant)) feeders.add('c:' + k);
      if (before) { already.push(name); continue; }
      if (flagNow) { hailed.push({ name, how: 'flag' }); continue; }
      if (hailRow) { hailed.push({ name, how: 'seen' }); continue; }
      const mark = w.marks && w.marks[k];
      if (mark) { hailed.push(mark.by ? { name, how: 'marked', by: mark.by } : { name, how: 'marked' }); continue; }
      const missing = known.has(k) && cfg.prior.some(any => !any.some(key => keys.has(key)));
      still.push({ name, prior_missing: missing });
    }
    const cap = cfg.flagCap ? Math.floor(cfg.flagCap / (cfg.flagTicks || 1)) : null;
    const granted = hailed.filter(h => h.how === 'flag').length;
    views.set(w.id, {
      id: w.id, boss_id: w.boss_id, boss_name: w.boss_name, npc_name: w.npc_name, zone: w.zone,
      opened_at: w.opened_at, expires_at: w.expires_at,
      flag_cap: cap, flags_granted: granted, flags_left: cap == null ? null : Math.max(0, cap - granted),
      still: still.sort(byName), hailed: hailed.sort(byName),
      already_flagged: already.sort((a, b) => byName(a, b)),
      seen_by: feeders.size,
    });
  }
  return views;
}

// The bot's withClock(): `ms_left` is the NPC's remaining stay at the instant of the response.
export function withClock<T extends { expires_at: string }>(v: T, nowMs: number): T & { ms_left: number } {
  return { ...v, ms_left: Math.max(0, Date.parse(v.expires_at) - nowMs) };
}

/** How long the NPC stays, in ms, for a hail row (the bot's openWindow math). */
export function stayMs(cfg: HailCfg): number {
  return cfg.minutes ? cfg.minutes * MIN : WINDOW_MS;
}
