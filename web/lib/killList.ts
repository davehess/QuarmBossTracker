// What the review's Kills tab lists, as a pure function so the page and the tests read the same rules (the guild lead,
// 2026-10-26: "where are the Carprin cycle mobs?" and "the failed Bertoxx attempts", from a tab that showed one fight).
//
//   * The default list is every NAMED fight: a curated boss (bosses_local) OR a mob the game marks "#" (a named NPC).
//     Curated alone hid the whole Crypt of Decay chain, because only some of it is curated. "Show all" adds the trash.
//     A window with no named fight at all lists everything, as it always did.
//   * A wipe is its own row ("Wipe · 6:30 · 4 deaths") and a fight another guild's is tagged, neither counted as a kill.
//   * Rows are grouped by zone, zones in the order the raid first fought in them, fights in time order inside.
import type { KillRow } from './raidSession';
import { deathsDuring } from './nightSlices';

export type KillLevel = 'named' | 'all';
export type KillView = { kill: KillRow; result: 'kill' | 'wipe'; foreign: boolean; deaths: number | null };
export type ZoneGroup = { zone: string; rows: KillView[] };

export const UNKNOWN_ZONE = 'Zone not recorded';

/** A named fight: curated or "#". */
export const isNamed = (k: Pick<KillRow, 'boss' | 'named'>): boolean => k.boss || k.named;
/** A kill is ours and the mob died. */
export const isKill = (k: Pick<KillRow, 'wipe' | 'foreign'>): boolean => !k.wipe && !k.foreign;

/** Is there a named fight to default to? Without one the tab lists every fight. */
export const hasNamed = (kills: readonly KillRow[]): boolean => kills.some(isNamed);

/** The tab's count: kills among the default list, never a wipe or another guild's fight. */
export function killTabCount(kills: readonly KillRow[]): number {
  const base = hasNamed(kills) ? kills.filter(isNamed) : kills;
  return base.filter(isKill).length;
}

/** The rows to list, grouped by zone. `deathTimes` (member page only) gives a wipe its death count. */
export function listKills(kills: readonly KillRow[], level: KillLevel, deathTimes: readonly number[] | null = null): ZoneGroup[] {
  const base = level === 'named' && hasNamed(kills) ? kills.filter(isNamed) : kills;
  const sorted = [...base].sort((a, b) => a.startMs - b.startMs || (a.endMs ?? 0) - (b.endMs ?? 0));
  const groups: ZoneGroup[] = [];
  for (const k of sorted) {
    const zone = k.zone || UNKNOWN_ZONE;
    let g = groups.find(x => x.zone === zone);
    if (!g) { g = { zone, rows: [] }; groups.push(g); }
    g.rows.push({
      kill: k,
      result: k.wipe ? 'wipe' : 'kill',
      foreign: k.foreign,
      deaths: k.wipe && deathTimes ? deathsDuring({ startMs: k.startMs, endMs: k.endMs ?? k.startMs + (k.durationSec ?? 0) * 1000 }, deathTimes) : null,
    });
  }
  return groups;
}
