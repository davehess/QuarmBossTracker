// Pure helpers for /me/parses and web/components/ParseTrendChart.tsx: reading the my_parse_series
// result, the clock work (the picked zone's labels, Eastern raid nights) and the chart's scales.
// No React and no Supabase here, so it is unit-tested directly (test/parse-trend.test.js).
//
// The data is one jsonb value from the my_parse_series function (20261006200000_my_parse_series.sql),
// the same one the Mimic tab reads, so the page and the tab show the same numbers.

import { RAID_TZ, cleanBossName } from './format';

export type ParseFight = {
  t: string;               // ISO, when the fight started
  eid: string;             // encounter id, for /parses/<eid>
  npc_id: number | null;
  name: string;
  boss: boolean;           // a curated boss, not trash
  char: string;
  dps: number;
  dmg: number;
  dur: number | null;
  rank: number | null;
  usual: number | null;    // that character's typical DPS on this same mob, when there are 3+ fights
};
export type ParseNight = { night: string; fights: number; bosses: number; avg_dps: number; best_dps: number };
export type ParseCharacter = { name: string; class: string | null; active: boolean };
export type ParseSeries = {
  floor: string;
  characters: ParseCharacter[];
  total: number;
  truncated: boolean;
  fights: ParseFight[];    // oldest first
  nights: ParseNight[];    // oldest first, always covers the WHOLE window
};

/** Parses before this are not comparable (multi-uploader rows were max-merged), so none are served. */
export const PARSE_FLOOR_ISO = '2026-07-14T00:00:00Z';

const DAY = 86_400_000;
const HOUR = 3_600_000;

const num = (v: unknown): number | null => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN;
  return Number.isFinite(n) ? n : null;
};

/** Normalise the function's jsonb (or garbage / null) into a series the page can trust. */
export function readParseSeries(raw: unknown): ParseSeries {
  const o = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const list = (v: unknown): Record<string, unknown>[] =>
    (Array.isArray(v) ? v : []).filter((x): x is Record<string, unknown> => !!x && typeof x === 'object');

  const fights: ParseFight[] = [];
  for (const f of list(o.fights)) {
    const t = typeof f.t === 'string' && Number.isFinite(Date.parse(f.t)) ? f.t : null;
    const dps = num(f.dps);
    if (!t || dps == null || f.eid == null) continue;
    fights.push({
      t, eid: String(f.eid), npc_id: num(f.npc_id),
      name: typeof f.name === 'string' ? f.name : '',
      boss: f.boss === true, char: String(f.char ?? ''),
      dps, dmg: num(f.dmg) ?? 0, dur: num(f.dur), rank: num(f.rank), usual: num(f.usual),
    });
  }
  fights.sort((a, b) => Date.parse(a.t) - Date.parse(b.t));

  const nights: ParseNight[] = [];
  for (const n of list(o.nights)) {
    const avg = num(n.avg_dps);
    if (typeof n.night !== 'string' || avg == null) continue;
    nights.push({
      night: n.night, fights: num(n.fights) ?? 0, bosses: num(n.bosses) ?? 0,
      avg_dps: avg, best_dps: num(n.best_dps) ?? avg,
    });
  }
  nights.sort((a, b) => a.night.localeCompare(b.night));

  const characters: ParseCharacter[] = [];
  for (const c of list(o.characters)) {
    if (typeof c.name !== 'string' || !c.name) continue;
    characters.push({ name: c.name, class: typeof c.class === 'string' ? c.class : null, active: c.active === true });
  }

  return {
    floor: typeof o.floor === 'string' ? o.floor : PARSE_FLOOR_ISO,
    characters,
    total: num(o.total) ?? fights.length,
    truncated: o.truncated === true,
    fights, nights,
  };
}

// ── clock work ───────────────────────────────────────────────────────────────

const dtfCache = new Map<string, Intl.DateTimeFormat>();
function dtf(tz: string): Intl.DateTimeFormat {
  let f = dtfCache.get(tz);
  if (!f) {
    const opts: Intl.DateTimeFormatOptions = {
      hourCycle: 'h23', weekday: 'short', year: 'numeric', month: 'numeric', day: 'numeric',
      hour: 'numeric', minute: 'numeric', second: 'numeric',
    };
    try { f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: tz }); }
    catch { f = new Intl.DateTimeFormat('en-US', { ...opts, timeZone: RAID_TZ }); }   // a bad zone name
    dtfCache.set(tz, f);
  }
  return f;
}

type Wall = { y: number; mo: number; d: number; h: number; mi: number; s: number; wd: string };

/** The wall clock in `tz` at an instant. */
export function wallParts(ms: number, tz: string): Wall {
  const p: Record<string, string> = {};
  for (const x of dtf(tz).formatToParts(new Date(ms))) p[x.type] = x.value;
  return {
    y: +p.year, mo: +p.month, d: +p.day, h: +p.hour % 24, mi: +p.minute, s: +p.second, wd: p.weekday,
  };
}

