// Raid HQ, "alert first" view: turns the rows RaidView already holds into the small shape the calm roster draws.
// Pure: no fetching, no clock. RaidView keeps its own polling; this only re-shapes what it was given.
import { CATEGORY_LABELS, HP_SLOTS, ROLE_TARGETS, isCurseBuff, type BuffCategory, type Role } from './buffs';

/** The part of a RaidView row this view reads (RaidRow satisfies it). */
export type CalmRowInput = {
  name: string;
  className: string | null;
  role: Role;
  raidGroup: number | null;
  rank: string | null;
  inRaid: boolean;
  noAgent: boolean;
  hasAgent: boolean;
  hpPct: number | null;
  manaPct: number | null;
  byCategory: Record<string, string[]>;
  hpSlots: { A: string | null; B: string | null; C: string | null };
  buffs: { name: string; ticks: number | null }[];
  isMe?: boolean;
};

export type CalmRaider = {
  name: string;
  cls: string | null;
  hp: number | null;          // null: no live HP
  mana: number | null;        // null: no mana reading
  live: boolean;              // Mimic data flows for this raider
  dead: boolean;
  curse: string | null;       // first curse on the buff bar
  gaps: string[];             // missing buffs, most important first
  me: boolean;
};
export type CalmGroup = { num: number | null; label: string; raiders: CalmRaider[] };
export type CalmAlert = { kind: 'curse' | 'dead' | 'mana'; who: string; what: string };
export type CalmInvite = { tone: 'green' | 'blue' | 'orange'; text: string };
export type CalmView = {
  leader: string | null;
  mimic: { on: number; total: number };
  notOnMimic: string[];
  invite: CalmInvite;
  groups: CalmGroup[];
  alerts: CalmAlert[];
};

/** A healer at or under this mana is an alert. */
export const MANA_OUT = 10;
/** Under this a caster counts on the Mana list. */
export const MANA_LOW = 25;
export const HEALER_CLASSES = ['cleric', 'druid', 'shaman'];
/** HP at or under this is critical (red); under HURT_HP it is hurt (orange). */
export const CRIT_HP = 35;
export const HURT_HP = 61;

export type HpTone = 'dead' | 'crit' | 'hurt' | 'ok' | 'none';
export function hpTone(hp: number | null): HpTone {
  if (hp == null) return 'none';
  if (hp <= 0) return 'dead';
  if (hp < CRIT_HP) return 'crit';
  if (hp < HURT_HP) return 'hurt';
  return 'ok';
}
export const isHealer = (cls: string | null) => !!cls && HEALER_CLASSES.includes(cls.toLowerCase());

/** Missing buffs for a raider with live data, most important first: HP buff, then the role's own list in order. */
export function missingBuffs(r: Pick<CalmRowInput, 'role' | 'byCategory' | 'hpSlots' | 'noAgent'>): string[] {
  if (r.noAgent) return [];
  const out: string[] = [];
  if (HP_SLOTS.some((s) => !r.hpSlots[s])) out.push('HP buff');
  for (const cat of (ROLE_TARGETS[r.role] || []) as BuffCategory[]) {
    if (!(r.byCategory[cat]?.length)) out.push(CATEGORY_LABELS[cat]);
  }
  return out;
}

export function calmViewFromRows(
  rows: CalmRowInput[],
  ari: { character: string } | null,
): CalmView {
  const inRaid = rows.filter((r) => r.inRaid);
  const raiders = new Map<number | null, CalmRaider[]>();
  const alerts: CalmAlert[] = [];
  let leader: string | null = null;
  for (const r of inRaid) {
    if (leader == null && /raid\s*leader/i.test(r.rank || '')) leader = r.name;
    const curseBuff = (r.buffs || []).find((b) => b && isCurseBuff(b.name));
    const hp = r.hpPct == null ? null : Math.round(r.hpPct);
    const mana = r.manaPct == null ? null : Math.round(r.manaPct);
    const c: CalmRaider = {
      name: r.name, cls: r.className, hp, mana, live: r.hasAgent,
      dead: hp != null && hp <= 0, curse: curseBuff ? curseBuff.name : null,
      gaps: missingBuffs(r), me: !!r.isMe,
    };
    const list = raiders.get(r.raidGroup);
    if (list) list.push(c); else raiders.set(r.raidGroup, [c]);
    if (c.curse) alerts.push({ kind: 'curse', who: c.name, what: c.curse });
    if (c.dead) alerts.push({ kind: 'dead', who: c.name, what: 'dead' });
    if (mana != null && mana <= MANA_OUT && isHealer(c.cls)) alerts.push({ kind: 'mana', who: c.name, what: mana + '% mana' });
  }
  const order = { curse: 0, dead: 1, mana: 2 } as const;
  alerts.sort((a, b) => order[a.kind] - order[b.kind]);
  const groups: CalmGroup[] = [...raiders.entries()]
    .sort((a, b) => (a[0] == null ? 1 : b[0] == null ? -1 : a[0] - b[0]))
    .map(([num, rs]) => ({ num, label: num == null ? 'No group' : 'Group ' + num, raiders: rs }));
  const on = inRaid.filter((r) => r.hasAgent).length;
  const leadName = leader ? leader.toLowerCase() : null;
  const invite: CalmInvite = !ari
    ? { tone: 'orange', text: 'no invite set' }
    : leadName && ari.character.toLowerCase() === leadName
      ? { tone: 'green', text: 'invite on' }
      : { tone: 'blue', text: 'invite via ' + ari.character };
  return {
    leader,
    mimic: { on, total: inRaid.length },
    notOnMimic: inRaid.filter((r) => !r.hasAgent).map((r) => r.name),
    invite, groups, alerts,
  };
}
