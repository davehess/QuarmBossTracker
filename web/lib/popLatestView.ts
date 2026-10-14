// /pop/latest — the "Latest flags" view the guild lead asked for after reading both beta layouts of the /pop strip
// (2026-10-14: "I like the verbose stream of A, but for flags that go together I think that a list view in alpha
// order by default would be helpful ... There should be a collapsible latest section that has B's layout format,
// in order of stages and what relies on each flag ... The (and 29 more) item isn't useful if we can't open it up").
// Everything here is pure except the three small reads at the bottom, so test/pop-latest-view.test.js runs it for
// real. The older strip's rules (web/lib/popLatestFlags.ts) are reused, not copied: what counts as a verified row,
// the badges, the implied-step rule, the level / trader / hidden filter.
//
// WHAT THIS FIXES IN THE STRIP
//  - The same character, the same steps and the same "NPC recital" twice, minutes apart. A recital restates the
//    flags a character already holds, so a second recital of the same set is not news. A recital step shows only
//    when the character did not already hold it (an earlier row, or a later step that proves it: stepsHeld).
//    That is the "newly added" rule of the matrix's change highlighting (popAltGroups.ts), widened to the implied
//    steps. An event row is always news: it is the server speaking now.
//  - "(Plane of Knowledge)" on nearly every step of layout b, because that was where the Seer recital was heard.
//    The place here is the STEP's own (stepPlace: the card it sits on in POP_STEPS, or its `where`); the zone
//    stored on the row is never read.
//
// THE CHAIN ORDER IS DERIVED, not written down a second time. A line is one of NEXT_LINES (popNextSteps.ts, the
// checklist's progression lines); its guide steps become flag keys through STEP_GUIDE (popGuideSeer.ts) and the
// guide's own `flag`; the order inside a line is the stage order, corrected by STEP_IMPLIES so that a step is never
// listed before a step it needs (orderKeys). "What relies on a step" is the reverse of STEP_IMPLIES plus the planes
// whose gate (POP_ZONES[].requires) names it. Add a step to the catalog and it lands in the right place here.

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { isCorpse } from './buffs';
import { isListable } from './listableChars';
import { POP_FLAGS, POP_ZONES, POP_ZONE_BY_KEY, TIER_LABELS, type PopNode } from './popFlags';
import { POP_STEPS, STEP_IMPLIES, stepsHeld, type PopStep } from './popSteps';
import { GUIDE_ITEMS } from './popGuide';
import { STEP_GUIDE } from './popGuideSeer';
import { NEXT_LINES } from './popNextSteps';
import { RAIDER_RANKS } from './popRoster';
import { dropImplied, isShowable, stepLabel, MOMENT_SECS, type LatestRow } from './popLatestFlags';

// ── The knobs ────────────────────────────────────────────────────────────────
export const DAY_MS = 86_400_000;
export const WINDOWS = { '24h': 1, '3d': 3, '7d': 7 } as const;
export type WindowKey = keyof typeof WINDOWS;
export const DEFAULT_WINDOW: WindowKey = '7d';
// History read so a repeat can be told from news. PoP opened 2026-10-01, so this covers the whole era for now; a
// recital older than this that restates an older flag would read as new, which is the §302 first-recital caveat.
export const HISTORY_DAYS = 90;
// Characters that earned the same steps within this long of the newest one are one row (a raid kill).
export const GROUP_SECS = 300;
export const RAID_FRESH_MS = 15 * 60_000;   // a raid is live when a raid_roster row is this fresh (/raid's window)
export const NAMES_SHOWN = 12;              // names or steps shown before the "and N more" fold
export const STREAM_ROWS = 40;              // rows shown before the "earlier moments" fold

export type Scope = 'mains' | 'all';
export type Order = 'az' | 'time';
export type ViewParams = { window: WindowKey; scope: Scope; order: Order };

