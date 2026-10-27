'use server';

// The one server action behind the /me/wishlist search box: find items by name. It only READS the item catalog
// (game data) and says where each hit is already listed for the signed-in member's own characters. Adding,
// changing and removing go through the three actions in app/me/upgrades/actions.ts (ownership check, then the
// bot), so this file has no second write path and never sees a bid.
//
// Scope: every eqemu_items row with id > 0, not only items known to drop (lib/wishlistSearch.ts says why).
// Egress: twenty rows of id, name, icon and slots at most, and a second query only when the first came back short.
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { loadWishView } from '@/lib/wishlistLoad';
import { SEARCH_LIMIT, SEARCH_MIN, mergeSearch, normaliseSearch } from '@/lib/wishlistSearch';
import type { WishState } from '@/lib/wishlistPick';

export type FoundItem = { id: number; name: string; icon: number | null; slots: number | null };
export type SearchResult =
  | { ok: true; items: FoundItem[]; states: Record<number, Record<string, WishState>> }
  | { ok: false; error: string };

const COLS = 'id, name, icon, slots';

/** Items whose name starts with, then merely contains, `term`; each with the member's characters that already list it. */
export async function searchItems(term: unknown): Promise<SearchResult> {
  const t = normaliseSearch(term);
  if (!t) return { ok: false, error: `Type at least ${SEARCH_MIN} letters of the item name.` };
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'Sign in again to search.' };

  const sb = supabaseAdmin();
  // `.limit(20)` is SEARCH_LIMIT written out: the read-discipline scan only accepts a literal (eqemu_items is a big table).
  const starts = await sb.from('eqemu_items').select(COLS).gt('id', 0).ilike('name', `${t}%`)
    .order('name').order('id').limit(20);
  if (starts.error) return { ok: false, error: 'The item search did not answer. Try again in a moment.' };
  const first = (starts.data ?? []) as FoundItem[];
  let more: FoundItem[] = [];
  if (first.length < SEARCH_LIMIT) {
    const has = await sb.from('eqemu_items').select(COLS).gt('id', 0).ilike('name', `%${t}%`)
      .order('name').order('id').limit(20);
    if (has.error) return { ok: false, error: 'The item search did not answer. Try again in a moment.' };
    more = (has.data ?? []) as FoundItem[];
  }
  const items = mergeSearch(first, more);

  // Where each hit is already listed: the member's own characters only. A failed read hides the marks, not the hits.
  const view = await loadWishView(user.id, items.map(i => i.id)).catch(() => null);
  const states: Record<number, Record<string, WishState>> = {};
  for (const i of items) states[i.id] = view?.states.get(i.id) ?? {};
  return { ok: true, items, states };
}
