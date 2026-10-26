// The reads behind every wishlist control that is not on /me/upgrades: the item page, the raid plan's loot lists,
// the /me/wishlist page and its search box. SERVER ONLY: it uses the service client and signs bot tickets.
//
// What a signed-in member sees is their OWN characters' lists and nobody else's:
//   * the characters are ownedCharacters(userId), never a name from the browser;
//   * the wishlists read selects item_id, character_name and priority only. The bid columns are never selected
//     here, because the website cannot decrypt them; the member's own pre-bids come from the bot's `list` op
//     (utils/webWishlist.js), which decrypts for the owner and re-derives ownership from the member's id.
// If the site cannot reach the bot, or the bot does not answer, the controls still show priority and `bidKnown`
// is false (the control then says "Set or change pre-bid" rather than guessing "none").
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters, type OwnedChar } from '@/lib/ownedCharacters';
import { callBotWishlist, wishlistWritesEnabled, type BotItem } from '@/lib/wishlistBot';
import { pickDefaultCharacter, wishlistCharacters, type WishState } from '@/lib/wishlistPick';

export type States = Record<string, WishState>;

export type WishView = {
  /** False when the site cannot reach the bot: the controls show what is listed and offer nothing. */
  enabled: boolean;
  characters: string[];
  defaultCharacter: string | null;
  /** item id -> the characters that have it listed. An item nobody listed has no entry. */
  states: Map<number, States>;
};

type ListRow = { item_id: number; character_name: string; priority: number | null };

/** The member's own pre-bids, one bot call per character that has something listed. A character the bot did not answer for is null. */
async function bidsFor(userId: string, names: string[]): Promise<Map<string, Map<number, number | null> | null>> {
  const out = new Map<string, Map<number, number | null> | null>();
  if (!wishlistWritesEnabled()) return out;
  await Promise.all(names.map(async name => {
    const r = await callBotWishlist<{ items: BotItem[] }>(userId, { op: 'list', character: name });
    out.set(name, r.ok ? new Map(r.items.map(i => [i.item_id, i.bid])) : null);
  }));
  return out;
}

/** Everything one control needs for `itemIds`: the member's characters, where each item is already listed, the default character. */
export async function loadWishView(
  userId: string,
  itemIds: number[],
  opts: { preferred?: string | null; owned?: OwnedChar[] } = {},
): Promise<WishView | null> {
  const owned = opts.owned ?? await ownedCharacters(userId);
  const characters = wishlistCharacters(owned, opts.preferred);
  if (characters.length === 0) return null;
  const view: WishView = {
    enabled: wishlistWritesEnabled(),
    characters,
    defaultCharacter: pickDefaultCharacter(characters, opts.preferred),
    states: new Map(),
  };
  const ids = [...new Set(itemIds.filter(n => Number.isInteger(n) && n > 0))];
  if (ids.length === 0) return view;

  // One response holds 1,000 rows: size the id chunks so characters x ids cannot pass it.
  const sb = supabaseAdmin();
  const size = Math.max(1, Math.floor(1000 / characters.length));
  const rows: ListRow[] = [];
  for (let i = 0; i < ids.length; i += size) {
    const { data } = await sb.from('wishlists').select('item_id, character_name, priority')
      .in('item_id', ids.slice(i, i + size)).in('character_name', characters).limit(1000);
    rows.push(...((data ?? []) as ListRow[]));
  }
  const listed = [...new Set(rows.map(r => r.character_name))];
  const bids = await bidsFor(userId, listed);
  for (const r of rows) {
    const mine = bids.get(r.character_name);
    const s: WishState = { priority: r.priority, bid: mine?.get(r.item_id) ?? null, bidKnown: !!mine };
    view.states.set(r.item_id, { ...(view.states.get(r.item_id) ?? {}), [r.character_name]: s });
  }
  return view;
}

export type ListedItem = { item_id: number; priority: number | null; bid: number | null; bidKnown: boolean };

/** Each character's whole list (no bids selected), with the member's own pre-bids from the bot. For /me/wishlist. */
export async function loadLists(userId: string, characters: string[]): Promise<{ enabled: boolean; lists: Map<string, ListedItem[]> }> {
  const enabled = wishlistWritesEnabled();
  const lists = new Map<string, ListedItem[]>(characters.map(c => [c, []]));
  if (characters.length === 0) return { enabled, lists };
  const { data } = await supabaseAdmin().from('wishlists').select('item_id, character_name, priority')
    .in('character_name', characters).order('character_name').order('item_id').limit(1000);
  const rows = (data ?? []) as ListRow[];
  const bids = await bidsFor(userId, [...new Set(rows.map(r => r.character_name))]);
  for (const r of rows) {
    const mine = bids.get(r.character_name);
    lists.get(r.character_name)?.push({ item_id: r.item_id, priority: r.priority, bid: mine?.get(r.item_id) ?? null, bidKnown: !!mine });
  }
  for (const list of lists.values()) list.sort((a, b) => (a.priority ?? 99) - (b.priority ?? 99) || a.item_id - b.item_id);
  return { enabled, lists };
}
