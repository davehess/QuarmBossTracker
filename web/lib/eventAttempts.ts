// web/lib/eventAttempts.ts — find the attempts of a scripted event in the encounter rows (DECISIONS §555). Pure: the
// database read is web/lib/eventAttemptsLoad.ts.
//
// An attempt is a run of one raid night's encounters on the event's mobs. A new attempt starts when
//   · the gap since the last encounter is over 30 minutes,
//   · a second 'start' match arrives (a second Guardian death while the first run still has its start), or
//   · the last run already reached its end (the final boss died).
// Each moment of the event's def is then matched inside the attempt (eventSplitsDefs.ts): a 'death' moment reads a
// kill's ended_at, an 'engage' moment a row's started_at (a wipe counts). Group moments are unordered: the group's
// encounters, sorted by time, take its slots in order.

import { isWipe } from './encounterMarks';
import type { Moment, SplitsDef } from './eventSplitsDefs';

export const ATTEMPT_GAP_MS = 30 * 60 * 1000;
/** Margin either side of an attempt for its replay window. */
export const REPLAY_MARGIN_MS = 2 * 60 * 1000;

export type EncRow = {
  id: string;
  npc_id: number;
  raid_night_id: string | null;
  started_at: string;
  ended_at: string | null;
  classification: string | null;
  is_wipe: boolean | null;
  /** Whose run it was (rowSide). Absent means ours. */
  side?: Side;
};

/**
 * Our raiders' clients also record another guild's fights when a member raids with them, stored under our guild id
 * (the guild lead, 2026-11-11). Those runs are shown against ours but never count toward gold, bests or totals.
 */
export type Side = 'ours' | 'other';
/** A fight needs this many players before the roster share can call it another guild's. */
export const OTHER_MIN_PLAYERS = 5;

/**
 * Which side a fight row belongs to. An officer's 'foreign' mark is another guild's. Otherwise the roster decides: at
 * least five players, under half of them Wolf Pack characters. 'live' (the open-world copy of a zone) is NOT a side:
 * measured 2026-11-11, 16 of 80 'live' fights were mostly our own raiders. `wpNames` holds our characters' names lowercased.
 */
export function rowSide(classification: string | null, players: readonly string[], wpNames: ReadonlySet<string>): Side {
  if (classification === 'foreign') return 'other';
  if (players.length < OTHER_MIN_PLAYERS) return 'ours';
  const ours = players.filter(p => wpNames.has(p.toLowerCase())).length;
  return ours * 2 < players.length ? 'other' : 'ours';
}

export type AttemptMoment = {
  encounterId: string;
  npcId: number;
  /** Absolute time of the moment. */
  atMs: number;
  /** Seconds after the attempt's first moment. */
  relSec: number;
};

export type Attempt = {
  key: string;
  raidNightId: string | null;
  /** The first moment, and the replay window around the whole attempt. */
  startMs: number;
  endMs: number;
  windowFromMs: number;
  windowToMs: number;
  /** Aligned to def.moments; null where the moment was not seen. */
  moments: (AttemptMoment | null)[];
  success: boolean;
  wiped: boolean;
  side: Side;
};

type Ev = { id: string; npc: number; startMs: number; endMs: number | null; wipe: boolean; night: string | null; side: Side };

const matches = (mo: Moment, npc: number) => mo.npcIds === 'any' || mo.npcIds.includes(npc);
const evTime = (ev: Ev, time: 'death' | 'engage') => (time === 'engage' ? ev.startMs : ev.endMs);
const usable = (ev: Ev, time: 'death' | 'engage') => (time === 'engage' ? true : !ev.wipe && ev.endMs != null);

function toEvs(def: SplitsDef, rows: EncRow[]): Ev[] {
  const ids = new Set<number>();
  for (const mo of def.moments) if (mo.npcIds !== 'any') for (const n of mo.npcIds) ids.add(n);
  const out: Ev[] = [];
  for (const r of rows) {
    if (!ids.has(r.npc_id)) continue;
    const startMs = Date.parse(r.started_at);
    if (!Number.isFinite(startMs)) continue;
    const e = r.ended_at ? Date.parse(r.ended_at) : NaN;
    out.push({ id: r.id, npc: r.npc_id, startMs, endMs: Number.isFinite(e) ? e : null, wipe: isWipe(r), night: r.raid_night_id, side: r.side ?? 'ours' });
  }
  return out;
}