// Anything unrecognised (absent, repeated, junk) is the default, so a hand-edited link never throws.
export function parseView(sp: { w?: unknown; scope?: unknown; order?: unknown }): ViewParams {
  const w = typeof sp.w === 'string' && sp.w in WINDOWS ? (sp.w as WindowKey) : DEFAULT_WINDOW;
  return { window: w, scope: sp.scope === 'all' ? 'all' : 'mains', order: sp.order === 'time' ? 'time' : 'az' };
}

// ── The catalog, indexed once ────────────────────────────────────────────────
const STEP_BY_KEY = new Map<string, { card: string; step: PopStep }>();
for (const [card, steps] of Object.entries(POP_STEPS)) for (const step of steps) if (!STEP_BY_KEY.has(step.key)) STEP_BY_KEY.set(step.key, { card, step });

// guide step -> the flag steps that stand for it (the inverse of STEP_GUIDE), and the guide's own catalog flag.
const STAGES_OF_GUIDE = new Map<string, string[]>();
for (const [stage, guide] of Object.entries(STEP_GUIDE)) STAGES_OF_GUIDE.set(guide, [...(STAGES_OF_GUIDE.get(guide) ?? []), stage]);
const GUIDE_BY_FLAG = new Map<string, string>();
const FLAG_OF_GUIDE = new Map<string, string>();
for (const i of GUIDE_ITEMS) if (i.flag) { if (!GUIDE_BY_FLAG.has(i.flag)) GUIDE_BY_FLAG.set(i.flag, i.key); FLAG_OF_GUIDE.set(i.key, i.flag); }

// A step the server prints a line for. A silent step (the Crypt key) is only ever shown by the Seer, so a catalog
// flag is never folded onto one: "Kill Grummus" is not "the Crypt of Decay key".
const isLoud = (k: string) => STEP_BY_KEY.has(k) && !STEP_BY_KEY.get(k)!.step.silent;

// The pop_flags table stores a grant under its stage key ('thelin_2') and under the catalog flag it implies
// ('hedge_event'), at one time. They are the same event, so a catalog flag is shown as its stage:
//   1. the guide step that carries the flag has exactly one loud flag step ('grummus_dead' -> 'fuirstel_2'), else
//   2. STEP_IMPLIES ("catalog flags -> their stage") names exactly one loud step ('hedge_event' -> 'thelin_2').
// A flag that fits neither stays what it is (hoh_trials, solro_minis, the loot flags).
const CANON = new Map<string, string>();
export function canonicalKey(key: string): string {
  const hit = CANON.get(key);
  if (hit) return hit;
  let out = key;
  if (!STEP_BY_KEY.has(key) && POP_FLAGS[key]) {
    const guide = GUIDE_BY_FLAG.get(key);
    const viaGuide = guide ? (STAGES_OF_GUIDE.get(guide) ?? []).filter(isLoud) : [];
    const viaImplies = (STEP_IMPLIES[key] ?? []).filter(isLoud);
    out = viaGuide.length === 1 ? viaGuide[0] : viaImplies.length === 1 ? viaImplies[0] : key;
  }
  CANON.set(key, out);
  return out;
}

export type Place = { name: string; short: string };
// Where a step happens: its own card in POP_STEPS (or its `where`), else the zone of its catalog flag. Never the
// zone a row was heard in.
export function stepPlace(key: string): Place | null {
  const hit = STEP_BY_KEY.get(key);
  if (hit) {
    if (hit.step.where) return { name: `Plane of ${hit.step.where}`, short: hit.step.where };
    const z = POP_ZONE_BY_KEY[hit.card];
    return z ? { name: z.name, short: z.short } : null;
  }
  const z = POP_ZONE_BY_KEY[POP_FLAGS[key]?.zone ?? ''];
  return z ? { name: z.name, short: z.short } : null;
}

// The zone card a step belongs to (for its tier).
const homeZone = (key: string): PopNode | undefined =>
  POP_ZONE_BY_KEY[STEP_BY_KEY.get(key)?.card ?? POP_FLAGS[key]?.zone ?? ''];

