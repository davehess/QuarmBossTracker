// /db/item/[id] — wpqdi item detail (guild-gated in-house PQDI, #wpqdi).
//
// Reuses the same item_card_info RPC + decoders the inventory hover uses, and
// adds the two things people open pqdi.cc for: where it DROPS (eqemu_npc_drops)
// and where it SELLS (eqemu_merchantlist). Zone per source is resolved via the
// id-encoding trick (floor(id/1000) → eqemu_zone.zone_id) because the drops
// view's zone_short is NULL — see docs/eqemu-catalog-cheatsheet.md.
//
// The route base (/db) is provisional — the product name/route is the guild
// lead's call (see docs/DESIGN-wpqdi.md). Only item is built so far; spell/npc
// clickies still point out to pqdi.cc until those pages land.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import WpDbLink from '@/components/WpDbLink';
import {
  type ItemCard, decodeMask, decodeSlots, fmtPrice,
  CLASS_TAGS, RACE_TAGS, ALL_CLASS_MASK, ALL_RACE_MASK, ERA_LABEL,
} from '@/lib/itemDecode';

export const dynamic = 'force-dynamic';

type DropRow = { npc_id: number; npc_name: string | null; effective_chance: number | null };
type ZoneRow = { zone_id: number; short_name: string; long_name: string | null; expansion: number | null };

const zoneOf = (entityId: number) => Math.floor(entityId / 1000);
const deUnderscore = (s: string | null) => (s ?? '').replace(/_/g, ' ').trim();

