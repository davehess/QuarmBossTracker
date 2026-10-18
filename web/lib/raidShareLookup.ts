// Token in, share out: the one door every public share route and the share page go through.
//
// A token that is the wrong shape, unknown, expired or revoked all come back as null, so a caller can only
// answer 404 and a visitor cannot tell the cases apart. The window returned is the ROW's; there is no way to
// ask this for a different one.
import type { SupabaseClient } from '@supabase/supabase-js';
import { hashToken, shareStatus, tokenLooksValid, windowOfShare, type ShareRow, type ShareWindow } from './raidShare';
import { optedOutSet, type CharFlags } from './raidSession';
import { selectAll } from './selectAll';

const COLUMNS = 'id, guild_id, from_at, to_at, title, created_at, expires_at, revoked_at, view_count';

export type ResolvedShare = { row: ShareRow; win: ShareWindow };

// The lookup is held per process, by token hash, so a link that is looped (live, revoked or made up) costs one
// database read a minute rather than one a hit (the guild lead, 2026-10-17). A hit lasts 60 s and a miss 30 s,
// which is also how long a revoke can take to bite on an instance the officer's click did not reach:
// `invalidateShare` clears the instance that served it, the TTL bounds the rest. An expiry is judged against the
// clock on every call, never against the memo, so a share never outlives its date.
const HIT_TTL_MS = 60_000;
const MISS_TTL_MS = 30_000;
const MEMO_CAP = 1000;
const memo = new Map<string, { at: number; ttl: number; value: ResolvedShare | null }>();

/** Forgets one share (by id) so the next request reads the row again. The officer revoke/delete route calls it. */
export function invalidateShare(id: string) {
  for (const [k, e] of memo) if (e.value?.row.id === id) memo.delete(k);
}

/** Forgets every memoised lookup (tests). */
export function clearShareMemo() {
  memo.clear();
}

export async function resolveShare(sb: SupabaseClient, token: unknown, now = Date.now()): Promise<ResolvedShare | null> {
  if (!tokenLooksValid(token)) return null;
  const key = hashToken(token);
  const hit = memo.get(key);
  if (hit && now - hit.at < hit.ttl) {
    if (hit.value && shareStatus(hit.value.row, now) !== 'ok') return null;
    return hit.value;
  }
  const value = await readShare(sb, key, now);
  memo.delete(key);
  if (memo.size >= MEMO_CAP) memo.delete(memo.keys().next().value as string);
  memo.set(key, { at: now, ttl: value ? HIT_TTL_MS : MISS_TTL_MS, value });
  return value;
}

async function readShare(sb: SupabaseClient, tokenHash: string, now: number): Promise<ResolvedShare | null> {
  const { data, error } = await sb.from('raid_shares')
    .select(COLUMNS)
    .eq('token_hash', tokenHash)
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ShareRow;
  if (shareStatus(row, now) !== 'ok') return null;
  const win = windowOfShare(row);
  return win ? { row, win } : null;
}

// One count per (visitor address, share) per 30 minutes, held in this process: a reload, a scrubbed replay or a
// script costs no write after the first. The number is therefore APPROXIMATE (a second instance counts the same
// visitor again, a restart forgets) and that is fine: it tells an officer roughly how far a link travelled.
const VIEW_GAP_MS = 30 * 60_000;
const VIEW_CAP = 5000;
const lastCounted = new Map<string, number>();

/** Counts a page view. Best effort and approximate (a read then a write): a failure never costs the visitor the page. */
export async function noteView(sb: SupabaseClient, row: Pick<ShareRow, 'id' | 'view_count'>, ip = 'unknown', now = Date.now()): Promise<void> {
  const k = `${ip}|${row.id}`;
  const last = lastCounted.get(k);
  if (last !== undefined && now - last < VIEW_GAP_MS) return;
  lastCounted.delete(k);
  if (lastCounted.size >= VIEW_CAP) {
    for (const [key, at] of lastCounted) if (now - at >= VIEW_GAP_MS) lastCounted.delete(key);
    while (lastCounted.size >= VIEW_CAP) lastCounted.delete(lastCounted.keys().next().value as string);
  }
  lastCounted.set(k, now);   // before the write, so two page loads racing in do not both count
  try {
    const next = (row.view_count ?? 0) + 1;
    await sb.from('raid_shares').update({ view_count: next }).eq('id', row.id);
    row.view_count = next;   // the memoised row is this object: the next count in this process builds on it, not on a stale number
  } catch { /* the count is a courtesy */ }
}

/** Forgets every counted visitor (tests). */
export function clearViewMemo() {
  lastCounted.clear();
}

const OPT_TTL_MS = 60_000;
let optCache: { at: number; guild: string; set: Set<string> } | null = null;

/** The characters that must not appear in a share, as nameKeys. Held for a minute per process. */
export async function loadOptedOut(sb: SupabaseClient, guild: string): Promise<Set<string>> {
  if (optCache && optCache.guild === guild && Date.now() - optCache.at < OPT_TTL_MS) return optCache.set;
  const rows = await selectAll<CharFlags>((from, to) => sb.from('characters')
    .select('name, exclude_from_stats, exclude_inventory')
    .eq('guild_id', guild)
    .or('exclude_from_stats.eq.true,exclude_inventory.eq.true')
    .order('name')
    .range(from, to));
  const set = optedOutSet(rows);
  optCache = { at: Date.now(), guild, set };
  return set;
}
