// Slicing one recorded NIGHT into what it was: the raid proper, an event, downtime, another guild's raid (the guild
// lead, 2026-10-23, reviewing a night that held our raid, a gap and then another guild's raid one of our members
// joined: "a way to slice out events and actual raids vs other times spent in raid").
// Pure (no React, no Supabase, no node), so the session page, the loaders, the API route and the tests share one copy.
//
// WHAT IS STORED. A SLICE is an officer-marked span of time: { id, fromMs, toMs, kind, label }. They are kept as ONE
// bot_kv row per guild (`night_slices:<guild>`, { v:1, s:[...] }), the same home and the same shape idea as the
// roster cuts (raidCuts.ts), so there is no new table. A slice is not a record of anything that happened: it is a
// label on a window, and each slice is an ordinary window to the session page (Open) and to the share flow (Share…).
// Slices do not overlap each other. A write replaces every slice that lies INSIDE the window it was made for and
// refuses to touch one that crosses the window's edge (open that slice's own window to change it).
//
// WHAT IS DERIVED (never stored): the night's named fights (kill, wipe, other-guild) as marks, the moments of mass
// death, and a first guess at the segments of the night from three sources: quiet gaps in the recording, the roster
// turning over (liveRaidWindow.ts rosterCuts: raidSplit.ts detectRaidChange, applied again inside each side), and the fights switching between
// our guild's and another guild's. The officer confirms, relabels, merges or splits the guess.
//
// MASS DEATH: at least MASS_MIN deaths of anyone inside any MASS_WINDOW_MS. Deaths arrive here as bare times (the
// loader has already deduplicated one death seen by several uploaders, and dropped pets and NPCs), never as names.
import { MINUTE_MS, type Span } from './raidReplay';
import { snapCut, type Win } from './raidSplit';
import { isWipe } from './encounterMarks';

// ── Kinds and slices ─────────────────────────────────────────────────────────

export const SLICE_KINDS = ['raid', 'event', 'other_guild', 'downtime'] as const;
export type SliceKind = (typeof SLICE_KINDS)[number];
export const KIND_LABEL: Record<SliceKind, string> = {
  raid: 'Raid',
  event: 'Event',
  other_guild: "Another guild's raid",
  downtime: 'Forming, buffing, downtime',
};
export const isKind = (v: unknown): v is SliceKind => typeof v === 'string' && (SLICE_KINDS as readonly string[]).includes(v);

export type Slice = { id: string; fromMs: number; toMs: number; kind: SliceKind; label: string };

export const slicesKey = (guild: string) => `night_slices:${guild}`;
export const MAX_LABEL = 60;
export const MAX_PER_WRITE = 40;
export const MAX_STORED = 400;
export const KEEP_DAYS = 120;

const ID_RX = /^[a-z0-9]{4,24}$/;
const DAY_MS = 24 * 60 * MINUTE_MS;

/** A label as typed -> plain text: control characters removed, runs of space folded, trimmed, at most MAX_LABEL long. */
export function cleanLabel(v: unknown): string {
  return String(v ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_LABEL);
}

export type SliceStore = { v: 1; s: Slice[] };

/** The stored value -> a store; anything malformed is skipped (an empty store when nothing is usable). */
export function parseSliceStore(value: unknown): SliceStore {
  const raw = value && typeof value === 'object' ? (value as { s?: unknown }).s : null;
  const s: Slice[] = [];
  if (Array.isArray(raw)) {
    for (const x of raw) {
      const r = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
      if (!r || typeof r.id !== 'string' || !ID_RX.test(r.id) || !isKind(r.kind)) continue;
      const fromMs = Number(r.fromMs), toMs = Number(r.toMs);
      if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) continue;
      s.push({ id: r.id, fromMs, toMs, kind: r.kind, label: cleanLabel(r.label) });
    }
  }
  return { v: 1, s: s.sort((a, b) => a.fromMs - b.fromMs) };
}

/** The slices that overlap a window, oldest first (not clipped). */
export function slicesIn(slices: readonly Slice[], win: Win): Slice[] {
  return slices.filter(x => x.toMs > win.fromMs && x.fromMs < win.toMs).sort((a, b) => a.fromMs - b.fromMs);
}

