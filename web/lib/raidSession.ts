// A raid SESSION review: one time window of the guild's recording, with the replay beside what happened in it.
// The pure parts: shapes, the opt-out labels, and the builders that turn table rows into the review's sections.
// No React, no Supabase, no node: the members' page, the public share page, the loader and the tests share one
// copy of the rules. The reads themselves are in raidSessionLoad.ts.
//
// PRIVACY, in one rule: a character with `characters.exclude_from_stats` OR `exclude_inventory` set never
// appears by name in anything built here (attendance, tick lists, parses, loot, rolls, the replay's `who`). They
// are not dropped: they appear as their CLASS and a number ("Cleric 2"), the same label everywhere, so their rows
// still add up and still link to each other (the guild lead, 2026-10-17: "just put their class on that spot to
// anonymize them"). The one exception is a bid winner (below). Recording already skips exclude_from_stats
// (utils/raidTrack.js); `scrubMinuteData` covers the other flag and rows recorded before either was set. Names are
// matched case-insensitively, and a pet that carries its owner's name ("<name>`s pet") is treated as the owner.
//
// WINNERS ARE NOT ANONYMIZED (same day: "do not anonymize bid winners"): whoever won an item in the window, in a
// closed OpenDKP auction or an observed award, is shown by name even if opted out, because a closed auction's
// winner is public in OpenDKP. Each winner links to a "bids" view (raidSessionBids.ts): what they won, and the
// closed auctions they bid on and lost.

import {
  MINUTE_MS, summarizeNights, type NightMinute, type NightSummary,
} from './raidReplay';
import { displayMobName } from './replayBosses';
import { isWipe } from './encounterMarks';
import {
  applyRollOverrides, attributeLoot, mergeRollSets, rollBreakdown,
  type RollLine, type RollOverride, type RollSetRow, type LootedRow,
} from './rolls';
import type { ShareWindow } from './raidShare';

// ── Opt-outs ─────────────────────────────────────────────────────────────────

export type CharFlags = { name: string; class?: string | null; exclude_from_stats?: boolean | null; exclude_inventory?: boolean | null };

const PET_RX = /^(.+?)`s (pet|warder|ward|familiar|companion)$/i;
/** The key an opt-out is matched on: lowercase, trimmed, a pet reduced to its owner. */
export function nameKey(name: string | null | undefined): string {
  const s = String(name ?? '').trim().toLowerCase();
  const m = s.match(PET_RX);
  return m ? m[1].trim() : s;
}

/** What an opted-out character is shown as: "Cleric 2", or "Raider 2" when the class is not known. */
export type AnonEntry = { label: string; cls: string | null };
/** nameKey -> label, for every character that must not be shown by name. Empty: nobody to hide. */
export type AnonMap = ReadonlyMap<string, AnonEntry>;

/**
 * An opaque, salted ordering key: 53-bit cyrb53 of `salt|s`, in base 36. It is a sort key and a handle, not a
 * secret (nothing depends on it being unguessable); it lives here, not in node:crypto, because the client bundle
 * imports this file too.
 */
export function opaqueKey(salt: string, s: string): string {
  const str = `${salt}|${s}`;
  let h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36).padStart(11, '0');
}

/**
 * The label of every opted-out character: its class, then a number counted within that class. The number comes
 * from the character's place in the salted `opaqueKey` order, never from the name, so "Cleric 1" is not the
 * alphabetically first cleric. It depends only on WHO is opted out in the guild (not on the window or on who
 * turned up), so a raider is the same label in the replay, the attendance list and every fight's parse, whichever
 * request produced it. It changes only when someone opts in or out. A row with neither flag set adds nothing.
 */
export function anonLabels(rows: readonly CharFlags[], salt = ''): Map<string, AnonEntry> {
  const byClass = new Map<string, { key: string; ord: string; cls: string | null }[]>();
  const seen = new Set<string>();
  for (const r of rows) {
    if (!r || !r.name || !(r.exclude_from_stats || r.exclude_inventory)) continue;
    const key = nameKey(r.name);
    if (seen.has(key)) continue;
    seen.add(key);
    const cls = typeof r.class === 'string' && r.class.trim() ? r.class.trim() : null;
    const bucket = cls ?? 'Raider';
    const item = { key, ord: opaqueKey(salt, key), cls };
    const a = byClass.get(bucket);
    if (a) a.push(item); else byClass.set(bucket, [item]);
  }
  const out = new Map<string, AnonEntry>();
  for (const [bucket, items] of byClass) {
    items.sort((a, b) => (a.ord < b.ord ? -1 : a.ord > b.ord ? 1 : 0));
    items.forEach((it, i) => out.set(it.key, { label: `${bucket} ${i + 1}`, cls: it.cls }));
  }
  return out;
}

/** `anon` without the winners (nameKeys): a winner is shown by name. */
export function exemptWinners(anon: AnonMap, winners: ReadonlySet<string>): AnonMap {
  if (!winners.size) return anon;
  const out = new Map<string, AnonEntry>();
  for (const [k, v] of anon) if (!winners.has(k)) out.set(k, v);
  return out;
}

/** The name to show for `name`: its label if it is anonymized (a pet keeps its suffix, "Cleric 1`s pet"), else itself. */
export function anonName(anon: AnonMap, name: string): string {
  if (!anon.size) return name;
  const s = String(name ?? '').trim();
  const e = anon.get(nameKey(s));
  if (!e) return name;
  const m = s.match(PET_RX);
  return m ? `${e.label}\`s ${m[2].toLowerCase()}` : e.label;
}

