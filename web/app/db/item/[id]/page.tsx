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
import {
  type ItemCard, decodeMask, decodeSlots, fmtPrice, fmtWeight,
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
    sb.from('eqemu_items').select('id, name, lore, lore_flag, casttime').eq('id', itemId).maybeSingle(),
    sb.from('eqemu_npc_drops').select('npc_id, npc_name, effective_chance').eq('item_id', itemId).limit(500),
    sb.from('eqemu_merchantlist').select('merchantid').eq('item', itemId).limit(500),
  ]);

  const card = ((cardRes.data ?? []) as ItemCard[])[0];
  const itemRow = itemRes.data as
    { id: number; name: string; lore: string | null; lore_flag: boolean | null; casttime: number | null } | null;
  if (!card && !itemRow) notFound();

  const name = card?.name ?? itemRow?.name ?? `Item #${itemId}`;

  // Clicky effect: show the SPELL NAME the way the in-game item window does
  // ("Effect: JourneymanBoots"), not a bare id.
  let clickSpellName: string | null = null;
  if (card?.clickeffect && card.clickeffect > 0) {
    const { data: cs } = await sb.from('eqemu_spells').select('name').eq('id', card.clickeffect).maybeSingle();
    clickSpellName = (cs as { name: string } | null)?.name ?? null;
  }

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

      {/* Item window — laid out like the in-game card: a flags line, then one
          labelled stat per row, in the order EQ prints them. */}
      <section className="bg-panel border border-border rounded-lg p-4 font-mono">
        <h1 className="text-lg text-gold text-center">{name}</h1>

        {card && (
          <div className="text-[11px] uppercase tracking-wider text-dim mt-1 mb-3">
            {[card.magic ? 'MAGIC ITEM' : 'ITEM', card.nodrop ? 'NO DROP' : null,
              itemRow?.lore_flag ? 'LORE ITEM' : null].filter(Boolean).join(' ')}
          </div>
        )}
        {!card && (
          <p className="text-dim text-xs mt-2 italic">Stats aren&apos;t mirrored for this item — sources below (if any) still apply.</p>
        )}

        {card && (
          <div className="text-sm space-y-0.5">
            <Line k="Slot">{decodeSlots(card.slots)}</Line>
            {!!card.ac     && <Line k="AC">{card.ac}</Line>}
            {!!card.hp     && <Line k="HP">{card.hp > 0 ? `+${card.hp}` : card.hp}</Line>}
            {!!card.mana   && <Line k="Mana">{card.mana > 0 ? `+${card.mana}` : card.mana}</Line>}
            {!!card.damage && <Line k="DMG">{card.damage}{card.delay ? <span className="text-dim"> {' '}Dly: {card.delay}</span> : null}</Line>}
            {!!card.attack && <Line k="Attack">+{card.attack}</Line>}
            {!!card.haste  && <Line k="Haste">+{card.haste}%</Line>}
            {(card.mr || card.cr || card.dr || card.fr || card.pr) ? (
              <Line k="Resists">
                {[card.mr && `MR +${card.mr}`, card.cr && `CR +${card.cr}`, card.dr && `DR +${card.dr}`,
                  card.fr && `FR +${card.fr}`, card.pr && `PR +${card.pr}`].filter(Boolean).join('  ')}
              </Line>
            ) : null}
            {card.clickeffect != null && card.clickeffect > 0 && (
              <Line k="Effect">
                <Link href={`/db/spell/${card.clickeffect}`} className="text-blue hover:underline">
                  {clickSpellName || `spell #${card.clickeffect}`}
                </Link>
                <span className="text-dim">
                  {' ('}
                  {card.clicklevel ? `Level ${card.clicklevel}, ` : ''}
                  Casting Time: {itemRow?.casttime ? `${(itemRow.casttime / 1000).toFixed(1)}s` : 'Instant'}
                  {')'}
                </span>
              </Line>
            )}
            <Line k="WT">
              {fmtWeight(card.weight)}
              {!!card.price && <span className="text-dim">{'  '}Value: {fmtPrice(card.price)}</span>}
            </Line>
            <Line k="Class">{decodeMask(card.classes, CLASS_TAGS, ALL_CLASS_MASK)}</Line>
            <Line k="Race">{decodeMask(card.races, RACE_TAGS, ALL_RACE_MASK)}</Line>
            {!!card.required_level && <Line k="Required level">{card.required_level}</Line>}
            {!!card.recommended_level && <Line k="Recommended level">{card.recommended_level}</Line>}
          </div>
        )}

        {card?.lore && card.lore !== card.name && (
          <div className="text-purple/90 text-xs mt-3">Lore: {card.lore}</div>
        )}
        <div className="mt-3 text-[11px] font-sans">
          <a href={`https://www.pqdi.cc/item/${itemId}`} target="_blank" rel="noreferrer"
             className="text-blue hover:underline">View on PQDI ↗</a>
        </div>
      </section>

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

// One "Label: value" row, the way the in-game item window prints them.
function Line({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="text-text">
      <span className="text-dim">{k}:</span> {children}
    </div>
  );
}
