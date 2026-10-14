// "Latest flags" at the top of /pop (the guild lead, 2026-10-14, after the hail board in Mimic showed a Planar
// Projection mid-raid: "we should show a 'latest flags completed/verified' section at the top of the pop page").
//
// What counts as a completed flag here: a pop_flags row whose source is 'event' (the server's own "You have
// received a character flag!" line) or 'recital' (an NPC recited the flags back). Both are the server speaking,
// so they carry a Verified badge. 'checklist' (a kill without the step before it) and 'hail_witnessed' (we saw
// the character hail a flagger, which is evidence someone talked to an NPC and not a flag) are NOT shown.
//
// Two layouts, compared on beta until one is picked (?flags=a | ?flags=b on /pop):
//   a — newest first, one row per character per moment (the same character earning grummus_dead and
//       fuirstel_2 at the same earned_at is ONE row).
//   b — grouped by flag step, newest step first: "Kill Grummus ... · 6 raiders: A, B, C".
//
// Everything here is pure except loadLatestFlagRows, so test/pop-latest-flags.test.js runs it for real.

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { GUILD_TAG } from './guild';
import { isListable, loadLevels } from './listableChars';
import { POP_FLAGS, POP_ZONES } from './popFlags';
import { POP_STEPS, STEP_IMPLIES } from './popSteps';

export const LATEST_DAYS = 7;
export const LATEST_MAX_ROWS = 30;      // rows in layout a
export const LATEST_MAX_STEPS = 15;     // groups in layout b
export const LATEST_NAMES_PER_STEP = 8;
export const LATEST_STEPS_PER_ROW = 3;
// Rows for one character this close together are one moment: a single grant writes the stage and the stages it
// implies at the same earned_at (index.js, the pop_flags handler), and a projection hail can print two lines.
export const MOMENT_SECS = 90;

// Only these two sources are the server's word. Anything else is left out of the section.
export const VERIFIED_SOURCES = ['event', 'recital'] as const;
// Flag keys that are not a step: grants the bot could not name, and the witnessed-hail marker.
const NOT_A_STEP = new Set(['unmapped', 'hail']);

export type LatestRow = { character: string; flag_key: string; zone: string | null; source: string; earned_at: string };

export function verifiedBadge(source: string): { label: string; title: string } | null {
  if (source === 'event') return { label: 'server', title: "The server's own flag message" };
  if (source === 'recital') return { label: 'NPC recital', title: 'An NPC recited the flags back; the flag can be older than the recital' };
  return null;
}

// The rows that belong in the section: a verified source, and a real step.
export const isShowable = (r: Pick<LatestRow, 'flag_key' | 'source'>) =>
  verifiedBadge(r.source) !== null && !NOT_A_STEP.has(r.flag_key);

// Step label by key: the step catalog first (the stage keys the bot stores), then the flag catalog.
const STEP_LABELS: Record<string, string> = {};
for (const steps of Object.values(POP_STEPS)) for (const s of steps) STEP_LABELS[s.key] ??= s.label;
export const stepLabel = (key: string): string => STEP_LABELS[key] ?? POP_FLAGS[key]?.label ?? key;

// pop_flags.zone is the numeric zone id the agent saw ("205"). eqemu_zone ids, as in utils/popFlagStages.js.
const ZONE_NODE_BY_ID: Record<string, string> = {
  200: 'cod', 201: 'justice', 204: 'nightmare', 205: 'disease', 206: 'innovation', 207: 'torment', 208: 'valor',
  209: 'bot', 210: 'storms', 211: 'hoh', 212: 'solro', 214: 'tactics', 215: 'air', 216: 'water', 217: 'fire',
  218: 'earth', 219: 'time', 220: 'hohb', 221: 'ponb', 222: 'poeb', 223: 'time',
};
const OTHER_ZONES: Record<string, { name: string; short: string }> = {
  202: { name: 'Plane of Knowledge', short: 'Knowledge' },
  203: { name: 'Plane of Tranquility', short: 'Tranquility' },
  213: { name: 'Plane of War', short: 'War' },
};
export function zoneLabel(zone: string | null): { name: string; short: string } | null {
  if (!zone) return null;
  const node = POP_ZONES.find(z => z.key === ZONE_NODE_BY_ID[zone]);
  if (node) return { name: node.name, short: node.short };
  return OTHER_ZONES[zone] ?? null;
}

