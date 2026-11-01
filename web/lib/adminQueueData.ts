// The reads and pure rules behind the /admin review queue (web/lib/admin-queue.ts), kept out of that
// file so a test can run them against a fake client.
//
// Why this exists: the queue banner runs on EVERY admin page and counted big windows of rows in JS.
// PostgREST returns at most 1,000 rows per response and says nothing, so each count came from the
// first 1,000 rows the planner produced (production, 2026-10-04: 21,545 chat rows read as 1,000, so
// 8 of 117 speakers missing from OpenDKP showed). The aggregates now run in Postgres and come back as
// one jsonb value apiece (supabase/migrations/20261004140400_cap_safe_admin.sql), which no row cap
// applies to. Everything below is either one of those calls or a small pure rule over its answer.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rpcJson } from './rpcJson';
import { GUILD_TAG } from './guild';
import { RANKS, ROLES } from './guild';
import { selectAll } from './selectAll';

export const QUEUE_GUILD = GUILD_TAG;

const MIN = 60_000;
const HOUR = 3_600_000;

// ── who counts as a guild member ────────────────────────────────────────────────────────────────
// The queue lists things an officer can act on, so every list is limited to guild members (the guild
// lead, 2026-11-01: "many of the users here are observed not being in our guild"). The predicate is the
// one CLAUDE.md names: a Discord role of Pack Member or better on the character's linked account
// (characters.discord_id -> wolfpack_members), OR an OpenDKP rank of Raid Pack or better. A departed
// account (wolfpack_members.is_member = false) never passes, whatever rank is left behind in OpenDKP.
// An alt with no account of its own passes through its main (characters.main_name).

/** OpenDKP ranks that count as members on their own: Raid Pack and better, best first in RANKS.priority. */
export const MEMBER_RANKS: readonly string[] = RANKS.priority.slice(0, RANKS.priority.indexOf('Raid Pack') + 1);

export type MemberCharacter = { name: string | null; rank: string | null; discord_id: string | null; main_name: string | null };
export type MemberAccount = { discord_id: string; is_member: boolean | null; role_names: string[] | null };
export type GuildMembers = {
  /** lower-cased character names that pass the predicate */
  names: Set<string>;
  /** discord ids of current members (an account with a Pack Member+ role and is_member not false) */
  discords: Set<string>;
};

export function computeGuildMembers(chars: MemberCharacter[], accounts: MemberAccount[]): GuildMembers {
  const discords = new Set<string>();
  const departed = new Set<string>();
  for (const a of accounts) {
    if (a.is_member === false) { departed.add(a.discord_id); continue; }
    if ((a.role_names ?? []).some(r => (ROLES.active as readonly string[]).includes(r))) discords.add(a.discord_id);
  }
  const names = new Set<string>();
  const gone = (c: MemberCharacter) => !!c.discord_id && departed.has(c.discord_id);
  for (const c of chars) {
    if (!c.name || gone(c)) continue;
    const viaRole = !!c.discord_id && discords.has(c.discord_id);
    const viaRank = !!c.rank && MEMBER_RANKS.includes(c.rank);
    if (viaRole || viaRank) names.add(c.name.toLowerCase());
  }
  for (const c of chars) {      // an alt rides on its main
    if (!c.name || gone(c) || !c.main_name) continue;
    if (names.has(c.main_name.toLowerCase())) names.add(c.name.toLowerCase());
  }
  return { names, discords };
}

/** Reads the characters and Discord accounts (both paged) and applies the predicate. */
export async function readGuildMembers(sb: SupabaseClient): Promise<GuildMembers> {
  const [chars, accounts] = await Promise.all([
    selectAll<MemberCharacter>((from, to) => sb
      .from('characters').select('name, rank, discord_id, main_name').eq('guild_id', GUILD_TAG)
      .order('name').range(from, to)),
    selectAll<MemberAccount>((from, to) => sb
      .from('wolfpack_members').select('discord_id, is_member, role_names')
      .order('discord_id').range(from, to)),
  ]);
  return computeGuildMembers(chars, accounts);
}