// ── Lines (the chains), derived ──────────────────────────────────────────────
// Order `keys` so that none comes before a step it needs (STEP_IMPLIES, followed all the way down), and otherwise
// by `prio` (lower first). Never loops: when nothing is ready the lowest priority goes, whatever it waits for.
export function orderKeys(keys: string[], prio: (k: string) => number): string[] {
  const left = new Set(keys);
  const needs = new Map<string, string[]>();
  for (const k of keys) needs.set(k, [...stepsHeld([k])].filter(j => j !== k && left.has(j) && !stepsHeld([j]).has(k)));
  const out: string[] = [];
  while (left.size) {
    const pool = [...left].sort((a, b) => prio(a) - prio(b));
    const next = pool.find(k => needs.get(k)!.every(j => !left.has(j))) ?? pool[0];
    left.delete(next);
    out.push(next);
  }
  return out;
}

export type Line = { key: string; label: string; short: string; tier: number; keys: string[] };

function stageKeys(st: { steps: string[]; flags?: string[] }): string[] {
  const out: string[] = [];
  for (const g of st.steps) {
    out.push(...(STAGES_OF_GUIDE.get(g) ?? []));
    const f = FLAG_OF_GUIDE.get(g);
    if (f) out.push(f);
  }
  out.push(...(st.flags ?? []));
  return out.map(canonicalKey);
}

const LINE_OF_KEY = new Map<string, string>();
export const LINES: Line[] = [];
(() => {
  const prios = new Map<string, Map<string, number>>();
  for (const nl of NEXT_LINES) {
    const prio = new Map<string, number>();
    nl.stages.forEach((st, si) => stageKeys(st).forEach((k, n) => { if (!LINE_OF_KEY.has(k) && !prio.has(k)) prio.set(k, si * 100 + n); }));
    for (const k of prio.keys()) LINE_OF_KEY.set(k, nl.key);
    if (prio.size) prios.set(nl.key, prio);
  }
  // A step the checklist has no box for (the Keeper kill) joins the line of the step that needs it, just before it.
  for (const k of STEP_BY_KEY.keys()) {
    if (LINE_OF_KEY.has(k) || !isLoud(k)) continue;
    for (const [lineKey, prio] of prios) {
      const owner = [...prio.keys()].find(j => stepsHeld([j]).has(k));
      if (owner) { prio.set(k, prio.get(owner)! - 1); LINE_OF_KEY.set(k, lineKey); break; }
    }
  }
  for (const nl of NEXT_LINES) {
    const prio = prios.get(nl.key);
    if (!prio) continue;
    const keys = orderKeys([...prio.keys()], k => prio.get(k)!);
    LINES.push({ key: nl.key, label: nl.label, short: nl.short, tier: homeZone(keys[0])?.tier ?? 3, keys });
  }
})();
export const lineOf = (key: string): string | null => LINE_OF_KEY.get(key) ?? null;

// ── What relies on a step ────────────────────────────────────────────────────
export type Unlocks = { steps: string[]; zones: { key: string; name: string }[] };

// The line keys a gate flag stands for: itself when a line holds it, else what it implies (hoh_trials -> the trials).
function lineKeysFor(flag: string, seen = new Set<string>()): string[] {
  const c = canonicalKey(flag);
  if (LINE_OF_KEY.has(c)) return [c];
  if (seen.has(c)) return [];
  seen.add(c);
  return (STEP_IMPLIES[c] ?? []).flatMap(k => lineKeysFor(k, seen));
}

const UNLOCKS = new Map<string, Unlocks>();
(() => {
  const dependents = new Map<string, Set<string>>();
  for (const d of LINE_OF_KEY.keys()) {
    for (const a of (STEP_IMPLIES[d] ?? []).flatMap(k => lineKeysFor(k))) {
      if (a === d) continue;
      if (!dependents.has(a)) dependents.set(a, new Set());
      dependents.get(a)!.add(d);
    }
  }
  const zonesFor = new Map<string, { key: string; name: string }[]>();
  for (const z of POP_ZONES) {
    for (const k of new Set(z.requires.flatMap(f => lineKeysFor(f)))) zonesFor.set(k, [...(zonesFor.get(k) ?? []), { key: z.key, name: z.name }]);
  }
  for (const k of LINE_OF_KEY.keys()) {
    const deps = [...(dependents.get(k) ?? [])];
    // The nearest dependents only: a step that already needs another dependent of this one comes later.
    const near = deps.filter(d => !deps.some(o => o !== d && stepsHeld([d]).has(o) && !stepsHeld([o]).has(d)));
    UNLOCKS.set(k, { steps: orderKeys(near, key => [...LINE_OF_KEY.keys()].indexOf(key)), zones: zonesFor.get(k) ?? [] });
  }
})();
export const unlocksOf = (key: string): Unlocks => UNLOCKS.get(key) ?? { steps: [], zones: [] };

