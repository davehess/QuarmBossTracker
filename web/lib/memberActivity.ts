// What /admin/members counts per member (chat, parses, /who in the last 30 days) and the /who
// cross-reference behind its link suggestions, computed in Postgres.
//
// The page used to read 30 days of chat_messages, contributions and who_observations with
// `.limit(50000)` and count in JS. PostgREST returns at most 1,000 rows per response and says
// nothing, so on 2026-10-04 it counted 1,000 of 36,573 chat lines, 1,000 of 32,873 contributions and
// 1,000 of 84,730 /who rows: "Silent 30d" and the per-member counts were a sample of the first rows
// the planner returned. The three functions return one jsonb value apiece
// (20261004140400_cap_safe_admin.sql), which no row cap applies to.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rpcJson } from './rpcJson';

export type ChatCount    = { speaker: string; n: number };                             // speaker is lower-cased
export type ContribCount = { discord_id: string | null; character: string | null; n: number };
export type WhoActivity  = {
  targets: { character: string; n: number }[];       // observations OF each roster character (lower-cased)
  seen:    Record<string, string[]>;                 // uploader (lower-cased) → roster characters they observed
};

export const readChatCounts = (sb: SupabaseClient, sinceIso: string): Promise<ChatCount[]> =>
  rpcJson<ChatCount[]>(sb, 'admin_members_chat_counts', { p_since: sinceIso }, []);

export const readContribCounts = (sb: SupabaseClient, sinceIso: string): Promise<ContribCount[]> =>
  rpcJson<ContribCount[]>(sb, 'admin_members_contrib_counts', { p_since: sinceIso }, []);

/** `uploaders` are the lower-cased tokens whose /who sightings the suggestions look up. */
export async function readWhoActivity(
  sb: SupabaseClient, guild: string, sinceIso: string, uploaders: string[],
): Promise<WhoActivity> {
  const w = await rpcJson<Partial<WhoActivity>>(sb, 'admin_members_who_counts',
    { p_guild: guild, p_since: sinceIso, p_uploaders: uploaders }, {});
  return { targets: w.targets ?? [], seen: w.seen ?? {} };
}

/**
 * Per-Discord-member counts. A chat line or /who sighting belongs to the member whose roster
 * character it names; a contribution to the Discord id it carries, else to the member whose roster
 * character it names. `charToDiscord` is the roster, lower-cased name → Discord id.
 */
export function countsByDiscord(
  chat: ChatCount[],
  contrib: ContribCount[],
  whoTargets: WhoActivity['targets'],
  charToDiscord: Map<string, string>,
): { chatCount: Map<string, number>; parseCount: Map<string, number>; whoCount: Map<string, number> } {
  const chatCount = new Map<string, number>();
  for (const c of chat) {
    const d = charToDiscord.get((c.speaker || '').toLowerCase());
    if (d) chatCount.set(d, (chatCount.get(d) ?? 0) + c.n);
  }
  const parseCount = new Map<string, number>();
  for (const c of contrib) {
    const d = c.discord_id || charToDiscord.get((c.character || '').toLowerCase());
    if (d) parseCount.set(d, (parseCount.get(d) ?? 0) + c.n);
  }
  const whoCount = new Map<string, number>();
  for (const t of whoTargets) {
    const d = charToDiscord.get((t.character || '').toLowerCase());
    if (d) whoCount.set(d, (whoCount.get(d) ?? 0) + t.n);
  }
  return { chatCount, parseCount, whoCount };
}

/** uploader (lower-cased) → the roster characters (lower-cased) they observed in /who. */
export function charsSeenByUploader(seen: WhoActivity['seen']): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const [uploader, chars] of Object.entries(seen)) out.set(uploader.toLowerCase(), new Set(chars));
  return out;
}
