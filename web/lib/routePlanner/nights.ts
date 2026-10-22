// Route planner: the recorded nights the planner is given. Pure (no database, no DOM), so the root vitest suite real-imports it.
//
// A zone file carries a few STATIC nights (the ones the recorder had when the file was made). The recorder keeps going, so
// the page asks it for the zone's raid nights again (web/lib/raidRoutesLoad.ts zoneNightSeries, the very
// reduction /api/raid/routes draws from) and merges them over the file's: the same night key is ONE night, and the live copy
// wins (it is the longer, later reduction of the same minutes); newest first; at most NIGHT_CAP, because every night rides to
// the browser as a [seconds, x, y] row every 3 s.
import type { Night } from './types';

export const NIGHT_CAP = 12;

/** Colours for nights the file has no colour for; the three the zone files already use come first so a repeat keeps its look. */
export const NIGHT_COLORS = ['#58a6ff', '#f778ba', '#b6e354', '#ffa657', '#a371f7', '#56d4dd', '#f0883e', '#ff7b72', '#7ee787', '#d2a8ff', '#79c0ff', '#e3b341'];

/** One raid visit as the recorder holds it: the raid centre (epoch ms) every 3 s, and the named kills in the order they died. */
export type LiveSeries = { night_key: string; from: number; minutes: number; series: { t: number; x: number; y: number }[]; kills: string[] };

const half = (n: number) => Math.round(n * 2) / 2;

/** "Vallon Zek" -> "Vallon", "The Diaku Overseer" -> "Diaku": a short tag for the Layers list, repeats folded. */
export function killTag(names: readonly string[]): string {
  const tags: string[] = [];
  for (const n of names) {
    const w = n.replace(/^#/, '').replace(/_/g, ' ').replace(/^(the|an?)\s+/i, '').trim().split(/\s+/)[0] ?? '';
    if (w && tags[tags.length - 1] !== w) tags.push(w);
  }
  return tags.slice(0, 8).join(', ') || 'no named kill';
}

/** A visit as a planner night: [unix seconds, x, y] to the half unit (the static nights are cut the same way). */
export function nightFromSeries(v: LiveSeries, color: string): Night {
  return {
    key: v.night_key, color, kill: killTag(v.kills),
    pts: v.series.map(p => [Math.round(p.t / 1000), half(p.x), half(p.y)] as [number, number, number]),
  };
}

/** The day a night key ("10/21/2026") names, as a number to sort on; 0 when the key is not a date. */
export function nightDay(key: string): number {
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(key);
  return m ? Date.UTC(+m[3], +m[1] - 1, +m[2]) : 0;
}

/**
 * The live visits as nights. Two visits on one night key (the raid left the zone and came back) are ONE night: the longer
 * visit stands for it. A key the file already has keeps the file's colour, so a night does not change colour when it arrives
 * live; a new one takes the next colour not in use.
 */
export function liveNights(live: readonly LiveSeries[], saved: readonly Night[]): Night[] {
  const best = new Map<string, LiveSeries>();
  for (const v of live) {
    if (!v.night_key || v.series.length < 2) continue;
    const old = best.get(v.night_key);
    if (!old || v.minutes > old.minutes || (v.minutes === old.minutes && v.from > old.from)) best.set(v.night_key, v);
  }
  const used = new Set(saved.map(n => n.color));
  const free = () => NIGHT_COLORS.find(c => !used.has(c)) ?? NIGHT_COLORS[used.size % NIGHT_COLORS.length];
  const own = new Map(saved.map(n => [n.key, n.color]));
  return [...best.values()].sort((a, b) => b.from - a.from).map(v => {
    let color = own.get(v.night_key);
    if (!color) { color = free(); used.add(color); }
    return nightFromSeries(v, color);
  });
}

export type MergedNights = { nights: Night[]; live: number; saved: number; dropped: number };

/**
 * The file's nights and the live ones as one list: the same key is one night and the live copy wins; newest first; no more
 * than `cap`. `dropped` is how many the cap left out, so the Layers card can say so.
 */
export function mergeNights(saved: readonly Night[], live: readonly Night[], cap = NIGHT_CAP): MergedNights {
  const byKey = new Map<string, Night>();
  for (const n of saved) byKey.set(n.key, n);
  for (const n of live) byKey.set(n.key, n);
  const all = [...byKey.values()].sort((a, b) => nightDay(b.key) - nightDay(a.key) || (b.pts[0]?.[0] ?? 0) - (a.pts[0]?.[0] ?? 0));
  const nights = all.slice(0, Math.max(0, cap));
  const liveKeys = new Set(live.map(n => n.key));
  return { nights, live: nights.filter(n => liveKeys.has(n.key)).length, saved: nights.filter(n => !liveKeys.has(n.key)).length, dropped: all.length - nights.length };
}

/** The line under the Recorded nights list in the Layers tab: what the list is made of, and that it is capped. */
export function nightsNote(m: Pick<MergedNights, 'live' | 'saved' | 'dropped'>, cap = NIGHT_CAP): string {
  const bits = [`Newest ${cap} raid nights at most`, `${m.live} from the live recorder`, `${m.saved} saved with the zone`];
  return bits.join(' · ') + (m.dropped ? ` · ${m.dropped} older left out` : '') + '.';
}