/** A string that changes whenever any label does: what a cached bundle is checked against. In-process only; it holds real keys. */
export const anonSig = (anon: AnonMap): string => [...anon].map(([k, v]) => `${k}=${v.label}`).sort().join('|');

/**
 * One raid_track_minutes `data` blob with the opted-out raiders' names swapped for their labels. Their positions
 * stay (a dot with a class and a number), so the replay, the follow list and the attendance agree. Unparseable
 * data becomes an empty object, which the decoder skips; it is never passed through, since it cannot be shown to
 * be clean.
 */
export function scrubMinuteData(data: string, anon: AnonMap): string {
  if (!anon.size) return data;
  let d: { who?: unknown; f?: unknown };
  try { d = JSON.parse(data); } catch { return '{}'; }
  if (!d || typeof d !== 'object' || !Array.isArray(d.who) || !Array.isArray(d.f)) return '{}';
  d.who = d.who.map((w: unknown) => {
    if (!Array.isArray(w) || typeof w[0] !== 'string') return w;
    const label = anonName(anon, w[0]);
    if (label === w[0]) return w;
    const cls = typeof w[1] === 'string' && w[1] ? w[1] : anon.get(nameKey(w[0]))?.cls ?? null;
    return [label, cls, ...w.slice(2)];
  });
  return JSON.stringify(d);
}

// ── The bundle ───────────────────────────────────────────────────────────────

export type AttendeeRow = { name: string; cls: string | null; minutes: number; firstMs: number; lastMs: number };
export type TickRow = { label: string; atMs: number | null; source: 'captured' | 'opendkp'; names: string[] };
export type KillTop = { name: string; damage: number; dps: number | null };
/**
 * boss: a curated boss (bosses_local). named: the game's own "#" mark on the NPC (a named mob, curated or not: the
 * Crypt of Decay chain is named and not curated). wipe: did not die (encounters.is_wipe / classification 'wipe').
 * foreign: marked as another guild's fight. A wipe or a foreign fight is listed, never counted as a kill.
 */
export type KillRow = {
  id: string; boss: boolean; named: boolean; wipe: boolean; foreign: boolean; name: string; zone: string | null;
  startMs: number; endMs: number | null; durationSec: number | null;
  totalDamage: number | null; top: KillTop[];
};
/**
 * The marks a fight may carry and still be listed on the review: none (ours), a wipe, or another guild's. 'live',
 * 'pvp' and 'test' stay off it. One filter string for the list and for the one-fight parse, so a row that is listed
 * can be opened and a row that is not listed cannot be served by id.
 */