function offsetMs(ms: number, tz: string): number {
  const w = wallParts(ms, tz);
  return Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s) - Math.floor(ms / 1000) * 1000;
}

/** The instant a wall-clock time happens in `tz` (a day past the month's end rolls over). */
export function wallToMs(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetMs(guess, tz);
  return guess - offsetMs(first, tz);     // second pass settles a DST change inside the offset
}

/**
 * The raid night an instant belongs to, as YYYY-MM-DD. Matches the function's own grouping:
 * the Eastern clock minus 6 hours, so a 1 am fight still counts toward the night that began the evening before.
 */
export function nightKey(ms: number): string {
  const w = wallParts(ms, RAID_TZ);
  return new Date(Date.UTC(w.y, w.mo - 1, w.d, w.h - 6, w.mi, w.s)).toISOString().slice(0, 10);
}

/** "Sun Oct 4, 9:17 pm" (or "Sun 9:17 pm" without the date) in `tz`. */
export function fmtWhen(ms: number, tz: string, withDate = true): string {
  const w = wallParts(ms, tz);
  const mon = new Date(Date.UTC(2000, w.mo - 1, 1)).toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const h12 = w.h % 12 === 0 ? 12 : w.h % 12;
  const clock = `${h12}:${String(w.mi).padStart(2, '0')} ${w.h < 12 ? 'am' : 'pm'}`;
  return withDate ? `${w.wd} ${mon} ${w.d}, ${clock}` : `${w.wd} ${clock}`;
}

export const fmtInt = (n: number): string => Math.round(n).toLocaleString('en-US');

/** How a fight compares with the character's usual on that mob: whole percent, or null when there is no usual. */
export function vsUsualPct(dps: number, usual: number | null): number | null {
  if (usual == null || usual <= 0) return null;
  return Math.round(((dps - usual) / usual) * 100);
}

// ── scales ───────────────────────────────────────────────────────────────────

const NICE = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10];

/** The top of the DPS axis: the smallest round number at or above the largest value (never under 10). */
export function niceTop(maxVal: number): number {
  const v = Math.max(10, maxVal);
  const mag = Math.pow(10, Math.floor(Math.log10(v)));
  for (const n of NICE) if (n * mag >= v - 1e-9) return n * mag;
  return 10 * mag;
}

export type Tick = { ms: number; label: string; labelMs: number; mark: boolean };

const MONTH_DAY = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d)).toLocaleString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' });
const WEEKDAY = (y: number, mo: number, d: number) =>
  new Date(Date.UTC(y, mo - 1, d, 12)).toLocaleString('en-US', { weekday: 'short', timeZone: 'UTC' });

/**
 * x-axis labels for [lo, hi] in `tz`. Up to a day and a half: every 6 hours. Up to a week: one weekday label
 * per day, centred on the day. Longer: a date label every few days. `mark` draws a tick on the axis (a day
 * boundary or an hour); `labelMs` is where the label is centred.
 */
export function xTicks(lo: number, hi: number, tz: string): Tick[] {
  const span = hi - lo;
  const first = wallParts(lo, tz);
  const out: Tick[] = [];

  if (span <= 36 * HOUR) {
    for (let day = 0; day <= 3; day++) {
      for (const h of [0, 6, 12, 18]) {
        const ms = wallToMs(first.y, first.mo, first.d + day, h, 0, tz);
        if (ms < lo || ms > hi) continue;
        const label = h === 0
          ? wallParts(ms, tz).wd
          : `${h % 12 === 0 ? 12 : h % 12} ${h < 12 ? 'am' : 'pm'}`;
        out.push({ ms, label, labelMs: ms, mark: true });
      }
    }
    return out;
  }

  const days = Math.ceil(span / DAY) + 1;
  const step = span <= 7.5 * DAY ? 1 : [2, 3, 7, 14, 30, 60, 120].find(s => Math.ceil(span / DAY / s) <= 8) ?? 180;
  for (let i = 0; i <= days; i += step) {
    const c = new Date(Date.UTC(first.y, first.mo - 1, first.d + i));
    const y = c.getUTCFullYear(), mo = c.getUTCMonth() + 1, d = c.getUTCDate();
    const start = wallToMs(y, mo, d, 0, 0, tz);
    const end = wallToMs(y, mo, d + 1, 0, 0, tz);
    // Centre on the part of the day that is inside the window; a sliver too small to hold a label gets none.
    const from = Math.max(lo, start), to = Math.min(hi, end);
    const mark = start >= lo && start <= hi;
    if (to - from < 8 * HOUR) { if (mark) out.push({ ms: start, label: '', labelMs: start, mark }); continue; }
    out.push({
      ms: start, mark, labelMs: (from + to) / 2,
      label: span <= 7.5 * DAY ? WEEKDAY(y, mo, d) : MONTH_DAY(y, mo, d),
    });
  }
  return out;
}

