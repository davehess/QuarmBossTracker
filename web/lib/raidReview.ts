// web/lib/raidReview.ts — #80 Raid Night Review pure helpers (unit-tested).
//
// The morning-after review page (/raid/review) is a READ surface: officers and
// raiders open ONE page and see what happened last night — kills, deaths,
// slows, callouts that fired, loot — without scrolling Discord. This module
// holds the pure, side-effect-free logic the page needs; the Supabase queries
// live in the page server components (matching /parses, /rolls). No React/Next
// imports on purpose so the root vitest suite can real-import it.

// ── Deaths ───────────────────────────────────────────────────────────────────
// Faithful port of utils/parseDeaths.js `dedupParseDeaths` (#134), which is
// itself the port of web/app/parses/[id]/page.tsx's cross-uploader death dedup
// + phantom suppression. Keeping the SAME algorithm means the review's death
// list matches the parse page and the Discord card exactly — we do NOT
// re-derive a new death count. Any change to one of these three must mirror the
// others.
//
// Rules (identical to the web parse page + the bot):
//   1. Phantom suppression — if ANY single contributor reported a name dying
//      ≥2 times in one encounter, drop that name entirely for that encounter (a
//      real player dies once per fight; a repeat is an NPC namesake mis-credited
//      to the player — the "Syphon" case).
//   2. Window dedup — collect survivors across contributors, sort by (name, ts),
//      and drop any within DEATH_DEDUP_MS of the last KEPT death for that name.
//      Cross-parser clock skew collapses; a real rez-and-die stays separate.
export const DEATH_DEDUP_MS = 30_000;

export type RawDeath = { name: string; ts: string | number; class?: string | null; riposteDeath?: boolean };
export type DeathRow = { name: string; count: number; class: string | null; riposteDeath: boolean; ts: string | number };

function _tsMs(ts: string | number): number {
  if (typeof ts === 'number') return Number.isFinite(ts) ? ts : 0;
  const n = Date.parse(ts);
  return Number.isFinite(n) ? n : 0;
}

// contribDeaths: one entry per contributor/upload FOR ONE ENCOUNTER, each a raw
// death array. Returns per-name display rows ordered by first (earliest) death
// time. Phantom detection is per-encounter — dying in fight A and fight B is a
// legitimate ×2, so callers run this once per encounter.
export function dedupEncounterDeaths(contribDeaths: (RawDeath[] | null | undefined)[] | null | undefined): DeathRow[] {
  const contribs = Array.isArray(contribDeaths) ? contribDeaths : [];

  // 1. Phantom names — any single contributor reporting a name ≥2 times.
  const phantomNames = new Set<string>();
  for (const arr of contribs) {
    const perName = new Map<string, number>();
    for (const d of (Array.isArray(arr) ? arr : [])) {
      if (!d || !d.name) continue;
      const k = String(d.name).toLowerCase();
      perName.set(k, (perName.get(k) || 0) + 1);
    }
    for (const [k, n] of perName) if (n >= 2) phantomNames.add(k);
  }

  // 2. Collect survivors across contributors (skip phantom names).
  const collected: RawDeath[] = [];
  for (const arr of contribs) {
    for (const d of (Array.isArray(arr) ? arr : [])) {
      if (!d || !d.name) continue;
      if (phantomNames.has(String(d.name).toLowerCase())) continue;
      collected.push(d);
    }
  }

  collected.sort((a, b) =>
    String(a.name).toLowerCase().localeCompare(String(b.name).toLowerCase())
    || _tsMs(a.ts) - _tsMs(b.ts));

  const rows = new Map<string, DeathRow & { _firstMs: number }>();
  const lastKeptByName = new Map<string, number>();
  for (const d of collected) {
    const nk = String(d.name).toLowerCase();
    const t = _tsMs(d.ts);
    let row = rows.get(nk);
    if (!row) {
      row = { name: d.name, count: 0, class: d.class || null, riposteDeath: false, ts: d.ts, _firstMs: t };
      rows.set(nk, row);
    }
    if (!row.class && d.class) row.class = d.class;
    if (d.riposteDeath) row.riposteDeath = true;

    const prev = lastKeptByName.get(nk);
    if (prev != null && Math.abs(t - prev) <= DEATH_DEDUP_MS) continue;  // same death, another parser's view
    lastKeptByName.set(nk, t);
    row.count += 1;
    if (t < row._firstMs) { row._firstMs = t; row.ts = d.ts; }
  }

  return [...rows.values()]
    .sort((a, b) => a._firstMs - b._firstMs)
    .map(({ _firstMs, ...r }) => r);
}

