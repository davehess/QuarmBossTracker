// /admin/spells — officer "who needs the spells we hold" view.
//
// For every spell the guild physically holds as a scroll in someone's
// inventory: who's holding it, the classes that can use it, and which
// spellbook-uploaded characters of those classes are still missing it. This
// is the distribution side of the spell exchange — "we collect these on raids,
// get them to the people who need them" (Uilnayar 2026-06-23).
//
// Gated by the /admin layout (officer only). Backed by the
// guild_held_spell_needs() RPC (migration 20260624020000_spell_exchange.sql).

import Link from 'next/link';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

type HeldSpell = {
  spell_name: string;
  scroll_item_id: number | null;
  class_bitmask: number;
  holders: string[];
  needers: string[];
};

// Decode the EQ item class bitmask back to short class tags for display.
const BIT_TAG: [number, string][] = [
  [1, 'WAR'], [2, 'CLR'], [4, 'PAL'], [8, 'RNG'], [16, 'SHD'],
  [32, 'DRU'], [64, 'MNK'], [128, 'BRD'], [256, 'ROG'], [512, 'SHM'],
  [1024, 'NEC'], [2048, 'WIZ'], [4096, 'MAG'], [8192, 'ENC'], [16384, 'BST'],
];
function classTags(mask: number): string {
  const tags = BIT_TAG.filter(([b]) => (mask & b) > 0).map(([, t]) => t);
  return tags.length ? tags.join(' ') : '—';
}

export default async function AdminSpellsPage() {
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('guild_held_spell_needs', { p_guild_id: 'wolfpack' });
  const rows = (data ?? []) as HeldSpell[];

  // Surface the ones someone actually needs first.
  const withNeeders = rows.filter(r => r.needers.length > 0)
    .sort((a, b) => b.needers.length - a.needers.length || a.spell_name.localeCompare(b.spell_name));
  const noNeeders = rows.filter(r => r.needers.length === 0)
    .sort((a, b) => a.spell_name.localeCompare(b.spell_name));

  return (
    <div className="space-y-6">
      <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📖 Spells we hold → who needs them</h2>
        <p className="text-sm text-dim leading-6">
          Every spell scroll sitting in a guild member&apos;s inventory, matched
          against who can use it and hasn&apos;t scribed it. &quot;Needs it&quot;
          is only computed for characters who&apos;ve uploaded a spellbook
          (otherwise absence is unknown). Spells &amp; spellbooks come from the
          📖 uploads on <Link href="/me" className="text-blue hover:underline">/me</Link>.
        </p>
        {error && <p className="text-xs text-red mt-3">⚠ {error.message}</p>}
        {rows.length === 0 && !error && (
          <p className="text-xs text-orange mt-3">
            No spell scrolls observed in any inventory yet. Once members upload
            inventories containing <code>Spell: …</code> scrolls, they show here.
          </p>
        )}
      </section>

      {withNeeders.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-5">
          <h3 className="text-lg text-orange mb-3">Has a taker ({withNeeders.length})</h3>
          <SpellTable rows={withNeeders} highlightNeeders />
        </section>
      )}

      {noNeeders.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-5">
          <h3 className="text-lg text-orange mb-2">Held, nobody needs ({noNeeders.length})</h3>
          <p className="text-xs text-dim mb-3">
            We have these scrolls but no spellbook-uploaded character is missing
            them — vendor fodder, or for members who haven&apos;t uploaded yet.
          </p>
          <SpellTable rows={noNeeders} />
        </section>
      )}
    </div>
  );
}

function SpellTable({ rows, highlightNeeders }: { rows: HeldSpell[]; highlightNeeders?: boolean }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-dim text-xs text-left">
          <th className="py-1 pr-3">Spell</th>
          <th className="py-1 pr-3">Classes</th>
          <th className="py-1 pr-3">Held by</th>
          <th className="py-1">Needs it</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/40">
        {rows.map(r => (
          <tr key={r.spell_name}>
            <td className="py-1.5 pr-3 text-text">
              {r.scroll_item_id
                ? <a href={`https://pqdi.cc/item/${r.scroll_item_id}`} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{r.spell_name}</a>
                : r.spell_name}
            </td>
            <td className="py-1.5 pr-3 text-dim text-xs tabular-nums">{classTags(r.class_bitmask)}</td>
            <td className="py-1.5 pr-3 text-dim text-xs">{r.holders.join(', ') || '—'}</td>
            <td className={`py-1.5 text-xs ${highlightNeeders ? 'text-green' : 'text-dim'}`}>
              {r.needers.length ? r.needers.join(', ') : '—'}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
