// Pure helpers for /me/parses and web/components/ParseTrendChart.tsx: reading the my_parse_series
// result, the clock work (the picked zone's labels, Eastern raid nights) and the chart's scales.
// No React and no Supabase here, so it is unit-tested directly (test/parse-trend.test.js).
//
// The data is one jsonb value from the my_parse_series_v2 function (20261007000000_my_parse_series_v2.sql:
// the first version, 20261006200000, plus a zone filter, a mob search and the zone/mob lists for their
// pickers), the same one the Mimic tab reads, so the page and the tab show the same numbers.

import { RAID_TZ, cleanBossName } from './format';

export type ParseFight = {
  t: string;               // ISO, when the fight started
  eid: string;             // encounter id, for /parses/<eid>
  npc_id: number | null;
  name: string;
  zone_id: number | null;  // the mob's zone (npc id / 1000)
  zone: string | null;     // that zone's long name, when the catalog has it
  boss: boolean;           // a curated boss, not trash
  char: string;
  dps: number;
  dmg: number;
  dur: number | null;
  rank: number | null;
  usual: number | null;    // that character's typical DPS on this same mob, when there are 3+ fights
};
export type ParseNight = { night: string; fights: number; bosses: number; avg_dps: number; best_dps: number };
/** One entry of the Zone picker: every zone with fights in the window and scope, before the zone/search filters. */
export type ParseZoneFacet = { id: number; name: string; fights: number };
/** One entry of the mob search's suggestions (the 300 most fought), same basis as the zones. */
export type ParseMobFacet = { name: string; fights: number };
export type ParseCharacter = {
  name: string;
  class: string | null;
  active: boolean;
  hidden: boolean;         // the owner's "Hide from lists" switch on /me, or guild rank Trader
  fights: number;          // fights in the requested window, bosses and trash, whatever the scope switch says
  recent: number;          // fights in the last 30 days
};
export type ParseSeries = {
  floor: string;
  characters: ParseCharacter[];
  total: number;
  truncated: boolean;
  fights: ParseFight[];    // oldest first
  nights: ParseNight[];    // oldest first, always covers the WHOLE window (of the zone/search filters, if any)
  zones: ParseZoneFacet[]; // busiest first
  mobs: ParseMobFacet[];   // busiest first
};

// ── the zone and mob filters ─────────────────────────────────────────────────

// These two mirror cleanZone / cleanSearch in utils/myParses.js (the bot's /api/agent/my-parses): the page and
// Mimic read one function, so they take the same inputs. test/parse-trend.test.js runs both over one corpus.
const ZONE_MAX = 999;
export const SEARCH_MAX_LEN = 40;
const SEARCH_RX = /^[A-Za-z0-9 '`_-]+$/;

/** ?zone= as a zone id (an integer 1..999), or null when absent or not one. */
export function cleanZoneParam(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!/^\d{1,3}$/.test(s)) return null;
  const n = Number(s);
  return n >= 1 && n <= ZONE_MAX ? n : null;
}

/** ?q= as a mob-name search (trimmed, up to 40 name-shaped characters), or null when absent or not one. */
export function cleanSearchParam(raw: unknown): string | null {
  if (typeof raw !== 'string') return null;
  const s = raw.trim();
  if (!s || s.length > SEARCH_MAX_LEN || !SEARCH_RX.test(s)) return null;
  return s;
}

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
      zone_id: num(f.zone_id),
      zone: typeof f.zone === 'string' && f.zone.trim() ? f.zone : null,
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
    characters.push({
      name: c.name, class: typeof c.class === 'string' ? c.class : null, active: c.active === true,
      hidden: c.hidden === true,
      fights: Math.max(0, num(c.fights) ?? 0),
      recent: Math.max(0, num(c.recent) ?? 0),
    });
  }

  // The picker lists, busiest first. An older function (no v2) sends neither, which reads as empty pickers.
  const byBusy = (a: { fights: number; name: string }, b: { fights: number; name: string }) =>
    b.fights - a.fights || a.name.localeCompare(b.name);
  const zones: ParseZoneFacet[] = [];
  for (const z of list(o.zones)) {
    const id = num(z.id);
    if (id == null) continue;
    zones.push({
      id, name: typeof z.name === 'string' && z.name.trim() ? z.name : `Zone ${id}`,
      fights: Math.max(0, num(z.fights) ?? 0),
    });
  }
  zones.sort(byBusy);
  const mobs: ParseMobFacet[] = [];
  for (const m of list(o.mobs)) {
    if (typeof m.name !== 'string' || !m.name.trim()) continue;
    mobs.push({ name: m.name, fights: Math.max(0, num(m.fights) ?? 0) });
  }
  mobs.sort(byBusy);

  return {
    floor: typeof o.floor === 'string' ? o.floor : PARSE_FLOOR_ISO,
    characters,
    total: num(o.total) ?? fights.length,
    truncated: o.truncated === true,
    fights, nights, zones, mobs,
  };
}