const inside = (x: { fromMs: number; toMs: number }, win: Win) => x.fromMs >= win.fromMs && x.toMs <= win.toMs;

export type SlicePlan = { error: string } | { store: SliceStore; saved: Slice[] };

/**
 * What saving `incoming` for `win` does to `store`: the slices inside the window are replaced by the incoming list
 * (an empty list clears them). Incoming times are rounded to the minute and held inside the window; a slice that is
 * empty after that is dropped; two that overlap, a bad kind, too many, or a stored slice crossing the window's edge
 * is an error and nothing changes. `newId` is called for an incoming slice with no usable (or a repeated) id.
 */
export function planSliceWrite(store: SliceStore, win: Win, incoming: unknown, newId: () => string, nowMs: number): SlicePlan {
  if (!(win.toMs > win.fromMs) || win.toMs - win.fromMs > DAY_MS) return { error: 'bad window' };
  if (!Array.isArray(incoming)) return { error: 'slices must be a list' };
  if (incoming.length > MAX_PER_WRITE) return { error: `at most ${MAX_PER_WRITE} slices at a time` };

  const used = new Set<string>();
  const saved: Slice[] = [];
  for (const x of incoming) {
    const r = x && typeof x === 'object' ? (x as Record<string, unknown>) : null;
    if (!r) return { error: 'bad slice' };
    if (!isKind(r.kind)) return { error: 'bad kind' };
    const a = Number(r.fromMs), b = Number(r.toMs);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return { error: 'bad time' };
    const fromMs = Math.max(win.fromMs, Math.round(a / MINUTE_MS) * MINUTE_MS);
    const toMs = Math.min(win.toMs, Math.round(b / MINUTE_MS) * MINUTE_MS);
    if (toMs <= fromMs) continue;
    let id = typeof r.id === 'string' && ID_RX.test(r.id) && !used.has(r.id) ? r.id : newId();
    while (used.has(id)) id = newId();
    used.add(id);
    saved.push({ id, fromMs, toMs, kind: r.kind, label: cleanLabel(r.label) });
  }
  saved.sort((a, b) => a.fromMs - b.fromMs);
  for (let i = 1; i < saved.length; i++) if (saved[i].fromMs < saved[i - 1].toMs) return { error: 'slices overlap' };

  const keep: Slice[] = [];
  for (const x of store.s) {
    if (inside(x, win)) continue;                                   // replaced by what was sent
    if (x.toMs > win.fromMs && x.fromMs < win.toMs) return { error: "a saved slice crosses this window's edge; open its own window to change it" };
    keep.push(x);
  }
  const cutoff = nowMs - KEEP_DAYS * DAY_MS;
  const all = [...keep, ...saved].filter(x => x.toMs >= cutoff).sort((a, b) => a.fromMs - b.fromMs);
  if (all.length > MAX_STORED) return { error: 'too many saved slices' };
  return { store: { v: 1, s: all }, saved };
}

// ── Editing a list of spans (shared by both editors) ─────────────────────────

type Span2 = { fromMs: number; toMs: number };

/** The room for a new slice that starts at `fromMs` and was dragged to `toMs`: cut short at the next slice, null when it starts inside one or is under a minute. */
export function fitNew(list: readonly Span2[], win: Win, fromMs: number, toMs: number): Span2 | null {
  let a = Math.round(Math.min(fromMs, toMs) / MINUTE_MS) * MINUTE_MS;
  let b = Math.round(Math.max(fromMs, toMs) / MINUTE_MS) * MINUTE_MS;
  a = Math.max(a, win.fromMs); b = Math.min(b, win.toMs);
  for (const x of list) {
    if (a >= x.fromMs && a < x.toMs) return null;
    if (x.fromMs >= a && x.fromMs < b) b = x.fromMs;
  }
  return b - a >= MINUTE_MS ? { fromMs: a, toMs: b } : null;
}

