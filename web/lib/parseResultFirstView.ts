// Pure mapping from what /parses/[id] already loads to the props of the "result first" parse layout
// (components/lab/parse-result-first). No database, no request: the page hands its own data in.
// The design-lab draft (/lab/parse-result-first) uses the same view type with made-up data.

export type ResultState = 'killed' | 'wipe' | 'unknown' | 'open';
export type ViewRole = 'tank' | 'heal' | 'damage';

export type ResultPlayer = { rank: number; name: string; cls: string | null; damage: number; dps: number; pct: number };
export type ResultView = {
  boss: string;
  zone: string | null;
  whenLabel: string;
  state: ResultState;
  /** Boss health left, percent, when known (a wipe fixture knows; the real page does not store it). */
  bossHpLeftPct: number | null;
  durationSec: number | null;
  totalDamage: number;
  raidDps: number;
  players: ResultPlayer[];
  deaths: { name: string; atSec: number | null }[];
  tanks: { name: string; hits: number; taken: number; avoided: number }[];
  healers: { name: string; healed: number; ticks: number }[];
  events: { atSec: number | null; label: string }[];
  loot: { item: string; who: string; dkp: number | null }[];
  contributors: { name: string; damage: number }[];
  /** Names that belong to the viewer (compared case-insensitively). Empty when the page cannot tell. */
  mine: string[];
  /** Which panel opens first in the role-first version. */
  role: ViewRole;
  /** False when the detailed log is gone (the bot deletes it after 7 days): deaths, tank and heal are then unknown, not empty. */
  detailKept: boolean;
};

export type ViewInput = {
  boss: string;
  zone: string | null;
  whenLabel: string;
  isWipe: boolean | null;
  classification: string | null;
  /** encounters.ended_at: set only when a kill was confirmed. */
  endedAt: string | null;
  startedAt: string;
  durationSec: number | null;
  totalDamage: number | null;
  totalDps: number | null;
  players: { character_name: string; total_damage: number; dps: number }[];
  classOf: (name: string) => string | null;
  deaths: { name: string; ts: string }[];
  contribs: {
    contributor_character: string | null;
    total_damage: number;
    raw_parse: {
      defenders?: { name: string; hits?: number; damageTaken?: number; misses?: number; dodges?: number; parries?: number; ripostes?: number; blocks?: number; invulns?: number }[];
      healers?: { name: string; healed?: number; ticks?: number }[] | null;
    } | null;
  }[];
  events: { at: string; label: string }[];
  loot: { item_name: string; character_name: string; dkp: number | null }[];
  mine?: string[];
};