export const LISTED_MARKS = 'classification.is.null,classification.in.(wipe,foreign)';
/** The zone an NPC lives in, from its id (docs/eqemu-catalog-cheatsheet.md: eqemu_npc_types.id = zoneid * 1000 + n). */
export const npcZoneId = (npcId: number | null | undefined): number | null => (typeof npcId === 'number' && npcId >= 1000 ? Math.floor(npcId / 1000) : null);
export type LootEntry = {
  atMs: number | null;
  item: string;
  who: string | null;          // null: nobody recorded. An opted-out looter is their label ("Cleric 2"); a winner is a name
  dkp: number | null;
  kind: 'looted' | 'awarded' | 'opendkp';
};
export type RollEntry = {
  startMs: number; lastMs: number;
  item: string | null; from: number; to: number; zone: string | null;
  rollers: number;
  winners: { name: string; value: number }[];
  lines: RollLine[];
  lootedBy: string[];
};

/** One item a bid winner took home that night, and what they paid. */
export type BidWin = { item: string; dkp: number | null; atMs: number | null };
/** A CLOSED auction the winner bid on and did not win: their top bid there, and who did win it. */
export type BidLoss = { item: string; bid: number | null; winner: string | null; atMs: number | null };
/**
 * One bid winner's night. `handle` is the opaque id the page links by (a #bids-<handle> anchor); it carries no
 * name. Only closed auctions are in here: the bids on an open one are sealed until it ends.
 */
export type BidderView = { handle: string; name: string; cls: string | null; wins: BidWin[]; losses: BidLoss[] };

export type SessionBundle = {
  fromMs: number;
  toMs: number;
  minutesRecorded: number;
  attendance: AttendeeRow[];
  ticks: TickRow[];
  kills: KillRow[];
  loot: LootEntry[];
  rolls: RollEntry[];
  bidders: BidderView[];
};

// ── Attendance, from the recording ───────────────────────────────────────────

/**
 * Who was in the recording and for how many minutes: the `who` list of every minute row in the window. A raider
 * listed in a minute was placed in at least one frame of it, so "minutes" is minutes seen, not minutes logged in.
 * Sorted by minutes, then name.
 */