// ── chat speakers ────────────────────────────────────────────────────────────────────────────────

/** One speaker's guild+raid chat in a window: how many lines, and when the newest was (ISO). */
export type ChatSpeaker = { speaker: string; n: number; last: string };

export const readChatSpeakers = (sb: SupabaseClient, sinceIso: string): Promise<ChatSpeaker[]> =>
  rpcJson<ChatSpeaker[]>(sb, 'admin_queue_chat_speakers', { p_since: sinceIso }, []);

/** Of `names`, the lower-cased ones with a non-anonymous /who row that carries a class since `sinceIso`. */
export async function readWhoClassKnown(sb: SupabaseClient, names: string[], sinceIso: string): Promise<Set<string>> {
  if (names.length === 0) return new Set();
  return new Set(await rpcJson<string[]>(sb, 'admin_queue_who_class_known', { p_names: names, p_since: sinceIso }, []));
}

// ── newest /who row per character ────────────────────────────────────────────────────────────────

export type WhoLatest = { level: number | null; cls: string | null };

/** The newest guild /who row per name (lower-cased key). An /anon row carries no level or class and says so. */
export async function readWhoLatest(sb: SupabaseClient, names: string[]): Promise<Map<string, WhoLatest>> {
  const out = new Map<string, WhoLatest>();
  if (names.length === 0) return out;
  const rows = await rpcJson<{ character: string; level: number | null; class: string | null }[]>(
    sb, 'who_latest_per_character', { p_guild: QUEUE_GUILD, p_names: names }, []);
  for (const r of rows) out.set(r.character, { level: r.level ?? null, cls: r.class ?? null });
  return out;
}

// ── characters streaming from a Mimic ────────────────────────────────────────────────────────────

export type UploadRow = { character: string | null; uploaded_by_discord_id: string | null; last_uploaded_at: string | null };
export type UnregisteredUpload = { name: string; last: string | null };

/**
 * One entry per character name from agent_upload_stats rows (one row per name AND endpoint), skipping
 * operator streams / junk (not 3-20 letters) and anything `isRostered`. `last` is the NEWEST upload
 * across that character's endpoints: the old read kept whichever row it happened to see first, which
 * was arbitrary. Order is the order names are first met.
 */
export function newestUploadPerName(rows: UploadRow[], isRostered: (lower: string) => boolean): UnregisteredUpload[] {
  const byName = new Map<string, UnregisteredUpload>();
  for (const u of rows) {
    const name = (u.character || '').trim();
    if (!name || !u.uploaded_by_discord_id) continue;
    if (!/^[A-Za-z]{3,20}$/.test(name)) continue;
    const k = name.toLowerCase();
    if (isRostered(k)) continue;
    const cur = byName.get(k);
    const last = u.last_uploaded_at ?? null;
    if (!cur) byName.set(k, { name, last });
    else if (last && (!cur.last || Date.parse(last) > Date.parse(cur.last))) { cur.last = last; cur.name = name; }
  }
  return [...byName.values()];
}

// ── missed-tick evidence: chat and combat inside the windows that matter ─────────────────────────

/** An inclusive span of epoch milliseconds. */
export type TimeWindow = { lo: number; hi: number };

/** Sort and join overlapping or touching windows; a span that is not finite is dropped. */
export function mergeWindows(ws: TimeWindow[]): TimeWindow[] {
  const sorted = ws.filter(w => Number.isFinite(w.lo) && Number.isFinite(w.hi) && w.lo <= w.hi)
    .sort((a, b) => a.lo - b.lo);
  const out: TimeWindow[] = [];
  for (const w of sorted) {
    const last = out[out.length - 1];
    if (last && w.lo <= last.hi) last.hi = Math.max(last.hi, w.hi);
    else out.push({ lo: w.lo, hi: w.hi });
  }
  return out;
}