// ── Night-level death post-processing (field feedback, 2026-07-23) ──────────
// dedupEncounterDeaths runs PER ENCOUNTER, but find_or_create_encounter's
// ±30min window means adds + boss fights OVERLAP — the same death lands in two
// encounters' contributions and shows twice ("Naggato 8:36 on a glyph covered
// serpent" AND "on Vyzh`dra the Exiled"). Night rule from the guild lead:
// "assume people can't die twice in the same minute" — collapse same-name
// deaths within 60s ACROSS encounters, keeping the earliest row (and its boss
// attribution).
export const NIGHT_DEATH_DEDUP_MS = 60_000;

export function dedupNightDeaths<T extends { name: string; ts: string | number }>(
  rows: T[] | null | undefined, windowMs = NIGHT_DEATH_DEDUP_MS,
): T[] {
  const sorted = [...(Array.isArray(rows) ? rows : [])].sort((a, b) => _tsMs(a.ts) - _tsMs(b.ts));
  const lastKept = new Map<string, number>();
  const out: T[] = [];
  for (const r of sorted) {
    if (!r || !r.name) continue;
    const k = String(r.name).toLowerCase();
    const t = _tsMs(r.ts);
    const prev = lastKept.get(k);
    if (prev != null && Math.abs(t - prev) <= windowMs) continue;   // same death, other encounter's view
    lastKept.set(k, t);
    out.push(r);
  }
  return out;
}

// Pets vs players: a death row that resolves to NO class (not in the guild
// characters table, no class in any contribution) is a pet or untracked
// entity — Xasaner/Jarer/Zonekab-style pet names. The guild lead's call:
// pet deaths are noise on the main list; keep them out of the timeline but
// surface a muted summary (owner attribution is a future agent-side feature —
// the death log line doesn't carry the owner).
export function partitionDeaths<T extends { class: string | null }>(rows: T[] | null | undefined): { players: T[]; pets: T[] } {
  const players: T[] = [], pets: T[] = [];
  for (const r of (Array.isArray(rows) ? rows : [])) (r && r.class ? players : pets).push(r);
  return { players, pets };
}

// ── Night activity span ──────────────────────────────────────────────────────
// The slows/mechanics queries pull the whole Eastern DAY, but daytime grinding
// (myconid slows at 2pm) isn't raid review material. Bound those sections to
// the actual fight span: [first encounter start − pad, last kill + pad]. Null
// when the night has no encounters (the sections then render nothing).
export function activitySpan(
  ranges: { startMs: number; endMs: number }[] | null | undefined,
  padMs = 30 * 60_000,
): { startMs: number; endMs: number } | null {
  let s = Infinity, e = -Infinity;
  for (const r of (Array.isArray(ranges) ? ranges : [])) {
    if (r && Number.isFinite(r.startMs)) s = Math.min(s, r.startMs);
    if (r && Number.isFinite(r.endMs)) e = Math.max(e, r.endMs);
  }
  if (!Number.isFinite(s) || !Number.isFinite(e) || e < s) return null;
  return { startMs: s - padMs, endMs: e + padMs };
}

export function inSpan(ts: string | number, span: { startMs: number; endMs: number } | null): boolean {
  if (!span) return false;
  const t = _tsMs(ts);
  return t >= span.startMs && t <= span.endMs;
}

