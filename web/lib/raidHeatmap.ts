// web/lib/raidHeatmap.ts — pure helpers behind the raid-attendance heatmaps.
//
// Two surfaces share this (Hitya, 2026-09-03): the member's own attendance on
// /me ("mouse over on dates and raid names and links to the raids") and the
// guild-wide /raidhistory page ("a scale from red at half raiders to green
// full raiders, orange middle of the way").
//
// Shape (Hitya, 2026-09-04: the week×weekday grid "looks odd … come up with a
// better format that is both mobile and desktop friendly"): nights are grouped
// by MONTH, and each night is a chip carrying its weekday and day number. A
// month block stacks on a phone and tiles on a desktop; with only three raid
// days a week there is no empty grid to draw around them.
//
// Data model (settled against live rows, 2026-09-03; corrected 2026-09-04):
//   · `opendkp_raids.ts` is stamped NOON UTC on the day the row was CREATED,
//     which is usually the raid day but is the evening BEFORE whenever an
//     officer pre-creates the next raid ("9-2-26 Seru + Kael" is stamped Sep 1,
//     "8-23-26 Vex Thal" Aug 22, "7-23-26 Seru + Misc" Jul 22). That is what
//     put raids on Tuesday and Saturday rows. The officer's own date in the
//     raid NAME is the night — see raidNightKey.
//   · Some OpenDKP "raids" are not nights at all: first-time-kill bonus rows,
//     sign-up bonuses, holiday DKP, the DKP market. See isOfficialRaid.
//   · "Attended a raid" = present in ANY of its ticks, matching
//     /admin/attendance and /roster. Per-night raiders is the DISTINCT union
//     across every tick of every raid that night — a person is one person.
//   · Ticks with an empty attendee array are sync gaps (14 of 1,546); callers
//     drop them BEFORE handing ticks in here, exactly as /admin/attendance does.
//   · `opendkp_raids.attendance` is NOT the attendee count — it is null on 406
//     of 416 rows and `1` on the rest. Never read it for this.
//
// No React / Next imports on purpose — the root vitest suite real-imports this.

import { dayKey, RAID_TZ } from './format';

// ── Calendar ─────────────────────────────────────────────────────────────────
// All day arithmetic is done at NOON UTC on the key so a DST seam can never
// shift a date by a day (the same trick dayLabel uses).

export const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function addDays(key: string, n: number): string {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD key. */
export function weekdayOf(key: string): number {
  return new Date(key + 'T12:00:00Z').getUTCDay();
}

/** First day-key of a trailing window of `days` days ending on `endKey`. */
export function windowStart(endKey: string, days: number): string {
  return addDays(endKey, -(Math.max(1, Math.floor(days)) - 1));
}

const MONTHS_LONG = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** 'YYYY-MM' for a day-key. */
export function monthKey(date: string): string {
  return date.slice(0, 7);
}

/** 'August 2026' for 'YYYY-MM'. */
export function monthTitle(month: string): string {
  const m = Number(month.slice(5, 7)) - 1;
  return `${MONTHS_LONG[m] ?? month} ${month.slice(0, 4)}`;
}

export type MonthGroup<T> = { month: string; title: string; items: T[] };

/**
 * Nights bucketed by month. Months come newest first — the recent block is
 * what anyone opening the page is looking for, and on a phone it is the one
 * at the top — while the nights inside a month run in date order.
 */
export function groupByMonth<T extends { date: string }>(items: T[], newestFirst = true): MonthGroup<T>[] {
  const by = new Map<string, T[]>();
  for (const it of items) {
    const k = monthKey(it.date);
    let arr = by.get(k);
    if (!arr) { arr = []; by.set(k, arr); }
    arr.push(it);
  }
  const months = [...by.keys()].sort();
  if (newestFirst) months.reverse();
  return months.map(month => ({
    month, title: monthTitle(month),
    items: by.get(month)!.slice().sort((a, b) => a.date.localeCompare(b.date)),
  }));
}

/** "Thu, Aug 27 2026" for a tooltip — weekday first because that IS the raid. */
export function nightLabel(key: string): string {
  return new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
}

// ── Which raids, which night ─────────────────────────────────────────────────

// OpenDKP rows that are not nights. Hitya, 2026-09-04: "the timeline itself
// only needs to be our official raid nights … first time kill bonuses don't
// need to show up." Name-matched: the officer's label has said "Bonus" every
// time (First Time Kill Bonus, Sign Up Bonus, Thanksgiving Bonus DKP), and the
// tick descriptions on those rows are boss names rather than "Tick N".
const NOT_A_NIGHT = /\bbonus\b|\bdkp market\b|\badjust/i;
export function isOfficialRaid(name: string | null | undefined): boolean {
  return !NOT_A_NIGHT.test(String(name ?? ''));
}

// The date an officer typed into the raid name, in any of the four shapes seen
// in the table: "2026-08-05 - VT", "9-1-26 Seru + Kael", "05/13/2026 - VT 1",
// "8/9 SSRA" (no year → the stamp's year). Null when there is none.
export function dateFromName(name: string | null | undefined, fallbackYear: string): string | null {
  const s = String(name ?? '');
  let m = s.match(/\b(\d{4})-(\d{1,2})-(\d{1,2})\b/);
  if (m) return _mkKey(m[1], m[2], m[3]);
  m = s.match(/\b(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})\b/);
  if (m) return _mkKey(m[3].length === 2 ? '20' + m[3] : m[3], m[1], m[2]);
  m = s.match(/\b(\d{1,2})[-/](\d{1,2})\b/);
  if (m) return _mkKey(fallbackYear, m[1], m[2]);
  return null;
}
function _mkKey(y: string, mo: string, d: string): string | null {
  const Y = Number(y), M = Number(mo), D = Number(d);
  if (!(M >= 1 && M <= 12 && D >= 1 && D <= 31)) return null;
  const key = `${Y}-${String(M).padStart(2, '0')}-${String(D).padStart(2, '0')}`;
  const dt = new Date(key + 'T12:00:00Z');   // Feb 30 must not become a phantom night
  return dt.getUTCFullYear() === Y && dt.getUTCMonth() === M - 1 && dt.getUTCDate() === D ? key : null;
}