/**
 * The character chips: who gets one up front and who is tucked behind "+N more" (the guild lead, 2026-10-06:
 * "My expectation on this list is mains and real alts"). `shown` = not hidden AND fought in the window or in
 * the last 30 days, busiest first (then by name). `folded` = everything else, the ones that merely have no
 * recent fights first (busiest first) and the hidden ones last. The character picked with ?char= is always in
 * `shown`, so the chip you are on never disappears behind the fold.
 */
export function splitCharChips(
  characters: ParseCharacter[], activeChar: string | null,
): { shown: ParseCharacter[]; folded: ParseCharacter[] } {
  const byBusy = (a: ParseCharacter, b: ParseCharacter) => b.fights - a.fights || a.name.localeCompare(b.name);
  const picked = (activeChar ?? '').toLowerCase();
  const shown: ParseCharacter[] = [];
  const quiet: ParseCharacter[] = [];
  const hidden: ParseCharacter[] = [];
  for (const c of characters) {
    if (picked && c.name.toLowerCase() === picked) shown.push(c);
    else if (c.hidden) hidden.push(c);
    else if (c.fights > 0 || c.recent > 0) shown.push(c);
    else quiet.push(c);
  }
  return {
    shown: shown.sort(byBusy),
    folded: [...quiet.sort(byBusy), ...hidden.sort(byBusy)],
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

// ── the list by day ──────────────────────────────────────────────────────────

/** "Sun Oct 4" for a raid-night key (YYYY-MM-DD). The key is already a calendar date, so no zone is applied. */
export function fmtNight(night: string): string {
  const [y, mo, d] = night.split('-').map(Number);
  return `${WEEKDAY(y, mo, d)} ${MONTH_DAY(y, mo, d)}`;
}

export type NightGroup = {
  night: string;           // YYYY-MM-DD, the Eastern raid night (see nightKey)
  summary: ParseNight;     // the function's numbers for the whole night (derived from `fights` if it sent none)
  fights: ParseFight[];    // this night's fights that are in the list, newest first
};

/**
 * The fights in raid-night groups for the "By day" list, newest night first and each night's fights newest
 * first. The numbers come from the function's `nights` summary, which covers the whole window and so can count
 * more fights than the list holds (a window cut at the fetch cap); a night with no fights in the list gets no
 * group, and a fight whose night the summary lacks gets one derived from its own group. The input order does
 * not matter and is not changed.
 */
export function groupByNight(fights: ParseFight[], nights: ParseNight[]): NightGroup[] {
  const sent = new Map(nights.map(n => [n.night, n]));
  const byNight = new Map<string, ParseFight[]>();
  for (const f of fights) {
    const k = nightKey(Date.parse(f.t));
    const g = byNight.get(k);
    if (g) g.push(f); else byNight.set(k, [f]);
  }
  const newestFirst = (a: ParseFight, b: ParseFight) => Date.parse(b.t) - Date.parse(a.t) || b.eid.localeCompare(a.eid);
  return [...byNight.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([night, group]) => {
      const rows = [...group].sort(newestFirst);
      const dps = rows.map(f => f.dps);
      return {
        night,
        fights: rows,
        summary: sent.get(night) ?? {
          night, fights: rows.length, bosses: rows.filter(f => f.boss).length,
          avg_dps: Math.round(dps.reduce((s, v) => s + v, 0) / dps.length), best_dps: Math.max(...dps),
        },
      };
    });
}

/** "Sun Oct 4 · 12 fights · avg 142 · best 210", the header over a night's rows. */
export function nightHeading(s: ParseNight): string {
  return `${fmtNight(s.night)} · ${s.fights} ${s.fights === 1 ? 'fight' : 'fights'}`
    + ` · avg ${fmtInt(s.avg_dps)} · best ${fmtInt(s.best_dps)}`;
}
