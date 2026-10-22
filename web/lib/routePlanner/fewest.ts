// Route planner: "fewest raiders so far". The shape of the answer and how a line of it reads (no server imports: the
// browser engine formats it). The data is `fewestKills` in ./fewestKills.ts (server only).
//
// One row = one past kill of a boss: how many raiders were there when it died and who they were (the class mix), smallest
// first. The page shows the first row per boss on the pin, on the leg and in the compare table, so an off-night plan can be
// drawn against the smallest group that has actually done it.

import type { FewestBoss } from '../fewestKills';

/** One past kill. `night` is an ISO date (YYYY-MM-DD) or a full ISO timestamp. */
export type FewestKill = {
  npc_id: number;
  raiders: number;
  night: string;
  classes: { cls: string; n: number }[];       // biggest first
};

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** "Oct 9" from an ISO date, "" when it is not one. Read as UTC so a server date never shifts a day. */
export function shortDate(night: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(night);
  if (!m) return '';
  const mo = Number(m[2]) - 1;
  return mo >= 0 && mo < 12 ? `${MONTHS[mo]} ${Number(m[3])}` : '';
}

const plural = (cls: string, n: number) => {
  const c = cls.toLowerCase();
  return n === 1 ? c : /s$/.test(c) ? c : c + 's';
};

/** "fewest: 18 raiders, Oct 9 - 3 clerics, 2 warriors" */
export function fewestLine(f: FewestKill, maxClasses = 6): string {
  const when = shortDate(f.night);
  const mix = f.classes.slice(0, maxClasses).map(c => `${c.n} ${plural(c.cls, c.n)}`).join(', ');
  const more = f.classes.length > maxClasses ? ', ...' : '';
  return `fewest: ${f.raiders} raider${f.raiders === 1 ? '' : 's'}${when ? ', ' + when : ''}${mix ? ' — ' + mix + more : ''}`;
}

/** web/lib/fewestKills.ts's answer as planner rows: players (not characters) as raiders, the class mix biggest first. */
export function toPlannerRows(bosses: readonly FewestBoss[]): FewestKill[] {
  return bosses.flatMap(b => b.kills.map(k => ({
    npc_id: b.npc_id,
    raiders: k.players,
    night: k.killed_at,
    classes: Object.entries(k.classes).map(([cls, n]) => ({ cls, n })).sort((a, c) => c.n - a.n || a.cls.localeCompare(c.cls)),
  })));
}

/** The smallest group per boss, from rows in any order. */
export function fewestByNpc(rows: readonly FewestKill[]): Map<number, FewestKill> {
  const out = new Map<number, FewestKill>();
  for (const r of rows) {
    const cur = out.get(r.npc_id);
    if (!cur || r.raiders < cur.raiders || (r.raiders === cur.raiders && r.night > cur.night)) out.set(r.npc_id, r);
  }
  return out;
}