// ── Moments ──────────────────────────────────────────────────────────────────
export type MomentStep = { key: string; label: string; source: string };
export type CharMoment = {
  character: string; at: number; steps: MomentStep[];
  source: 'event' | 'recital';
  catchUp: boolean;      // a recital that is this character's first row: every flag it recites reads as new
};

export type Moments = {
  moments: CharMoment[];                   // news only, newest first
  held: Map<string, Set<string>>;          // lowercase character -> every step its rows prove
  repeats: number;                         // recital moments that restated only held steps, and were left out
};

// Rows -> one moment per character per MOMENT_SECS (the strip's rule), on canonical keys, repeats removed.
export function charMoments(rows: LatestRow[], windowSecs = MOMENT_SECS): Moments {
  const sorted = rows.filter(isShowable)
    .map(r => ({ character: r.character, key: canonicalKey(r.flag_key), source: r.source, t: Date.parse(r.earned_at) }))
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => b.t - a.t);
  type Open = { character: string; at: number; byKey: Map<string, string> };
  const latest = new Map<string, Open>();   // lowercase character -> its newest open group (rows arrive newest first)
  const groups: Open[] = [];
  for (const r of sorted) {
    const k = r.character.toLowerCase();
    let g = latest.get(k);
    if (!g || g.at - r.t > windowSecs * 1000) { g = { character: r.character, at: r.t, byKey: new Map() }; latest.set(k, g); groups.push(g); }
    const had = g.byKey.get(r.key);
    if (!had || (had !== 'event' && r.source === 'event')) g.byKey.set(r.key, r.source);
  }
  // Oldest first, so each moment is judged against what the character held BEFORE it.
  const held = new Map<string, Set<string>>();
  const moments: CharMoment[] = [];
  let repeats = 0;
  for (const g of groups.sort((a, b) => a.at - b.at)) {
    const k = g.character.toLowerCase();
    const before = held.get(k);
    const keys = dropImplied([...g.byKey.keys()]);
    const steps = keys
      .filter(key => g.byKey.get(key) === 'event' || !before?.has(key))
      .map(key => ({ key, label: stepLabel(key), source: g.byKey.get(key)! }));
    held.set(k, new Set([...(before ?? []), ...stepsHeld(g.byKey.keys())]));
    if (!steps.length) { repeats++; continue; }
    const event = steps.some(s => s.source === 'event');
    moments.push({ character: g.character, at: g.at, steps, source: event ? 'event' : 'recital', catchUp: !event && !before });
  }
  return { moments: moments.sort((a, b) => b.at - a.at), held, repeats };
}

export type Who = { name: string; at: number };
export type Cluster = {
  id: string;
  steps: MomentStep[];
  source: 'event' | 'recital';
  at: number;            // the newest character's time
  earliest: number;
  catchUp: boolean;
  characters: Who[];
};

export const byName = (a: Who, b: Who) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.name.localeCompare(b.name);
export const byTime = (a: Who, b: Who) => b.at - a.at || byName(a, b);
export const sortWho = (list: Who[], order: Order): Who[] => [...list].sort(order === 'time' ? byTime : byName);

