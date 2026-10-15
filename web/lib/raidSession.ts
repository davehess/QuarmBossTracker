// A raid SESSION review: one time window of the guild's recording, with the replay beside what happened in it.
// The pure parts: shapes, the opt-out filters, and the builders that turn table rows into the review's sections.
// No React, no Supabase, no node: the members' page, the public share page, the loader and the tests share one
// copy of the rules. The reads themselves are in raidSessionLoad.ts.
//
// PRIVACY, in one rule: a character with `characters.exclude_from_stats` OR `exclude_inventory` set never
// appears by name in anything built here (attendance, tick lists, parses, loot, rolls, the replay's `who`).
// Recording already skips exclude_from_stats (utils/raidTrack.js); `scrubMinuteData` adds the other flag and
// covers rows recorded before either was set. Names are matched case-insensitively, and a pet that carries its
// owner's name ("<name>`s pet") is treated as the owner.

import {
  MINUTE_MS, summarizeNights, type NightMinute, type NightSummary,
} from './raidReplay';
import { displayMobName } from './replayBosses';
import {
  applyRollOverrides, attributeLoot, mergeRollSets, rollBreakdown,
  type RollLine, type RollOverride, type RollSetRow, type LootedRow,
} from './rolls';
import type { ShareWindow } from './raidShare';

// ── Opt-outs ─────────────────────────────────────────────────────────────────

export type CharFlags = { name: string; exclude_from_stats?: boolean | null; exclude_inventory?: boolean | null };