export default async function DbItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db/item/${itemId}`);

  const sb = supabaseAdmin();

  const [cardRes, itemRes, dropRes, merchRes] = await Promise.all([
    sb.rpc('item_card_info', { p_item_ids: [itemId] }),
    sb.from('eqemu_items').select('id, name').eq('id', itemId).maybeSingle(),
    sb.from('eqemu_npc_drops').select('npc_id, npc_name, effective_chance').eq('item_id', itemId).limit(500),
    sb.from('eqemu_merchantlist').select('merchantid').eq('item', itemId).limit(500),
  ]);

  const card = ((cardRes.data ?? []) as ItemCard[])[0];
  const itemRow = itemRes.data as { id: number; name: string } | null;
  if (!card && !itemRow) notFound();

  const name = card?.name ?? itemRow?.name ?? `Item #${itemId}`;

  // Dropped-by: dedupe to one row per NPC (keep the best observed chance).
  const dropsByNpc = new Map<number, DropRow>();
  for (const d of ((dropRes.data ?? []) as DropRow[])) {
    const prev = dropsByNpc.get(d.npc_id);
    if (!prev || (d.effective_chance ?? 0) > (prev.effective_chance ?? 0)) dropsByNpc.set(d.npc_id, d);
  }
  const drops = [...dropsByNpc.values()].sort((a, b) => (b.effective_chance ?? 0) - (a.effective_chance ?? 0));

  // Sold-by: dedupe merchants down to distinct zones.
  const merchZoneIds = new Set<number>();
  for (const m of ((merchRes.data ?? []) as { merchantid: number }[])) merchZoneIds.add(zoneOf(m.merchantid));

  // Resolve every referenced zone in one query.
  const zoneIds = new Set<number>([...drops.map(d => zoneOf(d.npc_id)), ...merchZoneIds]);
  const zoneById = new Map<number, ZoneRow>();
  if (zoneIds.size) {
    const { data: zones } = await sb.from('eqemu_zone')
      .select('zone_id, short_name, long_name, expansion').in('zone_id', [...zoneIds]);
    for (const z of ((zones ?? []) as ZoneRow[])) zoneById.set(z.zone_id, z);
  }
  const zoneName = (entityId: number) => {
    const z = zoneById.get(zoneOf(entityId));
    return z ? (z.long_name || z.short_name) : '—';
  };
  const soldZones = [...merchZoneIds].map(zid => zoneById.get(zid)).filter((z): z is ZoneRow => !!z)
    .sort((a, b) => (a.long_name || a.short_name).localeCompare(b.long_name || b.short_name));

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-dim">
        <Link href="/search" className="text-blue hover:underline">← search</Link>
        <span className="mx-2">·</span>
        <span className="text-dim/70">wpqdi · item #{itemId}</span>
      </div>

      {/* Header */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex items-baseline gap-2 flex-wrap">
          <h1 className="text-xl text-gold">{name}</h1>
          {card?.nodrop && <span className="text-[10px] text-gold uppercase tracking-wider">NO DROP</span>}
          {card?.magic  && <span className="text-[10px] text-blue uppercase tracking-wider">MAGIC</span>}
        </div>
        {card?.lore && card.lore !== card.name && (
          <div className="text-purple/90 text-xs mt-1">Lore: {card.lore}</div>
        )}
        {!card && (
          <p className="text-dim text-xs mt-2 italic">Stats aren&apos;t mirrored for this item — sources below (if any) still apply.</p>
        )}
        <div className="mt-3 text-[11px]">
          <a href={`https://www.pqdi.cc/item/${itemId}`} target="_blank" rel="noreferrer"
             className="text-blue hover:underline">View on PQDI ↗</a>
        </div>
      </section>

      {/* Stats */}
      {card && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Stats</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-1 text-sm">
            <Stat k="Slot">{decodeSlots(card.slots)}</Stat>
            <Stat k="Class">{decodeMask(card.classes, CLASS_TAGS, ALL_CLASS_MASK)}</Stat>
            <Stat k="Race">{decodeMask(card.races, RACE_TAGS, ALL_RACE_MASK)}</Stat>
            {!!card.ac && <Stat k="AC">{card.ac}</Stat>}
            {!!card.hp && <Stat k="HP" tone={card.hp > 0 ? 'good' : 'bad'}>{card.hp > 0 ? `+${card.hp}` : card.hp}</Stat>}
            {!!card.mana && <Stat k="Mana" tone={card.mana > 0 ? 'good' : 'bad'}>{card.mana > 0 ? `+${card.mana}` : card.mana}</Stat>}
            {!!card.damage && <Stat k="Dmg / Dly">{`${card.damage} / ${card.delay ?? '?'}`}</Stat>}
            {!!card.attack && <Stat k="Atk" tone="good">+{card.attack}</Stat>}
            {!!card.haste && <Stat k="Haste" tone="good">+{card.haste}%</Stat>}
            {(card.mr || card.cr || card.dr || card.fr || card.pr) ? (
              <Stat k="Resists">
                {[card.mr && `MR ${card.mr}`, card.cr && `CR ${card.cr}`, card.dr && `DR ${card.dr}`,
                  card.fr && `FR ${card.fr}`, card.pr && `PR ${card.pr}`].filter(Boolean).join(' · ')}
              </Stat>
            ) : null}
            {!!card.required_level && <Stat k="Req Level">{card.required_level}</Stat>}
            {!!card.recommended_level && <Stat k="Rec Level">{card.recommended_level}</Stat>}
            {(!!card.weight || !!card.price) && <Stat k="Wt / Sell">{`${card.weight ?? '?'} st · ${fmtPrice(card.price)}`}</Stat>}
            {card.clickeffect != null && card.clickeffect > 0 && (
              <Stat k="Clicky">
                <a href={`https://www.pqdi.cc/spell/${card.clickeffect}`} target="_blank" rel="noreferrer"
                   className="text-blue hover:underline">spell #{card.clickeffect}</a>
                <WpDbLink kind="spell" id={card.clickeffect} />
                {!!card.clicklevel && <span className="text-dim"> (L{card.clicklevel})</span>}
              </Stat>
            )}
          </div>
        </section>
      )}

      {/* Dropped by */}
      <section className="bg-panel border border-border rounded-lg p-4">
        <h2 className="text-sm text-orange mb-2">Dropped by {drops.length ? `(${drops.length})` : ''}</h2>
        {drops.length ? (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-dim text-[10px] uppercase tracking-wide text-left">
                <th className="py-1 pr-3 font-normal">NPC</th>
                <th className="py-1 pr-3 font-normal">Zone</th>
                <th className="py-1 font-normal text-right">Chance</th>
              </tr></thead>
              <tbody>
                {drops.slice(0, 60).map((d, i) => (
                  <tr key={`${d.npc_id}-${i}`} className="border-t border-border/40">
                    <td className="py-1 pr-3 text-text">{deUnderscore(d.npc_name) || `NPC #${d.npc_id}`}</td>
                    <td className="py-1 pr-3 text-dim">{zoneName(d.npc_id)}</td>
                    <td className="py-1 text-right text-green">{d.effective_chance != null ? `${d.effective_chance.toFixed(1)}%` : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {drops.length > 60 && <p className="text-dim text-[10px] mt-2">Showing top 60 of {drops.length}.</p>}
          </div>
        ) : <p className="text-dim text-xs">No drop sources in the mirror.</p>}
      </section>

      {/* Sold by */}
      {soldZones.length > 0 && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Sold by merchants in ({soldZones.length})</h2>
          <div className="flex flex-wrap gap-1.5 text-sm">
            {soldZones.map(z => (
              <span key={z.zone_id} className="px-2 py-0.5 rounded bg-bg border border-border/60 text-text">
                {z.long_name || z.short_name}
                {z.expansion != null && ERA_LABEL[z.expansion] && (
                  <span className="text-dim/70 text-[10px] ml-1">{ERA_LABEL[z.expansion]}</span>
                )}
              </span>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function Stat({ k, children, tone }: { k: string; children: React.ReactNode; tone?: 'good' | 'bad' }) {
  const v = tone === 'good' ? 'text-green' : tone === 'bad' ? 'text-red-400' : 'text-text';
  return (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-dim text-[10px] uppercase tracking-wide">{k}</span>
      <span className={`text-right ${v}`}>{children}</span>
    </div>
  );
}