// The night a raid belongs to: the name's date when it lands within a few days
// of the stamp (pre-created the evening before, or entered the morning after);
// otherwise the stamp — a typo'd year ("1-14-25" on a 2026 raid) must not
// teleport a night into last year.
export const NAME_DATE_TOLERANCE_DAYS = 3;
export function raidNightKey(raid: { ts: string; name: string | null }, tz: string = RAID_TZ): string {
  const stamp = dayKey(raid.ts, tz);
  const fromName = dateFromName(raid.name, stamp.slice(0, 4));
  if (!fromName) return stamp;
  const diff = Math.abs(Date.parse(fromName + 'T12:00:00Z') - Date.parse(stamp + 'T12:00:00Z')) / 86400_000;
  return diff <= NAME_DATE_TOLERANCE_DAYS ? fromName : stamp;
}

// ── Nights ───────────────────────────────────────────────────────────────────

export type NightRaid = { raid_id: number; ts: string; name: string | null };
export type NightTick = { raid_id: number; tick_id: number; attendees?: string[] | null };

export type Night = {
  date: string;
  raids: NightRaid[];
  /** Tick ids across every raid that night — only the ticks the caller kept. */
  tickIds: number[];
  /** Distinct raiders across the night, lower-cased. Empty when the caller
   *  passed ticks without attendee arrays (the /me path only needs ids). */
  attendees: string[];
};

/**
 * Bucket OFFICIAL raids + their ticks into Eastern nights (raidNightKey).
 * Bonus rows are dropped here, and so are their ticks. Ticks whose raid is not
 * in `raids` are ignored (they belong to a raid outside the window).
 */
export function buildNights(raids: NightRaid[], ticks: NightTick[], tz: string = RAID_TZ): Map<string, Night> {
  const nightOfRaid = new Map<number, string>();
  const nights = new Map<string, Night>();
  for (const r of raids) {
    if (!r || r.raid_id == null || !r.ts) continue;
    if (!isOfficialRaid(r.name)) continue;
    const date = raidNightKey(r, tz);
    nightOfRaid.set(r.raid_id, date);
    let n = nights.get(date);
    if (!n) { n = { date, raids: [], tickIds: [], attendees: [] }; nights.set(date, n); }
    n.raids.push(r);
  }
  const seen = new Map<string, Set<string>>();
  for (const t of ticks) {
    const date = t && nightOfRaid.get(t.raid_id);
    if (!date) continue;
    const n = nights.get(date)!;
    n.tickIds.push(t.tick_id);
    if (Array.isArray(t.attendees)) {
      let s = seen.get(date);
      if (!s) { s = new Set(); seen.set(date, s); }
      for (const a of t.attendees) if (a) s.add(String(a).toLowerCase());
    }
  }
  for (const [date, s] of seen) nights.get(date)!.attendees = [...s].sort();
  for (const n of nights.values()) n.raids.sort((a, b) => a.raid_id - b.raid_id);
  return nights;
}

/** Raid names for a night, de-duplicated, in raid order. */
export function nightNames(n: Night): string[] {
  const out: string[] = [];
  for (const r of n.raids) {
    const name = (r.name || '').trim();
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

// ── Colour ───────────────────────────────────────────────────────────────────
// The platform's own tokens (web/tailwind.config.ts), not a new palette.

export const FILL_RED    = '#f85149';
export const FILL_ORANGE = '#ffa657';
export const FILL_GREEN  = '#56d364';
export const ATTENDED    = '#d29922';   // gold — "I was there"

/** Default "full raid" when raid_targets has no 60-man row set. */
export const DEFAULT_FULL_RAID = 60;

function hexToRgb(h: string): [number, number, number] {
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function mix(a: string, b: string, t: number): string {
  const [r1, g1, b1] = hexToRgb(a);
  const [r2, g2, b2] = hexToRgb(b);
  const c = (x: number, y: number) => Math.round(x + (y - x) * t);
  return '#' + [c(r1, r2), c(g1, g2), c(b1, b2)].map(v => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Hitya's scale: red at HALF a raid, orange midway, green at a FULL raid.
 * Below half stays red; at or above full stays green. `ratio` is
 * raiders / full.
 */
export function fillColor(ratio: number): string {
  const r = Number.isFinite(ratio) ? ratio : 0;
  if (r <= 0.5) return FILL_RED;
  if (r >= 1) return FILL_GREEN;
  if (r <= 0.75) return mix(FILL_RED, FILL_ORANGE, (r - 0.5) / 0.25);
  return mix(FILL_ORANGE, FILL_GREEN, (r - 0.75) / 0.25);
}

/**
 * Gold intensity for the member's own cell. A night where they were in every
 * tick is full-strength; one tick of four reads dimmer — honest about leaving
 * early, without turning it into a miss. Floor keeps "one tick" visibly gold.
 */
export function attendedAlpha(ticksAttended: number, ticksHeld: number): number {
  if (!(ticksHeld > 0) || !(ticksAttended > 0)) return 0;
  const share = Math.min(1, ticksAttended / ticksHeld);
  return Math.round((0.35 + 0.65 * share) * 100) / 100;
}

export function pct(n: number, d: number): number {
  return d > 0 ? Math.round((n / d) * 100) : 0;
}