/**
 * The chat the missed-tick check can ask about, as windows. For a candidate it looks at the tick
 * time +/- 20 min (the "chatting" chip) and, for an edge candidate, from the raid start to the tick
 * +20 min (leading) or from the tick -20 min to six hours after the start (trailing). Every one of
 * those lies inside [raid start - 20 min, max(raid start + 6 h, tick + 20 min)], so that is what is
 * fetched: a few hours around each raid instead of 30 days of every family member's chat, with the
 * answer to every question the check asks unchanged.
 */
export function chatEvidenceWindows(cands: { raidTs: string; tickTime: string | null }[]): TimeWindow[] {
  return mergeWindows(cands.map(c => {
    const raidLo = Date.parse(c.raidTs);
    const tt = c.tickTime ? Date.parse(c.tickTime) : NaN;
    return { lo: raidLo - 20 * MIN, hi: Math.max(raidLo + 6 * HOUR, Number.isFinite(tt) ? tt + 20 * MIN : 0) };
  }));
}

/** The combat the check can ask about: encounters from 10 minutes before a raid's start to six hours after. */
export function combatWindows(raidTs: string[]): TimeWindow[] {
  return mergeWindows(raidTs.map(ts => {
    const t = Date.parse(ts);
    return { lo: t - 10 * MIN, hi: t + 6 * HOUR };
  }));
}

const iso = (ms: number) => new Date(ms).toISOString();

/** Epoch-ms chat timestamps per lower-cased speaker, for `speakers`, inside `windows` and at/after `sinceIso`. */
export async function readChatTimes(
  sb: SupabaseClient, speakers: string[], sinceIso: string, windows: TimeWindow[],
): Promise<Record<string, number[]>> {
  if (speakers.length === 0 || windows.length === 0) return {};
  return rpcJson<Record<string, number[]>>(sb, 'admin_queue_chat_times', {
    p_speakers: speakers, p_since: sinceIso, p_lo: windows.map(w => iso(w.lo)), p_hi: windows.map(w => iso(w.hi)),
  }, {});
}

/** Epoch-ms start of every encounter inside `windows` that each of `names` (exact spelling) fought in, per lower-cased name. */
export async function readCombatTimes(
  sb: SupabaseClient, names: string[], windows: TimeWindow[],
): Promise<Record<string, number[]>> {
  if (names.length === 0 || windows.length === 0) return {};
  return rpcJson<Record<string, number[]>>(sb, 'admin_queue_combat_times', {
    p_guild: QUEUE_GUILD, p_names: names, p_lo: windows.map(w => iso(w.lo)), p_hi: windows.map(w => iso(w.hi)),
  }, {});
}

/** Fold per-name timestamps into per-family lists. A name that belongs to no family is dropped. */
export function foldTimesByFamily(
  times: Record<string, number[]>, nameToFamily: Map<string, string>, into: Map<string, number[]>,
): void {
  for (const [name, ts] of Object.entries(times)) {
    const fid = nameToFamily.get(name);
    if (!fid) continue;
    const arr = into.get(fid) ?? [];
    for (const t of ts) arr.push(t);
    into.set(fid, arr);
  }
}

// ── how the queue is shown ───────────────────────────────────────────────────────────────────────
// (the guild lead, 2026-11-01: "admin review queue looks terrible with this being verbose")

/** Rows a section shows before "Show all N". */
export const QUEUE_TOP = 10;

/** The first QUEUE_TOP rows, and the rest that sit behind "Show all". */
export function splitTop<T>(items: T[], top: number = QUEUE_TOP): { shown: T[]; rest: T[] } {
  return { shown: items.slice(0, top), rest: items.slice(top) };
}

/** The banner's single line: "🛠 Review queue · 535 to check". */
export const queueBannerLabel = (total: number): string => `🛠 Review queue · ${total} to check`;