/** One edge of `list[i]` moved by `deltaMs` (minutes): held at least a minute long, inside the window and clear of its neighbours. */
export function moveEdge<T extends Span2>(list: readonly T[], i: number, edge: 'from' | 'to', deltaMs: number, win: Win): T[] {
  const x = list[i];
  if (!x) return list.slice();
  const sorted = list.map((v, k) => ({ v, k })).sort((p, q) => p.v.fromMs - q.v.fromMs);
  const pos = sorted.findIndex(p => p.k === i);
  const prev = pos > 0 ? sorted[pos - 1].v : null, next = pos < sorted.length - 1 ? sorted[pos + 1].v : null;
  const step = Math.round(deltaMs / MINUTE_MS) * MINUTE_MS;
  let { fromMs, toMs } = x;
  if (edge === 'from') fromMs = Math.min(toMs - MINUTE_MS, Math.max(prev ? prev.toMs : win.fromMs, fromMs + step));
  else toMs = Math.max(fromMs + MINUTE_MS, Math.min(next ? next.fromMs : win.toMs, toMs + step));
  return list.map((v, k) => (k === i ? { ...v, fromMs, toMs } : v));
}

// ── Named fights ─────────────────────────────────────────────────────────────

export type FightIn = {
  id: string; name: string; zone: string | null;
  startMs: number; endMs: number | null; durationSec: number | null;
  classification: string | null; isWipe?: boolean | null;
};
/** tag: whose or where the fight was, when it is not a plain guild fight ('foreign' = another guild's). */
export type FightMark = {
  id: string; name: string; zone: string | null;
  startMs: number; endMs: number; durationSec: number | null;
  result: 'kill' | 'wipe'; tag: 'foreign' | 'live' | 'pvp' | 'test' | null;
};

export function fightMark(f: FightIn): FightMark {
  const c = f.classification;
  const tag = c === 'foreign' || c === 'live' || c === 'pvp' || c === 'test' ? c : null;
  const end = f.endMs ?? f.startMs + (f.durationSec ?? 0) * 1000;
  return {
    id: f.id, name: f.name, zone: f.zone, startMs: f.startMs, endMs: Math.max(f.startMs, end), durationSec: f.durationSec,
    result: isWipe({ classification: c, is_wipe: f.isWipe }) ? 'wipe' : 'kill', tag,
  };
}

/** Marks, in the order the fights ended. */
export const markFights = (fs: readonly FightIn[]): FightMark[] => fs.map(fightMark).sort((a, b) => a.endMs - b.endMs || a.startMs - b.startMs);

// ── Deaths ───────────────────────────────────────────────────────────────────

export const MASS_WINDOW_MS = 60_000;
export const MASS_MIN = 5;
export type MassDeath = { fromMs: number; toMs: number; count: number };

/**
 * The moments of mass death in a list of death times: every run of at least `min` deaths that fit inside `windowMs`,
 * with overlapping runs joined (a wipe that takes a minute and a half is one moment of 9, not two of 5).
 */
export function massDeaths(times: readonly number[], windowMs = MASS_WINDOW_MS, min = MASS_MIN): MassDeath[] {
  const t = times.filter(Number.isFinite).slice().sort((a, b) => a - b);
  const out: { i: number; j: number }[] = [];
  let j = 0;
  for (let i = 0; i < t.length; i++) {
    if (j < i) j = i;
    while (j + 1 < t.length && t[j + 1] - t[i] <= windowMs) j++;
    if (j - i + 1 < min) continue;
    const last = out[out.length - 1];
    if (last && i <= last.j) last.j = Math.max(last.j, j);
    else out.push({ i, j });
  }
  return out.map(r => ({ fromMs: t[r.i], toMs: t[r.j], count: r.j - r.i + 1 }));
}