// ── Slows ────────────────────────────────────────────────────────────────────
// Known slow (attack-speed debuff) spell names, lowercased — ported from the
// agent's SLOW_SPELLS (packages/wolfpack-logsync/index.js). Slows land as a
// bystander-visible emote ("X's movements slow down") with no caster in the log
// line, so buff_casts carries target + spell + time reliably; the caster is
// only known when the observer cast it themselves. We display target + spell +
// time, which is exactly what a "was the boss slowed, and when did it fall off"
// review needs.
export const SLOW_SPELLS = new Set<string>([
  // Shaman
  'drowsy', 'walking sleep', "tagar's insects", "togor's insects", "turgur's insects", 'cripple',
  // Enchanter
  'languid pace', 'shiftless deeds', 'tepid deeds', 'forlorn deeds',
  // Boss tank-buster that is also an attack-speed slow (#142)
  'rage of ssraeshza',
]);

export function isSlowSpell(name: string | null | undefined): boolean {
  if (!name) return false;
  return SLOW_SPELLS.has(String(name).toLowerCase().replace(/`/g, "'").trim());
}

export type SlowCast = { target: string; spell_name: string; cast_at: string; observer?: string | null };
export type SlowRow = { target: string; spell: string; at: string; observer: string | null };

// Collapse the SAME slow landing witnessed by multiple observers (same
// target+spell within a window) into one row — mirrors the death dedup so a
// slow that four Mimics saw doesn't list four times. Sorted by time.
export function dedupeSlows(rows: (SlowCast | null | undefined)[] | null | undefined, windowMs = DEATH_DEDUP_MS): SlowRow[] {
  const clean = (Array.isArray(rows) ? rows : [])
    .filter((r): r is SlowCast => !!r && !!r.target && !!r.spell_name && isSlowSpell(r.spell_name))
    .map(r => ({ ...r, _t: _tsMs(r.cast_at) }))
    .filter(r => r._t > 0)
    .sort((a, b) =>
      (a.target.toLowerCase() + '|' + a.spell_name.toLowerCase())
        .localeCompare(b.target.toLowerCase() + '|' + b.spell_name.toLowerCase())
      || a._t - b._t);
  const out: SlowRow[] = [];
  const lastKept = new Map<string, number>();
  for (const r of clean) {
    const k = r.target.toLowerCase() + '|' + r.spell_name.toLowerCase();
    const prev = lastKept.get(k);
    if (prev != null && Math.abs(r._t - prev) <= windowMs) continue;
    lastKept.set(k, r._t);
    out.push({ target: r.target, spell: r.spell_name, at: r.cast_at, observer: r.observer ?? null });
  }
  return out.sort((a, b) => _tsMs(a.at) - _tsMs(b.at));
}

// ── Zoned day bounds ─────────────────────────────────────────────────────────
// UTC [start, end) for a YYYY-MM-DD wall-clock day in an IANA zone. Raid nights
// bucket by Eastern day (matching /parses' dayKey), and a review page for one
// night queries a single-night window; this turns the ET day key into the UTC
// range the queries filter on. Accurate outside the ~1h DST-transition seam,
// which never falls on midnight in US zones.
function tzOffsetMs(tz: string, date: Date): number {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  });
  const m: Record<string, string> = {};
  for (const p of dtf.formatToParts(date)) if (p.type !== 'literal') m[p.type] = p.value;
  const asUTC = Date.UTC(+m.year, +m.month - 1, +m.day, +m.hour, +m.minute, +m.second);
  return asUTC - date.getTime();
}

export function zonedDayRangeUtc(dateKey: string, tz: string): { startIso: string; endIso: string } {
  const [y, mo, d] = dateKey.split('-').map(Number);
  const startGuess = new Date(Date.UTC(y, mo - 1, d, 0, 0, 0));
  const startMs = startGuess.getTime() - tzOffsetMs(tz, startGuess);
  const endGuess = new Date(Date.UTC(y, mo - 1, d + 1, 0, 0, 0));
  const endMs = endGuess.getTime() - tzOffsetMs(tz, endGuess);
  return { startIso: new Date(startMs).toISOString(), endIso: new Date(endMs).toISOString() };
}

// Validate a /raid/review/[date] path segment as YYYY-MM-DD (real calendar
// day). Guards the dynamic route against junk before we build a query window.
export function isValidDateKey(s: string | null | undefined): boolean {
  if (!s || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, mo, d] = s.split('-').map(Number);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return false;
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}