/** Match the def's moments inside one attempt's encounters. Returns the moments aligned to def.moments. */
export function resolveMoments(def: SplitsDef, evs: Ev[]): (AttemptMoment | null)[] {
  const out: (AttemptMoment | null)[] = def.moments.map(() => null);
  const usedDeath = new Set<string>();
  const put = (i: number, ev: Ev, time: 'death' | 'engage') => {
    out[i] = { encounterId: ev.id, npcId: ev.npc, atMs: evTime(ev, time) as number, relSec: 0 };
  };
  let i = 0;
  while (i < def.moments.length) {
    const mo = def.moments[i];
    const time = mo.time ?? 'death';
    if (mo.group) {
      let j = i;
      while (j < def.moments.length && def.moments[j].group === mo.group) j++;
      const union = new Set<number>();
      for (let k = i; k < j; k++) { const n = def.moments[k].npcIds; if (n !== 'any') n.forEach(x => union.add(x)); }
      const cands = evs
        .filter(ev => union.has(ev.npc) && usable(ev, time) && !(time === 'death' && usedDeath.has(ev.id)))
        .sort((a, b) => (evTime(a, time) as number) - (evTime(b, time) as number) || a.id.localeCompare(b.id));
      const seen = new Set<number>();
      let slot = i;
      for (const ev of cands) {
        if (slot >= j) break;
        if (!def.generic) { if (seen.has(ev.npc)) continue; seen.add(ev.npc); }
        put(slot++, ev, time);
        if (time === 'death') usedDeath.add(ev.id);
      }
      i = j;
      continue;
    }
    const ev = evs
      .filter(e => matches(mo, e.npc) && usable(e, time) && !(time === 'death' && mo.npcIds !== 'any' && usedDeath.has(e.id)))
      .sort((a, b) => (evTime(a, time) as number) - (evTime(b, time) as number) || a.id.localeCompare(b.id))[0];
    if (ev) {
      put(i, ev, time);
      // An 'any' start is only a clock anchor; it must not use up a kill another moment wants.
      if (time === 'death' && mo.npcIds !== 'any') usedDeath.add(ev.id);
    }
    i++;
  }
  const t0 = Math.min(...out.filter((x): x is AttemptMoment => !!x).map(x => x.atMs));
  for (const x of out) if (x) x.relSec = Math.round((x.atMs - t0) / 1000);
  return out;
}

function succeeded(def: SplitsDef, moments: (AttemptMoment | null)[]): boolean {
  if (def.generic) return def.moments.some((mo, i) => mo.kind === 'kill' && moments[i]);
  const e = def.moments.findIndex(mo => mo.kind === 'end');
  return e >= 0 && !!moments[e];
}

/** Group one event's encounter rows into attempts, newest last. */
export function buildAttempts(def: SplitsDef, rows: EncRow[]): Attempt[] {
  // Side first: two guilds' fights on one night interleave in time and must never share an attempt.
  const evs = toEvs(def, rows).sort((a, b) =>
    a.side.localeCompare(b.side) || (a.night ?? '').localeCompare(b.night ?? '') || a.startMs - b.startMs || a.id.localeCompare(b.id));
  const start = def.moments.find(mo => mo.kind === 'start');
  const end = def.moments.find(mo => mo.kind === 'end');
  const isStartEv = (ev: Ev) => !!start && start.npcIds !== 'any' && start.npcIds.includes(ev.npc)
    && ((start.time ?? 'death') === 'engage' || (!ev.wipe && ev.endMs != null));
  const isEndEv = (ev: Ev) => !!end && end.npcIds !== 'any' && end.npcIds.includes(ev.npc) && !ev.wipe && ev.endMs != null;

  const groups: Ev[][] = [];
  let cur: Ev[] = [];
  let curLast = 0;
  for (const ev of evs) {
    if (cur.length) {
      const sameNight = cur[0].night === ev.night && cur[0].side === ev.side;
      const gap = ev.startMs - curLast > ATTEMPT_GAP_MS;
      const secondStart = isStartEv(ev) && cur.some(isStartEv);
      const afterEnd = cur.some(isEndEv);
      if (!sameNight || gap || secondStart || afterEnd) { groups.push(cur); cur = []; }
    }
    cur.push(ev);
    curLast = cur.length === 1 ? (ev.endMs ?? ev.startMs) : Math.max(curLast, ev.endMs ?? ev.startMs);
  }
  if (cur.length) groups.push(cur);

  const out: Attempt[] = [];
  for (const g of groups) {
    const moments = resolveMoments(def, g);
    if (!moments.some(Boolean)) continue;
    const times = moments.filter((x): x is AttemptMoment => !!x).map(x => x.atMs);
    const startMs = Math.min(...times);
    const endMs = Math.max(...times);
    const winFrom = Math.min(...g.map(e => e.startMs));
    const winTo = Math.max(...g.map(e => e.endMs ?? e.startMs));
    out.push({
      key: `${g[0].side === 'other' ? 'other-' : ''}${g[0].night ?? 'none'}-${startMs}`,
      side: g[0].side,
      raidNightId: g[0].night,
      startMs, endMs,
      windowFromMs: winFrom - REPLAY_MARGIN_MS,
      windowToMs: winTo + REPLAY_MARGIN_MS,
      moments,
      success: succeeded(def, moments),
      wiped: g.some(e => e.wipe),
    });
  }
  return out.sort((a, b) => a.startMs - b.startMs);
}

/** Our own attempts: the only ones gold, bests, success counts and the index summary may use. */
export const oursOnly = <T extends { side: Side }>(attempts: readonly T[]): T[] => attempts.filter(a => a.side === 'ours');

export const parseHref = (encounterId: string) => `https://wolfpack.quest/parses/${encounterId}`;
export const replayHref = (a: Pick<Attempt, 'windowFromMs' | 'windowToMs'>) =>
  `https://wolfpack.quest/raid/session?from=${encodeURIComponent(new Date(a.windowFromMs).toISOString())}&to=${encodeURIComponent(new Date(a.windowToMs).toISOString())}`;