/** A death worth counting: a character's name, not an NPC ("an orc pawn") or a pet ("<name>`s pet"). */
export function playerDeathName(name: unknown): boolean {
  const s = String(name ?? '').trim();
  return !!s && !/^(an?|the)\s/i.test(s) && !/`s\s+(pet|warder|ward|familiar|companion)$/i.test(s);
}

/** How many deaths fell in a fight (from 5 s before it started to 15 s after it ended: the last hit and the loot-up deaths). */
export function deathsDuring(f: Pick<FightMark, 'startMs' | 'endMs'>, deaths: readonly number[]): number {
  let n = 0;
  for (const d of deaths) if (d >= f.startMs - 5_000 && d <= f.endMs + 15_000) n++;
  return n;
}

// ── What a span holds ────────────────────────────────────────────────────────

export type NightCtx = { fights: readonly FightMark[]; deaths: readonly number[]; mass: readonly MassDeath[] };
export type SpanStats = { kills: number; wipes: number; otherGuild: number; deaths: number; mass: number };

/** What happened in [fromMs, toMs): fights by the time they ENDED (the review lists them that way), deaths, mass-death moments. */
export function spanStats(s: Span2, ctx: NightCtx): SpanStats {
  const r: SpanStats = { kills: 0, wipes: 0, otherGuild: 0, deaths: 0, mass: 0 };
  for (const f of ctx.fights) {
    if (f.endMs < s.fromMs || f.endMs >= s.toMs) continue;
    if (f.tag === 'foreign') r.otherGuild++;
    else if (f.tag === null) { if (f.result === 'wipe') r.wipes++; else r.kills++; }
  }
  for (const d of ctx.deaths) if (d >= s.fromMs && d < s.toMs) r.deaths++;
  for (const m of ctx.mass) if (m.fromMs >= s.fromMs && m.fromMs < s.toMs) r.mass++;
  return r;
}

/** The kind a span's contents suggest: more other-guild fights than ours is their raid, any of ours is a raid, none is downtime. */
export function suggestKind(st: Pick<SpanStats, 'kills' | 'wipes' | 'otherGuild'>): SliceKind {
  const ours = st.kills + st.wipes;
  if (st.otherGuild > ours) return 'other_guild';
  return ours > 0 ? 'raid' : 'downtime';
}

// ── Guessing the segments of a night ─────────────────────────────────────────

export const GAP_BREAK_MS = 10 * MINUTE_MS;     // a hole in the recording this long splits the night
export const MIN_SEGMENT_MS = 10 * MINUTE_MS;   // a guessed segment shorter than this is folded into its neighbour

export type Segment = { fromMs: number; toMs: number; kind: SliceKind; label: string; why: string };

const fmtGap = (ms: number) => { const m = Math.round(ms / MINUTE_MS); return m >= 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m} min`; };
const side = (f: FightMark): 'guild' | 'other' | null => (f.tag === 'foreign' ? 'other' : f.tag === null ? 'guild' : null);

/**
 * A first guess at the segments of `win`. `spans` are the recorded stretches (NightSummary.spans), `breaks` the roster
 * turnover instants (rosterCuts). Segments tile the RECORDED time: a quiet gap of GAP_BREAK_MS or more is left out,
 * not given to a segment. Inside a stretch the cuts are the roster breaks and the hand-over between a run of our
 * fights and a run of another guild's (placed in the quiet between the two fights); a piece under MIN_SEGMENT_MS is
 * folded into its neighbour. Each segment's kind is suggestKind of what it holds. `why` says how its start was found.
 */
export function detectSegments(win: Win, spans: readonly Span[], breaks: readonly number[], ctx: NightCtx): Segment[] {
  const clipped = spans
    .map(s => ({ from: Math.max(s.from, win.fromMs), to: Math.min(s.to, win.toMs) }))
    .filter(s => s.to > s.from)
    .sort((a, b) => a.from - b.from);
  const stretches: Span[] = [];
  for (const s of clipped) {
    const last = stretches[stretches.length - 1];
    if (last && s.from - last.to < GAP_BREAK_MS) last.to = Math.max(last.to, s.to);
    else stretches.push({ from: s.from, to: s.to });
  }

  const out: Segment[] = [];
  stretches.forEach((st, si) => {
    const cuts: { at: number; why: string }[] = [];
    for (const b of breaks) {
      const at = snapCut(b, { fromMs: st.from, toMs: st.to });
      if (at != null && b > st.from && b < st.to) cuts.push({ at, why: 'the roster changed' });
    }
    const fs = ctx.fights.filter(f => f.endMs >= st.from && f.endMs < st.to && side(f)).sort((a, b) => a.endMs - b.endMs);
    for (let k = 1; k < fs.length; k++) {
      const a = fs[k - 1], b = fs[k];
      if (side(a) === side(b)) continue;
      const lo = a.endMs, hi = Math.max(lo, b.startMs);
      if (cuts.some(c => c.at >= lo && c.at <= hi)) continue;
      const at = snapCut((lo + hi) / 2, { fromMs: st.from, toMs: st.to });
      if (at != null) cuts.push({ at, why: 'our fights and another guild\'s alternate' });
    }
    cuts.sort((a, b) => a.at - b.at);
    const edges = [{ at: st.from, why: si === 0 ? '' : `after a ${fmtGap(st.from - stretches[si - 1].to)} gap in the recording` }];
    for (const c of cuts) if (c.at > edges[edges.length - 1].at) edges.push(c);
    const pieces = edges.map((e, k) => ({ fromMs: e.at, toMs: k + 1 < edges.length ? edges[k + 1].at : st.to, why: e.why }));

    // Fold the short ones into a neighbour (the previous piece, or the next one when it is first).
    for (let k = 0; k < pieces.length && pieces.length > 1;) {
      if (pieces[k].toMs - pieces[k].fromMs >= MIN_SEGMENT_MS) { k++; continue; }
      if (k > 0) { pieces[k - 1].toMs = pieces[k].toMs; pieces.splice(k, 1); }
      else { pieces[1].fromMs = pieces[0].fromMs; pieces[1].why = pieces[0].why; pieces.splice(0, 1); }
    }
    for (const p of pieces) out.push({ ...p, kind: suggestKind(spanStats(p, ctx)), label: '' });
  });
  return out;
}