export const fmtBig = (n: number | null | undefined): string => {
  if (n == null || !Number.isFinite(n)) return '-';
  if (n >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `${(n / 1e3).toFixed(1)}k`;
  return String(Math.round(n));
};
/** 252 -> "4:12". Null or negative -> "-". */
export const fmtClock = (sec: number | null | undefined): string => {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return '-';
  const s = Math.round(sec);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

const TANK = new Set(['Warrior', 'Paladin', 'Shadow Knight']);
const HEAL = new Set(['Cleric', 'Druid', 'Shaman']);

export function viewerRole(mine: string[], players: ResultPlayer[]): ViewRole {
  const own = new Set(mine.map((m) => m.toLowerCase()));
  const first = players.find((p) => own.has(p.name.toLowerCase()));
  if (!first?.cls) return 'damage';
  if (TANK.has(first.cls)) return 'tank';
  if (HEAL.has(first.cls)) return 'heal';
  return 'damage';
}

export function toResultView(i: ViewInput): ResultView {
  const dur = i.durationSec != null && i.durationSec > 0 ? Math.round(i.durationSec) : null;
  const sorted = [...i.players].sort((a, b) => (b.total_damage || 0) - (a.total_damage || 0));
  const sum = sorted.reduce((s, p) => s + (p.total_damage || 0), 0);
  const total = i.totalDamage && i.totalDamage > 0 ? i.totalDamage : sum;
  const players: ResultPlayer[] = sorted.map((p, k) => ({
    rank: k + 1, name: p.character_name, cls: i.classOf(p.character_name),
    damage: p.total_damage || 0, dps: p.dps || 0, pct: total > 0 ? ((p.total_damage || 0) / total) * 100 : 0,
  }));
  const t0 = Date.parse(i.startedAt);
  const off = (iso: string): number | null => {
    const t = Date.parse(iso);
    return Number.isFinite(t) && Number.isFinite(t0) ? Math.max(0, Math.round((t - t0) / 1000)) : null;
  };
  const tanks = new Map<string, { name: string; hits: number; taken: number; avoided: number }>();
  const healers = new Map<string, { name: string; healed: number; ticks: number }>();
  // defenders holds every defender, the boss and its adds included: keep only this fight's player rows.
  const playerNames = new Set(sorted.map((p) => p.character_name.toLowerCase()));
  for (const c of i.contribs) {
    for (const d of c.raw_parse?.defenders ?? []) {
      if (!d.name || !playerNames.has(d.name.toLowerCase()) || !(d.damageTaken && d.damageTaken > 0)) continue;
      const avoided = (d.misses ?? 0) + (d.dodges ?? 0) + (d.parries ?? 0) + (d.ripostes ?? 0) + (d.blocks ?? 0) + (d.invulns ?? 0);
      const prev = tanks.get(d.name);
      if (!prev || d.damageTaken > prev.taken) tanks.set(d.name, { name: d.name, hits: d.hits ?? 0, taken: d.damageTaken, avoided });
    }
    for (const h of c.raw_parse?.healers ?? []) {
      if (!h.name || !(h.healed && h.healed > 0)) continue;
      const prev = healers.get(h.name);
      if (!prev || h.healed > prev.healed) healers.set(h.name, { name: h.name, healed: h.healed, ticks: h.ticks ?? 0 });
    }
  }
  const mine = (i.mine ?? []).filter(Boolean);
  const state: ResultState = i.isWipe ? 'wipe' : i.classification ? 'unknown' : i.endedAt ? 'killed' : 'open';
  return {
    boss: i.boss, zone: i.zone, whenLabel: i.whenLabel, state, bossHpLeftPct: null,
    durationSec: dur, totalDamage: total, raidDps: i.totalDps && i.totalDps > 0 ? i.totalDps : dur ? total / dur : 0,
    players,
    deaths: i.deaths.map((d) => ({ name: d.name, atSec: off(d.ts) })),
    tanks: [...tanks.values()].sort((a, b) => b.taken - a.taken).slice(0, 3),
    healers: [...healers.values()].sort((a, b) => b.healed - a.healed).slice(0, 6),
    events: i.events.map((e) => ({ atSec: off(e.at), label: e.label })),
    loot: i.loot.map((l) => ({ item: l.item_name, who: l.character_name, dkp: l.dkp })),
    contributors: i.contribs.map((c) => ({ name: c.contributor_character ?? '(anonymous)', damage: c.total_damage })),
    mine,
    role: viewerRole(mine, players),
    detailKept: i.contribs.some((c) => c.raw_parse != null),
  };
}

/** One-line headlines the folds show while shut. Pure so the numbers can be tested. */
export const headlines = {
  deaths: (v: ResultView): string => {
    if (!v.deaths.length) return 'No deaths';
    const t = v.deaths.map((d) => d.atSec).filter((x): x is number => x != null);
    const first = t.length ? Math.min(...t) : null;
    return `${v.deaths.length} death${v.deaths.length === 1 ? '' : 's'}${first != null ? `, first at ${fmtClock(first)}` : ''}`;
  },
  tank: (v: ResultView): string => (v.tanks.length ? `${v.tanks[0].name} took ${fmtBig(v.tanks[0].taken)}, avoided ${v.tanks[0].avoided} swings` : 'No tank data'),
  heal: (v: ResultView): string => {
    if (!v.healers.length) return 'No heal data';
    const all = v.healers.reduce((s, h) => s + h.healed, 0);
    return `${fmtBig(all)} healed, ${v.healers[0].name} most at ${fmtBig(v.healers[0].healed)}`;
  },
  timeline: (v: ResultView): string => (v.events.length ? `${v.events.length} event${v.events.length === 1 ? '' : 's'}, first ${v.events[0].label.toLowerCase()} at ${fmtClock(v.events[0].atSec)}` : 'No events recorded'),
  loot: (v: ResultView): string => (v.loot.length ? `${v.loot.length} drop${v.loot.length === 1 ? '' : 's'} on the night` : 'No loot recorded'),
  contributors: (v: ResultView): string => `${v.contributors.length} parser${v.contributors.length === 1 ? '' : 's'} uploaded`,
};

/** Class share of total damage, biggest first. Unknown classes group as "Unknown". */
export function classShare(players: ResultPlayer[]): { cls: string; pct: number; players: number }[] {
  const m = new Map<string, { pct: number; players: number }>();
  for (const p of players) {
    const k = p.cls || 'Unknown';
    const e = m.get(k) ?? { pct: 0, players: 0 };
    e.pct += p.pct; e.players += 1; m.set(k, e);
  }
  return [...m.entries()].map(([cls, v]) => ({ cls, ...v })).sort((a, b) => b.pct - a.pct);
}
