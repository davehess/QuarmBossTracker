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
import InventoryExplorer, { type InvItem, type LocGroup } from './InventoryExplorer';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'My inventory — Wolf Pack' };

type InvRow = { character_name: string; slot_label: string; item_id: number | null; item_name: string; quantity: number | null };
type ItemMeta = { id: number; damage: number | null; ac: number | null; nodrop: boolean | null; itemtype: number | null; slots: number | null };

function locGroup(slot: string): LocGroup {
  const s = slot || '';
  if (/^SharedBank/i.test(s)) return 'shared';
  if (/^Bank/i.test(s)) return 'bank';
  if (/^(General|Cursor)/i.test(s) || /-Slot/i.test(s)) return 'bags';
  return 'equipped';
}

const CONSUMABLE_TYPES = new Set([14, 15, 20, 21, 38]); // food/drink/scroll/potion/alcohol

function tagsFor(m: ItemMeta | undefined, name: string): string[] {
  const t: string[] = [];
  const isSpell = /^(Spell|Song|Tome|Ancient):\s/i.test(name) || m?.itemtype === 20;
  if (isSpell) t.push('spell');
  if (m) {
    if ((m.damage ?? 0) > 0) t.push('weapon');
    if ((m.ac ?? 0) > 0 && (m.damage ?? 0) === 0) t.push('armor');
    if (m.nodrop === false) t.push('nodrop');           // mirror stores NODROP as false
    // Tradeskill/components: best-effort — not equippable, not a weapon/armor,
    // not a spell, not a consumable. Catches ore/gems/pages/parts.
    if (!isSpell && (m.damage ?? 0) === 0 && (m.ac ?? 0) === 0 && (m.slots ?? 0) === 0
        && !CONSUMABLE_TYPES.has(m.itemtype ?? -1)) t.push('tradeskill');
  }
  return t;
}

export default async function MyInventoryPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/inventory');

  const chars = await ownedCharacters(user.id);
  const charNames = chars.map(c => c.name);

  let items: InvItem[] = [];
  let rowCount = 0;
  if (charNames.length > 0) {
    const admin = supabaseAdmin();
    const { data: invRaw } = await admin
      .from('character_inventory')
      .select('character_name, slot_label, item_id, item_name, quantity')
      .eq('guild_id', 'wolfpack')
      .in('character_name', charNames)
      .limit(50000);
    const rows = (invRaw ?? []) as InvRow[];
    rowCount = rows.length;

    const ids = [...new Set(rows.map(r => r.item_id).filter((n): n is number => !!n))];
    const metaById = new Map<number, ItemMeta>();
    for (let i = 0; i < ids.length; i += 800) {
      const { data: meta } = await admin
        .from('eqemu_items')
        .select('id, damage, ac, nodrop, itemtype, slots')
        .in('id', ids.slice(i, i + 800));
      for (const m of (meta ?? []) as ItemMeta[]) metaById.set(m.id, m);
    }

    // Aggregate by item (by id when present, else by name).
    const byKey = new Map<string, InvItem>();
    for (const r of rows) {
      const key = r.item_id ? `id:${r.item_id}` : `nm:${r.item_name.toLowerCase()}`;
      let it = byKey.get(key);
      if (!it) {
        it = {
          key, item_id: r.item_id ?? null, name: r.item_name,
          total: 0, tags: tagsFor(r.item_id ? metaById.get(r.item_id) : undefined, r.item_name),
          holdings: [],
        };
        byKey.set(key, it);
      }
      const qty = Math.max(1, r.quantity ?? 1);
      it.total += qty;
      const grp = locGroup(r.slot_label);
      const h = it.holdings.find(x => x.character === r.character_name && x.location === grp);
      if (h) h.qty += qty;
      else it.holdings.push({ character: r.character_name, location: grp, qty });
    }
    items = [...byKey.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  }

  return (
    <div className="space-y-6">
      <div className="text-sm"><Link href="/me" className="text-blue hover:underline">← back to /me</Link></div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1">🎒 My account inventory</h2>
        <p className="text-sm text-dim leading-6">
          Everything across <b className="text-text">all your characters</b> at once — total count of each item and
          exactly who&apos;s holding it. Items in the <b className="text-purple">shared bank</b> are tagged, since any
          of your characters can pull those. Filter by type, and toggle which characters or which places (equipped /
          bags / bank / shared) to include. Data comes from your <code>/outputfile inventory</code> uploads
          (📖 on <Link href="/me" className="text-blue hover:underline">/me</Link>) — only your own characters, private to you.
        </p>
        <div className="mt-3 text-xs text-dim flex flex-wrap gap-x-6 gap-y-1">
          <span>Characters: <span className="text-text">{chars.length}</span></span>
          <span>Inventory rows: <span className="text-text">{rowCount.toLocaleString()}</span></span>
          <span>Distinct items: <span className="text-text">{items.length.toLocaleString()}</span></span>
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