// Characters that earned the SAME set of steps from the same kind of source within `gapSecs` of the newest of them
// are one cluster: a raid kill is one row, not fifty. A single character's moment is a cluster of one.
export function clusterMoments(moments: CharMoment[], order: Order = 'az', gapSecs = GROUP_SECS): Cluster[] {
  const sorted = [...moments].sort((a, b) => b.at - a.at);
  const open = new Map<string, Cluster>();   // signature -> its newest cluster
  const out: Cluster[] = [];
  for (const m of sorted) {
    const sig = `${m.source}|${m.catchUp ? 1 : 0}|${m.steps.map(s => s.key).sort().join(',')}`;
    let c = open.get(sig);
    if (!c || c.at - m.at > gapSecs * 1000) {
      c = { id: `${sig}@${m.at}`, steps: m.steps, source: m.source, at: m.at, earliest: m.at, catchUp: m.catchUp, characters: [] };
      open.set(sig, c);
      out.push(c);
    }
    c.earliest = Math.min(c.earliest, m.at);
    if (!c.characters.some(w => w.name.toLowerCase() === m.character.toLowerCase())) c.characters.push({ name: m.character, at: m.at });
  }
  for (const c of out) c.characters = sortWho(c.characters, order);
  return out;
}

// ── "Still needs it" ─────────────────────────────────────────────────────────
export type Needer = { name: string; missing: string[] };

// Raid members who do not hold the cluster's steps yet, A-Z. A member missing only some of them carries which.
// A member we have no rows for holds nothing, which is what "no recital on file" means.
export function stillNeeds(cluster: Pick<Cluster, 'steps' | 'characters'>, raid: string[], held: Map<string, Set<string>>): Needer[] {
  const got = new Set(cluster.characters.map(c => c.name.toLowerCase()));
  const out: Needer[] = [];
  for (const name of raid) {
    if (got.has(name.toLowerCase())) continue;
    const have = held.get(name.toLowerCase());
    const missing = cluster.steps.map(s => s.key).filter(k => !have?.has(k));
    if (missing.length) out.push({ name, missing });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }));
}

// ── By stage ─────────────────────────────────────────────────────────────────
export type StageStep = {
  key: string; label: string; place: Place | null;
  characters: Who[];
  unlocks: { steps: { key: string; label: string }[]; zones: { key: string; name: string }[] };
};
export type StageCard = { key: string; label: string; tier: number; steps: StageStep[]; raiders: number };
export type StageBoard = { tiers: { tier: number; name: string; sub: string; cards: StageCard[] }[]; other: StageCard | null };

// The in-window news, regrouped: a card per line that anybody advanced, its steps in dependency order, each with
// who earned it (one entry per character) and what relies on it. A step nobody earned in the window stays listed
// in a line that moved, so the chain reads whole.
export function stageBoard(moments: CharMoment[], order: Order = 'az'): StageBoard {
  const earned = new Map<string, Map<string, Who>>();
  for (const m of moments) {
    for (const s of m.steps) {
      let who = earned.get(s.key);
      if (!who) { who = new Map(); earned.set(s.key, who); }
      const k = m.character.toLowerCase();
      const had = who.get(k);
      if (!had || m.at > had.at) who.set(k, { name: m.character, at: m.at });
    }
  }
  const stepOf = (key: string): StageStep => {
    const u = unlocksOf(key);
    return {
      key, label: stepLabel(key), place: stepPlace(key),
      characters: sortWho([...(earned.get(key)?.values() ?? [])], order),
      unlocks: { steps: u.steps.map(k => ({ key: k, label: stepLabel(k) })), zones: u.zones },
    };
  };
  const cardOf = (key: string, label: string, tier: number, keys: string[]): StageCard => {
    const steps = keys.map(stepOf);
    return { key, label, tier, steps, raiders: new Set(steps.flatMap(s => s.characters.map(c => c.name.toLowerCase()))).size };
  };
  const cards = LINES.filter(l => l.keys.some(k => earned.has(k))).map(l => cardOf(l.key, l.label, l.tier, l.keys));
  const strays = orderKeys([...earned.keys()].filter(k => !LINE_OF_KEY.has(k)), k => POP_ZONES.findIndex(z => z.key === homeZone(k)?.key));
  return {
    tiers: [1, 2, 3, 4, 5]
      .map(tier => ({ tier, name: TIER_LABELS[tier].name, sub: TIER_LABELS[tier].sub, cards: cards.filter(c => c.tier === tier) }))
      .filter(t => t.cards.length > 0),
    other: strays.length ? cardOf('other', 'Other flags', 0, strays) : null,
  };
}