// "2h ago". Server-rendered at request time (the page is force-dynamic), so no client clock is needed.
export function agoText(nowMs: number, atMs: number): string {
  const s = Math.max(0, Math.round((nowMs - atMs) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export type MomentStep = { key: string; label: string; source: string };
export type MomentGroup = {
  character: string; at: number; steps: MomentStep[]; zone: string | null; source: string;   // source: event beats recital
};

// A key another key in the same moment already proves (fuirstel_2 carries fuirstel_1 and grummus_1) is not a
// second thing the character did, so it is not listed beside the one that carried it.
export function dropImplied(keys: string[]): string[] {
  const proves = (from: string, target: string) => {
    const seen = new Set<string>();
    const stack = [...(STEP_IMPLIES[from] ?? [])];
    while (stack.length) {
      const k = stack.pop() as string;
      if (k === target) return true;
      if (seen.has(k)) continue;
      seen.add(k);
      stack.push(...(STEP_IMPLIES[k] ?? []));
    }
    return false;
  };
  return keys.filter(k => !keys.some(j => j !== k && proves(j, k) && !proves(k, j)));
}

// One group per character per moment, newest first. Rows that are not showable are dropped here too, so a caller
// cannot forget the filter.
export function groupByMoment(rows: LatestRow[], windowSecs = MOMENT_SECS): MomentGroup[] {
  const sorted = rows.filter(isShowable)
    .map(r => ({ ...r, t: Date.parse(r.earned_at) }))
    .filter(r => Number.isFinite(r.t))
    .sort((a, b) => b.t - a.t);
  type Open = { character: string; at: number; byKey: Map<string, { source: string }>; zone: string | null };
  const open: Open[] = [];
  for (const r of sorted) {
    const k = r.character.toLowerCase();
    let g = open.find(o => o.character.toLowerCase() === k && o.at - r.t <= windowSecs * 1000);
    if (!g) { g = { character: r.character, at: r.t, byKey: new Map(), zone: r.zone }; open.push(g); }
    const had = g.byKey.get(r.flag_key);
    if (!had || (had.source !== 'event' && r.source === 'event')) g.byKey.set(r.flag_key, { source: r.source });
    if (!g.zone && r.zone) g.zone = r.zone;
  }
  return open.map(g => {
    const keys = dropImplied([...g.byKey.keys()]);
    return {
      character: g.character, at: g.at, zone: g.zone,
      steps: keys.map(key => ({ key, label: stepLabel(key), source: g.byKey.get(key)!.source })),
      source: keys.some(key => g.byKey.get(key)!.source === 'event') ? 'event' : 'recital',
    };
  });
}

export type StepGroup = {
  key: string; label: string; zone: string | null; at: number;
  characters: { name: string; at: number }[];     // newest first, one entry per character
};

// The same moments, regrouped by step: newest step first, each with the raiders who did it (newest first).
export function groupByStep(rows: LatestRow[], windowSecs = MOMENT_SECS): StepGroup[] {
  const by = new Map<string, StepGroup>();
  for (const m of groupByMoment(rows, windowSecs)) {
    for (const s of m.steps) {
      let g = by.get(s.key);
      if (!g) { g = { key: s.key, label: s.label, zone: m.zone, at: m.at, characters: [] }; by.set(s.key, g); }
      if (!g.characters.some(c => c.name.toLowerCase() === m.character.toLowerCase())) g.characters.push({ name: m.character, at: m.at });
      if (m.at > g.at) g.at = m.at;
    }
  }
  return [...by.values()]
    .map(g => ({ ...g, characters: g.characters.sort((a, b) => b.at - a.at) }))
    .sort((a, b) => b.at - a.at);
}

// The last LATEST_DAYS of verified rows for the guild. pop_flags is a big table, so the read is paged
// (selectAll) and ordered on a unique key; the window keeps it small.
export async function loadLatestFlagRows(sb: SupabaseClient, nowMs = Date.now()): Promise<LatestRow[]> {
  const since = new Date(nowMs - LATEST_DAYS * 86_400_000).toISOString();
  return selectAll<LatestRow>((from, to) => sb.from('pop_flags')
    .select('character, flag_key, zone, source, earned_at')
    .eq('guild_id', GUILD_TAG)
    .in('source', [...VERIFIED_SOURCES])
    .not('flag_key', 'in', '(unmapped,hail)')
    .gte('earned_at', since)
    .order('earned_at', { ascending: false }).order('id', { ascending: false })
    .range(from, to));
}

// Traders, characters their owner hid and characters of a known level under 46 stay out, like the /pop
// spell-needs table (web/lib/listableChars.ts). A character with no known level stays in: earning a PoP flag
// is proof enough that it is not a mule.
export function listableRows(
  rows: LatestRow[], traders: Set<string>, hidden: Set<string>, levels: Map<string, number>,
): LatestRow[] {
  return rows.filter(r => {
    const k = r.character.toLowerCase();
    return isListable({ rank: traders.has(k) ? 'Trader' : null, level: levels.get(k) ?? null, hidden: hidden.has(k) });
  });
}

export async function latestFlagsFor(
  sb: SupabaseClient, traders: Set<string>, hidden: Set<string>, nowMs = Date.now(),
): Promise<LatestRow[]> {
  const rows = await loadLatestFlagRows(sb, nowMs);
  const levels = await loadLevels(sb, [...new Set(rows.map(r => r.character))]);
  return listableRows(rows, traders, hidden, levels);
}