const PET_RX = /^(.+?)`s (?:pet|warder|ward|familiar|companion)$/i;
/** The key an opt-out is matched on: lowercase, trimmed, a pet reduced to its owner. */
export function nameKey(name: string | null | undefined): string {
  const s = String(name ?? '').trim().toLowerCase();
  const m = s.match(PET_RX);
  return m ? m[1].trim() : s;
}

/** Everyone who asked not to be shown, as nameKeys. A row with neither flag set adds nothing. */
export function optedOutSet(rows: readonly CharFlags[]): Set<string> {
  const out = new Set<string>();
  for (const r of rows) if (r && r.name && (r.exclude_from_stats || r.exclude_inventory)) out.add(nameKey(r.name));
  return out;
}

export const isOptedOut = (set: ReadonlySet<string>, name: string | null | undefined): boolean =>
  !!name && set.has(nameKey(name));

/** The rows whose character is NOT opted out. A row with no name has nobody to protect and stays. */
export function dropOptedOut<T>(rows: readonly T[], nameOf: (r: T) => string | null | undefined, set: ReadonlySet<string>): T[] {
  return set.size ? rows.filter(r => !isOptedOut(set, nameOf(r))) : rows.slice();
}

/**
 * One raid_track_minutes `data` blob without the opted-out raiders: their entry in `who` is blanked (so the name
 * is not in the JSON at all) and their samples are removed from every frame. Unparseable data becomes an empty
 * object, which the decoder skips; it is never passed through, since it cannot be shown to be clean.
 */
export function scrubMinuteData(data: string, optedOut: ReadonlySet<string>): string {
  if (!optedOut.size) return data;
  let d: { who?: unknown; f?: unknown };
  try { d = JSON.parse(data); } catch { return '{}'; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.who) || !Array.isArray(d.f)) return '{}';
  const gone = new Set<number>();
  d.who = d.who.map((w: unknown, i: number) => {
    if (Array.isArray(w) && typeof w[0] === 'string' && optedOut.has(nameKey(w[0]))) { gone.add(i); return null; }
    return w;
  });
  if (gone.size) {
    d.f = d.f.map((fr: unknown) => {
      if (!Array.isArray(fr)) return fr;
      const out: unknown[] = [fr[0]];
      for (let k = 1; k + 6 < fr.length; k += 7) if (!gone.has(fr[k] as number)) out.push(...fr.slice(k, k + 7));
      return out;
    });
  }
  return JSON.stringify(d);
}

// ── The bundle ───────────────────────────────────────────────────────────────

export type AttendeeRow = { name: string; cls: string | null; minutes: number; firstMs: number; lastMs: number };
export type TickRow = { label: string; atMs: number | null; source: 'captured' | 'opendkp'; names: string[] };
export type KillTop = { name: string; damage: number; dps: number | null };
export type KillRow = {
  id: string; boss: boolean; name: string; zone: string | null;
  startMs: number; endMs: number | null; durationSec: number | null;
  totalDamage: number | null; top: KillTop[];
};
export type LootEntry = {
  atMs: number | null;
  item: string;
  who: string | null;          // null: nobody recorded, or the character asked not to be shown
  whoHidden: boolean;
  dkp: number | null;
  kind: 'looted' | 'awarded' | 'opendkp';
};
export type RollEntry = {
  startMs: number; lastMs: number;
  item: string | null; from: number; to: number; zone: string | null;
  rollers: number;
  winners: { name: string; value: number }[];
  winnerHidden: boolean;        // a winner asked not to be shown
  lines: RollLine[];
  lootedBy: string[];
};

export type SessionBundle = {
  fromMs: number;
  toMs: number;
  minutesRecorded: number;
  attendance: AttendeeRow[];
  ticks: TickRow[];
  kills: KillRow[];
  loot: LootEntry[];
  rolls: RollEntry[];
};

// ── Attendance, from the recording ───────────────────────────────────────────

/**
 * Who was in the recording and for how many minutes: the `who` list of every minute row in the window. A raider
 * listed in a minute was placed in at least one frame of it, so "minutes" is minutes seen, not minutes logged in.
 * Sorted by minutes, then name.
 */
export function attendanceFromMinutes(rows: readonly { minute_at: string; data: string }[], optedOut: ReadonlySet<string>): AttendeeRow[] {
  const by = new Map<string, AttendeeRow>();
  for (const r of rows) {
    const t = Date.parse(r.minute_at);
    if (!Number.isFinite(t)) continue;
    let d: { v?: unknown; who?: unknown };
    try { d = JSON.parse(r.data); } catch { continue; }
    if (!d || d.v !== 1 || !Array.isArray(d.who)) continue;
    const seen = new Set<string>();
    for (const w of d.who as unknown[]) {
      if (!Array.isArray(w) || typeof w[0] !== 'string' || !w[0].trim()) continue;
      const key = nameKey(w[0]);
      if (optedOut.has(key) || seen.has(key) || PET_RX.test(w[0].trim())) continue;
      seen.add(key);
      const cls = typeof w[1] === 'string' && w[1] ? w[1] : null;
      const cur = by.get(key);
      if (cur) {
        cur.minutes++;
        cur.firstMs = Math.min(cur.firstMs, t);
        cur.lastMs = Math.max(cur.lastMs, t + MINUTE_MS);
        if (cls) cur.cls = cls;
      } else {
        by.set(key, { name: w[0].trim(), cls, minutes: 1, firstMs: t, lastMs: t + MINUTE_MS });
      }
    }
  }
  return [...by.values()].sort((a, b) => b.minutes - a.minutes || a.name.localeCompare(b.name));
}

/**
 * The replay's night for the board in bounded mode: the busiest night_key among the rows, with the window as its
 * first and last minute (so the board's 15-minute windows line up with the share's) and the rows' real coverage
 * as its spans. No sessions: the board plays the window as it is.
 */
export function windowNight(rows: readonly NightMinute[], win: ShareWindow): NightSummary | null {
  const nights = summarizeNights(rows.slice());
  if (!nights.length) return null;
  const n = nights.slice().sort((a, b) => b.minutes - a.minutes)[0];
  return {
    ...n,
    first: new Date(win.fromMs).toISOString(),
    last: new Date(win.toMs - MINUTE_MS).toISOString(),
    sessions: [],
  };
}

// ── Ticks ────────────────────────────────────────────────────────────────────

export type CapturedTickIn = { description: string; scheduled_for: string; names: string[] | null };
export type DkpTickIn = { description: string | null; attendees: string[] | null };

const cleanNames = (names: readonly unknown[] | null | undefined, optedOut: ReadonlySet<string>): string[] => {
  const seen = new Map<string, string>();
  for (const n of names ?? []) {
    const s = String(n ?? '').trim();
    const k = nameKey(s);
    if (s && !optedOut.has(k) && !seen.has(k)) seen.set(k, s);
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

/** The captured raid ticks (bot-staged, never submitted) and the OpenDKP ticks that fall in the window. */
export function buildTicks(captured: readonly CapturedTickIn[], dkp: readonly DkpTickIn[], optedOut: ReadonlySet<string>): TickRow[] {
  const out: TickRow[] = [];
  for (const c of captured) {
    const at = Date.parse(c.scheduled_for);
    out.push({ label: c.description, atMs: Number.isFinite(at) ? at : null, source: 'captured', names: cleanNames(c.names, optedOut) });
  }
  out.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  for (const t of dkp) {
    const names = cleanNames(t.attendees, optedOut);
    if (names.length) out.push({ label: (t.description || 'OpenDKP tick').trim(), atMs: null, source: 'opendkp', names });
  }
  return out;
}

// ── Kills and parses ─────────────────────────────────────────────────────────

export type EncounterIn = {
  id: string; npc_id: number | null;
  started_at: string; ended_at: string | null;
  duration_sec: number | null; total_damage: number | null;
  zone_short: string | null;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};
export type PlayerIn = { encounter_id: string; character_name: string; total_damage: number | null; dps: number | null };

export const TOP_PER_KILL = 5;

export function buildKills(
  encs: readonly EncounterIn[], players: readonly PlayerIn[], bossIds: ReadonlySet<number>, optedOut: ReadonlySet<string>,
): KillRow[] {
  const byEnc = new Map<string, PlayerIn[]>();
  for (const p of players) {
    const a = byEnc.get(p.encounter_id);
    if (a) a.push(p); else byEnc.set(p.encounter_id, [p]);
  }
  const out: KillRow[] = [];
  for (const e of encs) {
    const start = Date.parse(e.started_at);
    if (!Number.isFinite(start)) continue;
    const end = e.ended_at ? Date.parse(e.ended_at) : NaN;
    const t = Array.isArray(e.eqemu_npc_types) ? e.eqemu_npc_types[0] : e.eqemu_npc_types;
    const top = dropOptedOut(byEnc.get(e.id) ?? [], p => p.character_name, optedOut)
      .filter(p => typeof p.total_damage === 'number' && p.total_damage > 0 && !PET_RX.test(String(p.character_name).trim()))
      .sort((a, b) => (b.total_damage ?? 0) - (a.total_damage ?? 0) || a.character_name.localeCompare(b.character_name))
      .slice(0, TOP_PER_KILL)
      .map(p => ({ name: p.character_name, damage: p.total_damage ?? 0, dps: typeof p.dps === 'number' ? p.dps : null }));
    out.push({
      id: e.id,
      boss: e.npc_id != null && bossIds.has(e.npc_id),
      name: displayMobName(t?.name) || 'Unknown mob',
      zone: e.zone_short,
      startMs: start,
      endMs: Number.isFinite(end) ? end : null,
      durationSec: e.duration_sec,
      totalDamage: e.total_damage,
      top,
    });
  }
  return out.sort((a, b) => (a.endMs ?? a.startMs) - (b.endMs ?? b.startMs));
}

// ── Loot and rolls ───────────────────────────────────────────────────────────

export type LootedIn = LootedRow & { from_own_pet?: boolean | null };
export type ObservedIn = { item_name: string; winner_character: string | null; dkp_amount: number | null; posted_at: string };
export type DkpLootIn = { item_name: string; character_name: string; dkp: number | null };

const who = (name: string | null | undefined, optedOut: ReadonlySet<string>) =>
  name && isOptedOut(optedOut, name) ? { who: null, whoHidden: true } : { who: name ?? null, whoHidden: false };

export function buildLoot(
  looted: readonly LootedIn[], observed: readonly ObservedIn[], dkp: readonly DkpLootIn[], optedOut: ReadonlySet<string>,
): LootEntry[] {
  const out: LootEntry[] = [];
  for (const l of looted) {
    if (l.from_own_pet) continue;      // a pet's own pickup is not a drop
    const at = Date.parse(l.looted_at);
    out.push({ atMs: Number.isFinite(at) ? at : null, item: l.item_name, ...who(l.looter_character, optedOut), dkp: null, kind: 'looted' });
  }
  for (const o of observed) {
    const at = Date.parse(o.posted_at);
    out.push({ atMs: Number.isFinite(at) ? at : null, item: o.item_name, ...who(o.winner_character, optedOut), dkp: o.dkp_amount, kind: 'awarded' });
  }
  for (const d of dkp) {
    out.push({ atMs: null, item: d.item_name, ...who(d.character_name, optedOut), dkp: d.dkp, kind: 'opendkp' });
  }
  return out.sort((a, b) => (a.atMs ?? Number.MAX_SAFE_INTEGER) - (b.atMs ?? Number.MAX_SAFE_INTEGER) || a.item.localeCompare(b.item));
}

/**
 * The window's roll sessions: merged across uploaders, officer corrections applied, hidden ones dropped (a share
 * never shows what an officer hid). Opted-out rollers are removed from the lines, the winners and the looted-by
 * list. If a winner is removed the session says so (`winnerHidden`) instead of promoting the next roller.
 */
export function buildRolls(
  rows: readonly RollSetRow[], overrides: readonly RollOverride[], looted: readonly LootedRow[], optedOut: ReadonlySet<string>,
): RollEntry[] {
  const sessions = applyRollOverrides(mergeRollSets(rows.slice()), overrides.slice()).filter(s => !s.hidden);
  const out: RollEntry[] = sessions.map(s => {
    const lines = rollBreakdown(s).filter(l => !isOptedOut(optedOut, l.name));
    const winners = s.winners.filter(w => !isOptedOut(optedOut, w.name));
    const rollers = new Set(lines.map(l => nameKey(l.name))).size;
    return {
      startMs: s.startMs, lastMs: s.lastMs, item: s.item, from: s.from, to: s.to, zone: s.zone,
      rollers, winners,
      winnerHidden: winners.length < s.winners.length,
      lines,
      lootedBy: attributeLoot(s, looted.slice()).map(m => m.looter).filter(n => !isOptedOut(optedOut, n)),
    };
  });
  return out.sort((a, b) => a.startMs - b.startMs);
}
