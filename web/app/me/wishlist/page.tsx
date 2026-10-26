// /me/wishlist — every wishlist the signed-in member has, in one place, and a search box to add ANY item to one.
//
// The guild lead's pick for "How do you add items for your wishlist?" (2026-10-26): "A then B". A put an Add to
// wishlist control wherever an item shows (item page, raid plan loot, gear upgrades); this is B. New page, so it
// goes live with the [beta] tag (DECISIONS §135).
//
// Per character of the member's own: its list, each item with its priority, the member's OWN sealed pre-bid (shown
// to the owner only, the view /mywishlist gives in Discord), Change pre-bid and Remove. Above the lists: a search by
// item name (WishlistSearch.tsx) whose hits carry the same control as everywhere else.
//
// Privacy. Scoped to ownedCharacters(user.id), never a name from the URL; a wishlist is private to its owner. The
// wishlists read selects item, character and priority only (lib/wishlistLoad.ts); a bid reaches this page only
// through the bot's `list` op, which decrypts for the owner. Every write is the control's three server actions
// (app/me/upgrades/actions.ts), so there is no second write path here.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters } from '@/lib/ownedCharacters';
import NewPageTag from '@/components/NewPageTag';
import { ItemIcon } from '@/components/ItemIcon';
import WishlistControls from '@/components/WishlistControls';
import { loadLists, type ListedItem } from '@/lib/wishlistLoad';
import { pickDefaultCharacter, wishlistCharacters } from '@/lib/wishlistPick';
import WishlistSearch from './WishlistSearch';

export const metadata: Metadata = {
  title: '[beta] My wishlist',
  description: 'Every character of yours with its wishlist, your own sealed pre-bids, and a search to add any item.',
};

export const dynamic = 'force-dynamic';

type ItemInfo = { id: number; name: string; icon: number | null };

/** Names and icons for the items on the lists, 100 ids a request (eqemu_items is a big table: every read is bounded). */
async function loadItemInfo(ids: number[]): Promise<Map<number, ItemInfo>> {
  const out = new Map<number, ItemInfo>();
  const sb = supabaseAdmin();
  for (let i = 0; i < ids.length; i += 100) {
    const { data } = await sb.from('eqemu_items').select('id, name, icon').in('id', ids.slice(i, i + 100)).limit(100);
    for (const r of (data ?? []) as ItemInfo[]) out.set(r.id, r);
  }
  return out;
}

export default async function MyWishlistPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/wishlist');

  const owned = await ownedCharacters(user.id);
  // The picker and the search start on the main and leave out tucked-away characters; a tucked-away one that
  // already has a list still gets its section below.
  const offered = wishlistCharacters(owned);
  const everyone = wishlistCharacters(owned.map(o => ({ ...o, hidden_from_lists: false })));
  const { enabled, lists } = await loadLists(user.id, everyone);
  const info = await loadItemInfo([...new Set([...lists.values()].flatMap(l => l.map(i => i.item_id)))]);
  const byName = new Map(owned.map(o => [o.name, o]));
  const shown = everyone.filter(n => (lists.get(n)?.length ?? 0) > 0 || offered.includes(n));

  return (
    <div className="space-y-6">
      <NewPageTag note="New page: all your wishlists in one place, with a search to add any item." />
      <div className="text-sm">
        <Link href="/me" className="text-blue hover:underline">← back to My Stats</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6 space-y-3">
        <h2 className="text-2xl text-gold">★ My wishlist</h2>
        <p className="text-sm text-dim leading-6">
          Every character of yours with its list. Priority 1 is top BIS and 10 is nice to have. A pre-bid is sealed: only
          you can see it, and if the item drops the bot bids exactly that. It is the same list <code>/wishlist</code> fills
          in Discord. Looking for upgrades instead? <Link href="/me/upgrades" className="text-blue hover:underline">Gear upgrades →</Link>
        </p>
        {offered.length === 0 ? (
          <p className="text-sm text-dim">
            None of your characters is linked yet. Link them on <Link href="/me" className="text-blue hover:underline">My Stats</Link>, then come back.
          </p>
        ) : (
          <WishlistSearch characters={offered} defaultCharacter={pickDefaultCharacter(offered)} enabled={enabled} />
        )}
        {!enabled && (
          <p className="text-xs text-dim">
            Changing a wishlist from the website is not switched on yet, so this page only shows your lists. <code>/wishlist</code> in Discord still works.
          </p>
        )}
      </section>

      {shown.map(name => {
        const c = byName.get(name);
        const list = lists.get(name) ?? [];
        return (
          <section key={name} className="bg-panel border border-border rounded-lg p-4" aria-label={`${name}'s wishlist`}>
            <h3 className="text-lg text-gold">
              {name}
              <span className="text-dim text-sm">
                {c?.class ? ` · ${c.class}` : ''}{!c?.main_name || c.main_name.toLowerCase() === name.toLowerCase() ? ' · main' : ' · alt'}
                {' · '}{list.length} {list.length === 1 ? 'item' : 'items'}
              </span>
            </h3>
            {list.length === 0 ? (
              <p className="text-sm text-dim mt-2">Nothing on this list yet. Search above, or add from an item page.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {list.map(entry => <ListRow key={entry.item_id} name={name} entry={entry} item={info.get(entry.item_id)} enabled={enabled} />)}
              </ul>
            )}
          </section>
        );
      })}
    </div>
  );
}

function ListRow({ name, entry, item, enabled }: { name: string; entry: ListedItem; item: ItemInfo | undefined; enabled: boolean }) {
  const label = item?.name ?? `Item #${entry.item_id}`;
  return (
    <li className="rounded border border-border bg-bg p-3">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <ItemIcon icon={item?.icon} size={20} className="shrink-0" />
        <Link href={`/db/item/${entry.item_id}`} className="text-blue hover:underline">{label}</Link>
      </div>
      <WishlistControls
        itemId={entry.item_id} itemName={label} enabled={enabled}
        characters={[name]} defaultCharacter={name}
        states={{ [name]: { priority: entry.priority, bid: entry.bid, bidKnown: entry.bidKnown } }}
      />
    </li>
  );
}