/** Segments i and i+1 as one (the gap between them, if any, is covered); its kind is suggested again from what it now holds. */
export function mergeSegments(list: readonly Segment[], i: number, ctx: NightCtx): Segment[] {
  const a = list[i], b = list[i + 1];
  if (!a || !b) return list.slice();
  const m: Segment = { fromMs: a.fromMs, toMs: b.toMs, label: a.label || b.label, why: a.why, kind: 'raid' };
  m.kind = suggestKind(spanStats(m, ctx));
  return [...list.slice(0, i), m, ...list.slice(i + 2)];
}

/** Segment i cut in two at `atMs` (snapped to the minute, kept inside it). The first half keeps everything; the second gets a suggested kind. */
export function splitSegment(list: readonly Segment[], i: number, atMs: number, ctx: NightCtx): Segment[] {
  const s = list[i];
  const at = s ? snapCut(atMs, { fromMs: s.fromMs, toMs: s.toMs }) : null;
  if (!s || at == null) return list.slice();
  const first: Segment = { ...s, toMs: at };
  const second: Segment = { fromMs: at, toMs: s.toMs, label: '', why: 'split by an officer', kind: 'downtime' };
  second.kind = suggestKind(spanStats(second, ctx));
  return [...list.slice(0, i), first, second, ...list.slice(i + 1)];
}

/** The boundary between segment i and i+1 moved by `deltaMs` (both stay at least a minute long). Only for segments that touch. */
export function moveBoundary(list: readonly Segment[], i: number, deltaMs: number): Segment[] {
  const a = list[i], b = list[i + 1];
  if (!a || !b || a.toMs !== b.fromMs) return list.slice();
  const at = Math.min(b.toMs - MINUTE_MS, Math.max(a.fromMs + MINUTE_MS, a.toMs + Math.round(deltaMs / MINUTE_MS) * MINUTE_MS));
  return list.map((s, k) => (k === i ? { ...s, toMs: at } : k === i + 1 ? { ...s, fromMs: at } : s));
}

// ── The night's log ──────────────────────────────────────────────────────────

export type LogItem =
  | { kind: 'fight'; at: number; fight: FightMark; deaths: number }
  | { kind: 'mass'; at: number; mass: MassDeath; during: string | null };

/** The named fights and the moments of mass death in one list by time, each moment naming the fight it fell in (if any). */
export function nightLog(ctx: NightCtx): LogItem[] {
  const items: LogItem[] = [];
  for (const f of ctx.fights) items.push({ kind: 'fight', at: f.startMs, fight: f, deaths: deathsDuring(f, ctx.deaths) });
  for (const m of ctx.mass) {
    const f = ctx.fights.find(x => m.fromMs >= x.startMs - 5_000 && m.fromMs <= x.endMs + 15_000);
    items.push({ kind: 'mass', at: m.fromMs, mass: m, during: f ? f.name : null });
  }
  return items.sort((a, b) => a.at - b.at || (a.kind === 'fight' ? -1 : 1));
}