export function attendanceFromMinutes(rows: readonly { minute_at: string; data: string }[], anon: AnonMap): AttendeeRow[] {
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
      if (seen.has(key) || PET_RX.test(w[0].trim())) continue;
      seen.add(key);
      const cls = typeof w[1] === 'string' && w[1] ? w[1] : anon.get(key)?.cls ?? null;
      const cur = by.get(key);
      if (cur) {
        cur.minutes++;
        cur.firstMs = Math.min(cur.firstMs, t);
        cur.lastMs = Math.max(cur.lastMs, t + MINUTE_MS);
        if (cls) cur.cls = cls;
      } else {
        by.set(key, { name: anonName(anon, w[0].trim()), cls, minutes: 1, firstMs: t, lastMs: t + MINUTE_MS });
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

const cleanNames = (names: readonly unknown[] | null | undefined, anon: AnonMap): string[] => {
  const seen = new Map<string, string>();
  for (const n of names ?? []) {
    const s = String(n ?? '').trim();
    const k = nameKey(s);
    if (s && !seen.has(k)) seen.set(k, anonName(anon, s));
  }
  return [...seen.values()].sort((a, b) => a.localeCompare(b));
};

/** The captured raid ticks (bot-staged, never submitted) and the OpenDKP ticks that fall in the window. */
export function buildTicks(captured: readonly CapturedTickIn[], dkp: readonly DkpTickIn[], anon: AnonMap): TickRow[] {
  const out: TickRow[] = [];
  for (const c of captured) {
    const at = Date.parse(c.scheduled_for);
    out.push({ label: c.description, atMs: Number.isFinite(at) ? at : null, source: 'captured', names: cleanNames(c.names, anon) });
  }
  out.sort((a, b) => (a.atMs ?? 0) - (b.atMs ?? 0));
  for (const t of dkp) {
    const names = cleanNames(t.attendees, anon);
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
  classification?: string | null; is_wipe?: boolean | null;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};
export type PlayerIn = { encounter_id: string; character_name: string; total_damage: number | null; dps: number | null };

export const TOP_PER_KILL = 5;

export function buildKills(
  encs: readonly EncounterIn[], players: readonly PlayerIn[], bossIds: ReadonlySet<number>, anon: AnonMap,
  zoneNames: ReadonlyMap<number, string> = new Map(),
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
    const top = (byEnc.get(e.id) ?? [])
      .filter(p => typeof p.total_damage === 'number' && p.total_damage > 0 && !PET_RX.test(String(p.character_name).trim()))
      .map(p => ({ name: anonName(anon, p.character_name), damage: p.total_damage ?? 0, dps: typeof p.dps === 'number' ? p.dps : null }))
      .sort((a, b) => b.damage - a.damage || a.name.localeCompare(b.name))   // ties on the SHOWN name, so a label never orders by a real one
      .slice(0, TOP_PER_KILL);
    out.push({
      id: e.id,
      boss: e.npc_id != null && bossIds.has(e.npc_id),
      named: String(t?.name ?? '').startsWith('#'),
      wipe: isWipe({ classification: e.classification ?? null, is_wipe: e.is_wipe }),
      foreign: e.classification === 'foreign',
      name: displayMobName(t?.name) || 'Unknown mob',
      // encounters.zone_short is NULL on new rows (find_or_create_encounter does not set it): the zone then comes from the NPC id.
      zone: e.zone_short ?? zoneNames.get(npcZoneId(e.npc_id) ?? -1) ?? null,
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

const who = (name: string | null | undefined, anon: AnonMap) => ({ who: name ? anonName(anon, name) : null });

export function buildLoot(
  looted: readonly LootedIn[], observed: readonly ObservedIn[], dkp: readonly DkpLootIn[], anon: AnonMap,
): LootEntry[] {
  const out: LootEntry[] = [];
  for (const l of looted) {
    if (l.from_own_pet) continue;      // a pet's own pickup is not a drop
    const at = Date.parse(l.looted_at);
    out.push({ atMs: Number.isFinite(at) ? at : null, item: l.item_name, ...who(l.looter_character, anon), dkp: null, kind: 'looted' });
  }
  for (const o of observed) {
    const at = Date.parse(o.posted_at);
    out.push({ atMs: Number.isFinite(at) ? at : null, item: o.item_name, ...who(o.winner_character, anon), dkp: o.dkp_amount, kind: 'awarded' });
  }
  for (const d of dkp) {
    out.push({ atMs: null, item: d.item_name, ...who(d.character_name, anon), dkp: d.dkp, kind: 'opendkp' });
  }
  return out.sort((a, b) => (a.atMs ?? Number.MAX_SAFE_INTEGER) - (b.atMs ?? Number.MAX_SAFE_INTEGER) || a.item.localeCompare(b.item));
}

/**
 * The window's roll sessions: merged across uploaders, officer corrections applied, hidden ones dropped (a share
 * never shows what an officer hid). Opted-out rollers stay in the lines, the winners and the looted-by list as
 * their labels; the winner is whoever really won, so the order and the count are the roll's own.
 */
export function buildRolls(
  rows: readonly RollSetRow[], overrides: readonly RollOverride[], looted: readonly LootedRow[], anon: AnonMap,
): RollEntry[] {
  const sessions = applyRollOverrides(mergeRollSets(rows.slice()), overrides.slice()).filter(s => !s.hidden);
  const out: RollEntry[] = sessions.map(s => {
    const raw = rollBreakdown(s);
    return {
      startMs: s.startMs, lastMs: s.lastMs, item: s.item, from: s.from, to: s.to, zone: s.zone,
      rollers: new Set(raw.map(l => nameKey(l.name))).size,
      winners: s.winners.map(w => ({ ...w, name: anonName(anon, w.name) })),
      lines: raw.map(l => ({ ...l, name: anonName(anon, l.name) })),
      lootedBy: attributeLoot(s, looted.slice()).map(m => anonName(anon, m.looter)),
    };
  });
  return out.sort((a, b) => a.startMs - b.startMs);
}
