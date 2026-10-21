// /me/inventory — account-wide inventory. Aggregates every character in the
// signed-in user's family (ownedCharacters) into one item list: total count of
// each item across the account and exactly which character/location holds it.
// Owner-private (your own characters only). Filters + include/exclude live in
// the client explorer.
//
// Location comes from character_inventory.slot_label (EQ /outputfile inventory
// path, which — unlike the Quarmy export — keeps Bank + SharedBank). Category
// tags are derived from eqemu_items (damage/ac/nodrop/itemtype): weapon = has
// damage, armor = has AC and no damage, spell = a Spell/Song/Tome scroll,
// no-drop = the item's NODROP flag (the mirror stores it inverted: false = no
// drop), and a best-effort tradeskill/component heuristic (non-equippable,
// non-weapon/armor/spell, non-consumable) since the mirror carries no
// tradeskill flag.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters } from '@/lib/ownedCharacters';
import InventoryExplorer, { type InvItem } from './InventoryExplorer';
import { selectAll } from '@/lib/selectAll';
import { aggregateInventory, type InvRow, type ItemMeta } from '@/lib/inventoryAggregate';
import { loadAccountPlacements } from '@/lib/accountPlacements';
import { GUILD_TAG } from '@/lib/guild';
import MoreInfo from '@/components/MoreInfo';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: 'My inventory — Wolf Pack',
  description: 'Every item across your characters and where it sits, in one searchable list. Private to you.',
};

export default async function MyInventoryPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/inventory');

  const chars = await ownedCharacters(user.id);
  const charNames = chars.map(c => c.name);

  let items: InvItem[] = [];
  let rowCount = 0;
  let sharedAccountCount = 0;
  if (charNames.length > 0) {
    const admin = supabaseAdmin();
    // Paginated: an active player's family is 2,238 rows today and PostgREST
    // silently caps a single response at 1000 (lib/selectAll.ts) — .limit(50000)
    // never raised it. The guild lead 2026-08-05: "inventory rows for an account looks
    // to be capped at 1000".
    const rows = await selectAll<InvRow>((from, to) => admin
      .from('character_inventory')
      .select('character_name, slot_label, item_id, item_name, quantity, observed_at')
      .eq('guild_id', GUILD_TAG)
      .in('character_name', charNames)
      .order('character_name').order('slot_label')
      .range(from, to));
    rowCount = rows.length;

    // Shared-bank dedup, grouping and tags live in lib/inventoryAggregate.ts, shared with the local page
    // that ships inside Mimic. Owner-placed game accounts beat inference (the guild lead, 2026-10-13); if
    // the tables are not there yet the loader returns nothing and this is the inference-only page.
    const placements = await loadAccountPlacements(admin, GUILD_TAG, charNames);

    const ids = [...new Set(rows.map(r => r.item_id).filter((n): n is number => !!n))];
    const metaById = new Map<number, ItemMeta>();
    for (let i = 0; i < ids.length; i += 800) {
      const { data: meta } = await admin
        .from('eqemu_items')
        .select('id, damage, ac, nodrop, itemtype, slots')
        .in('id', ids.slice(i, i + 800));
      for (const m of (meta ?? []) as ItemMeta[]) metaById.set(m.id, m);
    }

    const agg = aggregateInventory(rows, placements, metaById);
    // A cluster too large to be one account means the scoring misfired; those
    // are left un-deduped (visible duplicates beat hidden losses) and logged
    // so it is noticed rather than silently absorbed.
    for (const grp of agg.oversized) {
      console.warn('[shared-bank] refusing to dedup an implausible account cluster:', grp.join(', '));
    }
    sharedAccountCount = agg.sharedAccountCount;
    items = agg.items;
  }

  return (
    <div className="space-y-6">
      <div className="text-sm"><Link href="/me" className="text-blue hover:underline">← back to /me</Link></div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1">🎒 My account inventory</h2>
        <div className="text-sm text-dim leading-6">
          Everything across <b className="text-text">all your characters</b> at once — total count of each item and
          exactly who&apos;s holding it.
          <MoreInfo>
          Items in the <b className="text-purple">shared bank</b> are tagged, since any
          of your characters can pull those — and they count <b className="text-text">once per game account</b>, not
          once per character (characters placed on a game account are grouped by that account; the
          rest are grouped as &quot;same account?&quot; when their shared-bank contents match).
          Filter by type, and toggle which characters or which places (equipped /
          bags / bank / shared) to include. Data comes from your <code>/outputfile inventory</code> uploads
          (📖 on <Link href="/me" className="text-blue hover:underline">/me</Link>) — only your own characters, private to you.
          </MoreInfo>
        </div>
        <div className="mt-3 text-xs text-dim flex flex-wrap gap-x-6 gap-y-1">
          <span>Characters: <span className="text-text">{chars.length}</span></span>
          <span>Inventory rows: <span className="text-text">{rowCount.toLocaleString()}</span></span>
          <span>Distinct items: <span className="text-text">{items.length.toLocaleString()}</span></span>
          {sharedAccountCount > 0 && (
            <span title="Characters whose shared-bank contents match are grouped as one game account — shared-bank items count once per account, not once per character.">
              Shared banks: <span className="text-text">{sharedAccountCount} account{sharedAccountCount === 1 ? '' : 's'}</span>
            </span>
          )}
        </div>
      </section>

      {charNames.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No characters linked to your account yet — an officer sets that on{' '}
          <Link href="/admin/links" className="text-blue hover:underline">/admin/links</Link>.
        </section>
      ) : items.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          No inventory uploaded yet. In EQ run <code className="text-text">/outputfile inventory</code>, then upload the
          <code className="text-text"> &lt;Char&gt;-Inventory.txt</code> via 📖 on <Link href="/me" className="text-blue hover:underline">/me</Link>{' '}
          (or let Mimic pick it up automatically).
        </section>
      ) : (
        <InventoryExplorer items={items} characters={chars.map(c => ({ name: c.name, cls: c.class, active: c.active }))} />
      )}
    </div>
  );
}
