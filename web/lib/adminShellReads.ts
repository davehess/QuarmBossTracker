// The four numbers in the admin sidebar and the context strip at the top of every pane (the guild lead, 2026-10-31,
// DECISIONS §493): tonight's raid, who is locked out, who is uploading, how much feedback is new. Each is ONE small read
// against a table the matching page already reads, and each takes the client as an argument so test/admin-shell.test.js
// runs them against a fake. lib/adminShellFacts.ts wraps them in a 60-second cache; they never run per click.
//
// Every one fails soft to null: a number that cannot be read is left off the strip, and the page under it still loads.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { selectInChunks } from './selectInChunks';
import { loadAgentUploadStats } from './adminReads';
import { pickNextRaidEvent, eventWhen } from './raidPlan';

// A PostgREST filter builder, chained dynamically (the same stance as lib/adminReads.ts).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Q = any;
const db = (sb: SupabaseClient): Q => sb;

/** A raid-track minute newer than this is "the raid that is running". Three hours covers a full 8-to-midnight night's gaps. */
export const LIVE_WINDOW_MS = 3 * 3600_000;

/** An agent that uploaded this recently is "uploading" (the console's own 15-minute window). */
export const UPLOADING_WINDOW_MS = 15 * 60_000;

/** The span "total" counts over: a raid week, the dormancy line the agents page already draws. */
export const FLEET_WINDOW_MS = 7 * 86_400_000;

export type Tonight =
  | { kind: 'live'; zone: string | null; raiders: number }
  | { kind: 'event'; title: string; when: string }
  | { kind: 'none' };

const etDay = (d: Date | string | number): string => new Intl.DateTimeFormat('en-CA', {
  timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit',
}).format(new Date(d));

/** Tonight's raid: the newest raid-track minute if it is recent (a raid is being recorded), else today's Raid-Helper
 *  event (Eastern calendar day), else nothing. Null when the reads fail. */
export async function readTonight(sb: SupabaseClient, guildId: string, now: Date = new Date()): Promise<Tonight | null> {
  try {
    const { data, error } = await db(sb).from('raid_track_minutes')
      .select('minute_at, raiders, zones')
      .eq('guild_id', guildId)
      .order('minute_at', { ascending: false })
      .limit(1);
    if (error) return null;
    const last = (data ?? [])[0] as { minute_at: string; raiders: number | null; zones: string[] | null } | undefined;
    if (last && now.getTime() - new Date(last.minute_at).getTime() <= LIVE_WINDOW_MS) {
      return { kind: 'live', zone: last.zones?.[0] ? String(last.zones[0]).replace(/_/g, ' ') : null, raiders: last.raiders ?? 0 };
    }
    const ev = await db(sb).from('rh_events')
      .select('title, start_time')
      // A day back covers the Eastern day boundary; pickNextRaidEvent drops anything before today.
      .gte('start_time', new Date(now.getTime() - 24 * 3600_000).toISOString())
      .order('start_time', { ascending: true }).limit(100);
    if (ev.error) return null;
    const next = pickNextRaidEvent((ev.data ?? []) as { title: string; start_time: string }[], now);
    if (next && etDay(next.start_time) === etDay(now)) return { kind: 'event', title: next.title, when: eventWhen(next.start_time) };
    return { kind: 'none' };
  } catch {
    return null;
  }
}

/** Raiders of ours who cannot engage a boss tonight because they killed it elsewhere: distinct characters holding a
 *  binding lockout that is not ours (`ours = false`), on our roster. The roster filter is what keeps another guild's
 *  whole raid, picked up from a kill parse, out of the number. Era is not filtered (the page's top section also is). */
export async function readLockedOut(sb: SupabaseClient, guildId: string, now: Date = new Date()): Promise<number | null> {
  try {
    const rows = await selectAll<{ character: string }>((from, to) => db(sb).from('character_lockouts')
      .select('character, boss_key')
      .eq('guild_id', guildId).eq('ours', false)
      .gt('expires_at', now.toISOString())
      .order('character').order('boss_key')
      .range(from, to));
    const names = [...new Set(rows.map(r => r.character))];
    if (names.length === 0) return 0;
    const mine = await selectInChunks<string, { name: string }>(names, (part, from, to) => db(sb).from('characters')
      .select('name').eq('guild_id', guildId).in('name', part).order('name').range(from, to));
    return new Set(mine.map(c => c.name.toLowerCase())).size;
  } catch {
    return null;
  }
}

/** Agents (installs, counted per uploading player and never per character: CLAUDE.md "fleet adoption is counted in
 *  PLAYERS") that uploaded in the last 15 minutes, and that uploaded in the last raid week. */
export async function readAgents(sb: SupabaseClient, now: Date = new Date()): Promise<{ up: number; total: number } | null> {
  try {
    const since = new Date(now.getTime() - FLEET_WINDOW_MS).toISOString();
    const rows = await loadAgentUploadStats<{ character: string | null; uploaded_by_discord_id: string | null; last_uploaded_at: string }>(
      sb, 'character, uploaded_by_discord_id, last_uploaded_at', q => q.gte('last_uploaded_at', since));
    const player = (r: { character: string | null; uploaded_by_discord_id: string | null }) =>
      r.uploaded_by_discord_id || `char:${String(r.character ?? '').toLowerCase()}`;
    const recent = now.getTime() - UPLOADING_WINDOW_MS;
    const total = new Set(rows.map(player));
    const up = new Set(rows.filter(r => new Date(r.last_uploaded_at).getTime() >= recent).map(player));
    return { up: up.size, total: total.size };
  } catch {
    return null;
  }
}

/** Reports nobody has looked at yet. */
export async function readNewFeedback(sb: SupabaseClient): Promise<number | null> {
  try {
    const { count, error } = await db(sb).from('feedback').select('id', { count: 'exact', head: true }).eq('status', 'new');
    return error ? null : (count ?? 0);
  } catch {
    return null;
  }
}
