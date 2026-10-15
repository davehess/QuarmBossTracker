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

export async function resolveShare(sb: SupabaseClient, token: unknown, now = Date.now()): Promise<ResolvedShare | null> {
  if (!tokenLooksValid(token)) return null;
  const { data, error } = await sb.from('raid_shares')
    .select(COLUMNS)
    .eq('token_hash', hashToken(token))
    .maybeSingle();
  if (error || !data) return null;
  const row = data as ShareRow;
  if (shareStatus(row, now) !== 'ok') return null;
  const win = windowOfShare(row);
  return win ? { row, win } : null;
}

/** Counts a page view. Best effort and approximate (a read then a write): a failure never costs the visitor the page. */
export async function noteView(sb: SupabaseClient, row: Pick<ShareRow, 'id' | 'view_count'>): Promise<void> {
  try {
    await sb.from('raid_shares').update({ view_count: (row.view_count ?? 0) + 1 }).eq('id', row.id);
  } catch { /* the count is a courtesy */ }
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