// ── Filters ──────────────────────────────────────────────────────────────────
export type Listing = { traders: Set<string>; hidden: Set<string>; mains: Set<string> };

// Traders, hidden characters and mains from the one roster read (rank and hidden_from_lists live on `characters`).
export type RosterFacts = { name: string; rank: string | null; active: boolean | null; hidden_from_lists: boolean | null };
export function listingOf(roster: RosterFacts[]): Listing {
  const out: Listing = { traders: new Set(), hidden: new Set(), mains: new Set() };
  for (const c of roster) {
    const k = String(c.name ?? '').toLowerCase();
    if (!k) continue;
    if (String(c.rank ?? '').trim().toLowerCase() === 'trader') out.traders.add(k);
    if (c.hidden_from_lists === true) out.hidden.add(k);
    if (RAIDER_RANKS.includes(c.rank ?? '') && c.active !== false) out.mains.add(k);
  }
  return out;
}

// The page's three character filters, in one place for rows and for raid names: the level / trader / hidden rule
// (listableChars.ts; a character of unknown level stays in), then Mains when that is the scope.
export function keepName(name: string, listing: Listing, levels: Map<string, number>, scope: Scope): boolean {
  const k = name.toLowerCase();
  if (!isListable({ rank: listing.traders.has(k) ? 'Trader' : null, level: levels.get(k) ?? null, hidden: listing.hidden.has(k) })) return false;
  return scope === 'all' || listing.mains.has(k);
}

// Each name once (case-insensitively), the first spelling kept.
const firstSpelling = (list: string[]): string[] => {
  const seen = new Map<string, string>();
  for (const n of list) if (!seen.has(n.toLowerCase())) seen.set(n.toLowerCase(), n);
  return [...seen.values()];
};

export type LatestView = {
  clusters: Cluster[];
  board: StageBoard;
  needs: Map<string, Needer[]>;     // cluster id -> raid members who still need it (only when a raid is live)
  raidSize: number | null;          // null: no raid captured in the last 15 minutes
  repeats: number;
  moments: number;
};

export function buildView(
  rows: LatestRow[], raid: string[] | null, listing: Listing, levels: Map<string, number>, params: ViewParams, nowMs: number,
): LatestView {
  const keep = (n: string) => keepName(n, listing, levels, params.scope);
  const { moments, held, repeats } = charMoments(rows.filter(r => keep(r.character)));
  const since = nowMs - WINDOWS[params.window] * DAY_MS;
  const inWindow = moments.filter(m => m.at >= since);
  const clusters = clusterMoments(inWindow, params.order);
  const members = raid ? firstSpelling(raid.filter(keep)) : null;
  const needs = new Map<string, Needer[]>();
  if (members) for (const c of clusters) needs.set(c.id, stillNeeds(c, members, held));
  return { clusters, board: stageBoard(inWindow, params.order), needs, raidSize: members ? members.length : null, repeats, moments: inWindow.length };
}

// ── The reads (all paged, none per character) ────────────────────────────────
// Names in the live raid: a raid_roster row captured in the last RAID_FRESH_MS. The table keeps one row per
// uploader per member, so a name repeats; the primary key (guild, uploader, name) is the unique page order.
// null when nothing is fresh, which the page reads as "no raid right now".
export async function loadRaidNames(sb: SupabaseClient, nowMs = Date.now()): Promise<string[] | null> {
  const since = new Date(nowMs - RAID_FRESH_MS).toISOString();
  const rows = await selectAll<{ name: string }>((from, to) => sb.from('raid_roster')
    .select('name, uploaded_by_discord_id')
    .eq('guild_id', GUILD_TAG)
    .gte('captured_at', since)
    .order('uploaded_by_discord_id').order('name')
    .range(from, to));
  const names = firstSpelling(rows.filter(r => r.name && !isCorpse(r.name)).map(r => r.name));
  return names.length ? names : null;
}
