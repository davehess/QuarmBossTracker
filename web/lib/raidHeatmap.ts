// web/lib/raidHeatmap.ts — pure helpers behind the raid-attendance heatmaps.
//
// Two surfaces share this (Hitya, 2026-09-03): the member's own attendance on
// /me ("mouse over on dates and raid names and links to the raids") and the
// guild-wide /raidhistory page ("a scale from red at half raiders to green
// full raiders, orange middle of the way"). Both are a GitHub-style grid — one
// column per week, one row per weekday — because that is the shape Hitya drew.
//
// What makes the grid ours rather than a generic contribution graph: the
// guild raids Sun/Wed/Thu, so only those three rows are labelled and only
// those three rows ever light up. The cadence is visible in the structure
// itself; a stray Saturday raid stands out as exactly that.
//
// Data model (settled against live rows, 2026-09-03):
//   · `opendkp_raids.ts` is stamped NOON UTC on the raid's calendar day, so
//     the Eastern day-key of `ts` is the night. 416 raids fall on 389 nights —
//     25 nights carry two raids (e.g. "7-22-26 SSRA" and "7-23-26 Seru + Misc"
//     both stamped 2026-07-22), and both belong to that one night's cell.
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

export const RAID_WEEKDAYS: ReadonlyMap<number, string> = new Map([
  [0, 'Sun'], [3, 'Wed'], [4, 'Thu'],
]);

export function addDays(key: string, n: number): string {
  const d = new Date(key + 'T12:00:00Z');
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, for a YYYY-MM-DD key. */
export function weekdayOf(key: string): number {
  return new Date(key + 'T12:00:00Z').getUTCDay();
}

/**
 * The grid: `weeks` columns, each an array of SEVEN day-keys Sunday → Saturday.
 * The last column is the week containing `endKey`; days after `endKey` in that
 * column are '' so the renderer can leave the future blank rather than drawing
 * cells for nights that have not happened.
 */
export function buildWeeks(endKey: string, weeks: number): string[][] {
  const n = Math.max(1, Math.floor(weeks));
  const lastSunday = addDays(endKey, -weekdayOf(endKey));
  const firstSunday = addDays(lastSunday, -7 * (n - 1));
  const out: string[][] = [];
  for (let w = 0; w < n; w++) {
    const sunday = addDays(firstSunday, 7 * w);
    const col: string[] = [];
    for (let d = 0; d < 7; d++) {
      const k = addDays(sunday, d);
      col.push(k > endKey ? '' : k);
    }
    out.push(col);
  }
  return out;
}

/** First day-key on the grid — the query window's lower bound. */
export function gridStart(weeks: string[][]): string {
  return weeks[0]?.[0] ?? '';
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * One label per column, or null. A column is labelled when its Sunday falls in
 * a different month from the previous column's Sunday. The first column is
 * labelled too, unless the second column already starts a new month — two
 * labels 14px apart would overprint each other.
 */
export function monthLabels(weeks: string[][]): (string | null)[] {
  const monthOf = (col: string[]) => Number(col[0].slice(5, 7)) - 1;
  return weeks.map((col, i) => {
    const m = monthOf(col);
    if (i === 0) {
      const next = weeks[1] ? monthOf(weeks[1]) : m;
      return next === m ? MONTHS[m] : null;
    }
    return m === monthOf(weeks[i - 1]) ? null : MONTHS[m];
  });
}

/** "Thu, Aug 27 2026" for a tooltip — weekday first because that IS the raid. */
export function nightLabel(key: string): string {
  return new Date(key + 'T12:00:00Z').toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });
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
 * Bucket raids + their ticks into Eastern nights. Ticks whose raid is not in
 * `raids` are ignored (they belong to a raid outside the window).
 */
export function buildNights(raids: NightRaid[], ticks: NightTick[], tz: string = RAID_TZ): Map<string, Night> {
  const nightOfRaid = new Map<number, string>();
  const nights = new Map<string, Night>();
  for (const r of raids) {
    if (!r || r.raid_id == null || !r.ts) continue;
    const date = dayKey(r.ts, tz);
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