// ── the chart model ──────────────────────────────────────────────────────────

export type TrendDot = { eid: string; x: number; y: number; boss: boolean; title: string };
export type TrendAvg = { x: number; y: number; avg: number; title: string };
export type TrendModel = {
  dots: TrendDot[];        // x and y are 0..1 fractions of the plot: x left to right, y bottom to top
  avgs: TrendAvg[];        // oldest first
  top: number;             // DPS at y = 1
  xTicks: (Tick & { x: number; labelX: number })[];
  hasOther: boolean;       // any non-boss dots, for the legend
  spanDays: number;
};

/**
 * Lay a series out as fractions of the plot. `sinceMs` is the window's start (null = lifetime, which starts
 * at the first night with data). Each night's average sits at the middle of that night's fights (or 10 pm
 * Eastern when none of them came back, which is a window cut at 400 fights).
 */
export function buildTrend(
  series: ParseSeries,
  o: { sinceMs: number | null; nowMs: number; tz: string; multiChar?: boolean },
): TrendModel {
  const floorMs = Date.parse(series.floor) || Date.parse(PARSE_FLOOR_ISO);
  const fightMs = series.fights.map(f => Date.parse(f.t));

  // A night's average goes at the mean time of its fights that came back.
  const sums = new Map<string, { s: number; n: number }>();
  series.fights.forEach((f, i) => {
    const k = nightKey(fightMs[i]);
    const a = sums.get(k) ?? { s: 0, n: 0 };
    a.s += fightMs[i]; a.n += 1;
    sums.set(k, a);
  });
  const avgAt = (night: string): number => {
    const a = sums.get(night);
    if (a) return a.s / a.n;
    const [y, mo, d] = night.split('-').map(Number);
    return wallToMs(y, mo, d, 22, 0, RAID_TZ);
  };
  const avgMs = series.nights.map(n => avgAt(n.night));

  let lo: number;
  if (o.sinceMs != null) {
    lo = Math.max(o.sinceMs, floorMs);
  } else {
    const earliest = Math.min(...fightMs, ...avgMs, o.nowMs);
    const w = wallParts(Math.max(earliest, floorMs), o.tz);
    lo = wallToMs(w.y, w.mo, w.d, 0, 0, o.tz);          // the start of the first day with data
  }
  const hi = Math.max(o.nowMs, ...fightMs, ...avgMs);
  if (hi - lo < 6 * HOUR) lo = hi - DAY;
  const span = hi - lo;
  const xOf = (ms: number) => Math.min(1, Math.max(0, (ms - lo) / span));

  const maxVal = Math.max(0, ...series.fights.map(f => f.dps), ...series.nights.map(n => n.avg_dps));
  const top = niceTop(maxVal * 1.04);
  const yOf = (dps: number) => Math.min(1, Math.max(0, dps / top));

  const withDate = span > 7 * DAY;
  const dots: TrendDot[] = series.fights.map((f, i) => ({
    eid: f.eid,
    x: xOf(fightMs[i]),
    y: yOf(f.dps),
    boss: f.boss,
    title: `${cleanBossName(f.name)} · ${fmtInt(f.dps)} dps · ${fmtWhen(fightMs[i], o.tz, withDate)}${o.multiChar && f.char ? ` · ${f.char}` : ''}`,
  }));

  // The night's own date names it ("Sun Oct 4 night"), not the clock time of the dot: a 1 am fight is still
  // part of the night that began the evening before.
  const nightName = (night: string) => {
    const [y, mo, d] = night.split('-').map(Number);
    return withDate ? `${WEEKDAY(y, mo, d)} ${MONTH_DAY(y, mo, d)}` : WEEKDAY(y, mo, d);
  };
  const avgs: TrendAvg[] = series.nights
    .map((n, i) => ({
      ms: avgMs[i],
      point: {
        x: xOf(avgMs[i]),
        y: yOf(n.avg_dps),
        avg: n.avg_dps,
        title: `${nightName(n.night)} night · average ${fmtInt(n.avg_dps)} dps · best ${fmtInt(n.best_dps)} `
          + `· ${n.fights} ${n.fights === 1 ? 'fight' : 'fights'}`,
      } as TrendAvg,
    }))
    .sort((a, b) => a.ms - b.ms)
    .map(a => a.point);

  const ticks = xTicks(lo, hi, o.tz).map(t => ({ ...t, x: xOf(t.ms), labelX: xOf(t.labelMs) }));

  return { dots, avgs, top, xTicks: ticks, hasOther: series.fights.some(f => !f.boss), spanDays: span / DAY };
}
