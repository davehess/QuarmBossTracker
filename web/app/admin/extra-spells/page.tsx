// /admin/extra-spells — officer list of PoP reward scrolls a raider holds but has already scribed.
//
// The guild lead, 2026-10-03: "extra PoP spells. when someone does a turnin for their new spells and
// gets one they already have, put that into an officer only list so we can help direct who needs it."
//
// Phase 1, from data we hold: no turn-in log line has been captured, so an extra is a trainer
// reward scroll in an inventory export whose spell the same character's spellbook export already
// lists. Each row says who holds it, and who still needs the spell in the same first-dibs order the
// /pop page uses. Backed by pop_extra_scrolls() (migration 20261003150000_pop_extra_scrolls.sql),
// which skips characters that opted out of stats or inventory.
//
// A new route, so it carries the [beta] tag (DECISIONS §135). Officer only: the /admin layout
// checks, and so does the page itself (test/admin-pages-officer-gate.test.js).

import Link from 'next/link';
import WpDbLink from '@/components/WpDbLink';
import NewPageTag from '@/components/NewPageTag';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';

export const dynamic = 'force-dynamic';
export const metadata = {
  title: '[beta] Extra PoP spells',
  description: 'Planes of Power spell scrolls the guild holds beyond what its own casters need, and who could use them.',
};

type Needer = { name: string; class: string | null; level: number | null };
type ExtraScroll = {
  holder_name: string;
  holder_class: string | null;
  scroll_item_id: number;
  scroll_name: string;
  spell_name: string;
  slot_label: string | null;
  quantity: number | null;
  inventory_observed_at: string;
  spellbook_observed_at: string;
  needers: Needer[];
};

function fmtAgo(iso: string): string {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 60) return `${Math.max(m, 0)}m ago`;
  if (m < 1440) return `${Math.round(m / 60)}h ago`;
  return `${Math.round(m / 1440)}d ago`;
}

// The spellbook upload replaces the whole book, so its time is when the book last changed. A book
// newer than the bags is the case where the holder may have scribed this scroll since the export.
const scribedSince = (r: ExtraScroll) => Date.parse(r.spellbook_observed_at) > Date.parse(r.inventory_observed_at);

function CharLink({ name }: { name: string }) {
  return <Link href={`/character/${encodeURIComponent(name)}`} className="text-text hover:text-blue hover:underline">{name}</Link>;
}

export default async function AdminExtraSpellsPage() {
  await requireOfficer();
  const sb = supabaseAdmin();
  const { data, error } = await sb.rpc('pop_extra_scrolls', { p_guild_id: GUILD_TAG });
  const rows = (data ?? []) as ExtraScroll[];

  return (
    <div className="space-y-6">
      <NewPageTag />
      <div className="text-sm"><Link href="/admin" className="text-blue hover:underline">← back to admin</Link></div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-1">📜 Extra PoP spells</h2>
        <p className="text-sm text-dim leading-6">
          Trainer reward scrolls a raider is holding and has already scribed, so they can go to someone who
          still needs the spell. Who needs it follows the first-dibs order on{' '}
          <Link href="/pop" className="text-blue hover:underline">/pop</Link>: highest level first.
        </p>
        <p className="text-xs text-dim leading-5 mt-2">
          A scroll can be stale: if the holder scribed it after their last inventory export, it still shows
          until they export again. Rows marked <span className="text-orange">check</span> have a spellbook export
          newer than the bags, which is the case to ask about first.
        </p>
        {error && <p className="text-xs text-red mt-3">⚠ {error.message}</p>}
      </section>

      {rows.length === 0 && !error && (
        <section className="bg-panel border border-border rounded-lg p-5">
          <p className="text-sm text-dim leading-6">
            A reward scroll in someone&apos;s bags whose spell they already have shows here.
            Data comes from inventory exports and spellbook exports (<code>/outputfile inventory</code> and{' '}
            <code>/outputfile spellbook</code>).
          </p>
        </section>
      )}

      {rows.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-5">
          <h3 className="text-lg text-orange mb-3">Extra scrolls ({rows.length})</h3>
          <ExtraTable rows={rows} />
        </section>
      )}
    </div>
  );
}

function ExtraTable({ rows }: { rows: ExtraScroll[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="text-dim text-xs text-left">
          <th className="py-1 pr-3">Spell</th>
          <th className="py-1 pr-3">Held by</th>
          <th className="py-1 pr-3">Needs it (first dibs first)</th>
          <th className="py-1">Seen</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-border/40">
        {rows.map(r => (
          <tr key={`${r.holder_name}|${r.scroll_item_id}|${r.slot_label}`} className="align-top">
            <td className="py-1.5 pr-3 text-text">
              <a href={`https://www.pqdi.cc/item/${r.scroll_item_id}`} target="_blank" rel="noreferrer" className="text-text hover:text-blue hover:underline">{r.spell_name}</a>
              <WpDbLink kind="item" id={r.scroll_item_id} />
            </td>
            <td className="py-1.5 pr-3 text-xs">
              <CharLink name={r.holder_name} />
              {r.holder_class ? <span className="text-dim"> · {r.holder_class}</span> : null}
              <div className="text-dim">{r.slot_label ?? '—'}{r.quantity && r.quantity > 1 ? ` · x${r.quantity}` : ''}</div>
            </td>
            <td className="py-1.5 pr-3 text-xs">
              {r.needers.length === 0 ? <span className="text-dim">nobody on record</span> : (
                <ol className="space-y-0.5">
                  {r.needers.map((n, i) => (
                    <li key={n.name}>
                      <span className="text-dim tabular-nums">{i + 1}. </span>
                      <CharLink name={n.name} />
                      <span className="text-dim">{n.class ? ` · ${n.class}` : ''}{n.level ? ` ${n.level}` : ''}</span>
                    </li>
                  ))}
                </ol>
              )}
            </td>
            <td className="py-1.5 text-xs text-dim">
              <div title={r.inventory_observed_at}>bags {fmtAgo(r.inventory_observed_at)}</div>
              <div title={r.spellbook_observed_at}>
                spellbook {fmtAgo(r.spellbook_observed_at)}
                {scribedSince(r) ? <span className="text-orange"> · check</span> : null}
              </div>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
