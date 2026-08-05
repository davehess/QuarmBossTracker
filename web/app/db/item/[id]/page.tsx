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
  isNoDrop, isNoRent, isLoreItem, loreText,
  CLASS_TAGS, RACE_TAGS, ALL_CLASS_MASK, ALL_RACE_MASK, ERA_LABEL,
} from '@/lib/itemDecode';

export const dynamic = 'force-dynamic';

type DropRow = { npc_id: number; npc_name: string | null; effective_chance: number | null };
type TurninIO = { item_id: number; qty?: number; kind?: string } | null;
type Turnin = {
  id: number; npc_name: string | null; npc_id: number | null; zone_short: string | null;
  inputs: TurninIO[] | null; outputs: TurninIO[] | null; cash: number | null; exp_award: number | null;
};
type ZoneRow = { zone_id: number; short_name: string; long_name: string | null; expansion: number | null };
// The columns item_card_info does NOT return, read straight off eqemu_items.
type ItemRow = {
  id: number; name: string; lore: string | null; casttime: number | null; norent: boolean | null;
  str: number | null; sta: number | null; dex: number | null; agi: number | null;
  intel: number | null; wis: number | null; cha: number | null;
  worneffect: number | null; worntype: number | null;
  proc_effect: number | null; focus_effect: number | null; itemtype: number | null;
};
const ATTR_ORDER: [keyof ItemRow, string][] = [
  ['str','STR'], ['sta','STA'], ['agi','AGI'], ['dex','DEX'],
  ['wis','WIS'], ['intel','INT'], ['cha','CHA'],
];

const zoneOf = (entityId: number) => Math.floor(entityId / 1000);
const deUnderscore = (s: string | null) => (s ?? '').replace(/_/g, ' ').trim();

export default async function DbItemPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const itemId = Number(id);
  if (!Number.isInteger(itemId) || itemId <= 0) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db/item/${itemId}`);

  const sb = supabaseAdmin();

  const [cardRes, itemRes, dropRes, merchRes, givesRes, getsRes] = await Promise.all([
    sb.rpc('item_card_info', { p_item_ids: [itemId] }),
    sb.from('eqemu_items')
      .select('id, name, lore, casttime, norent, str, sta, dex, agi, intel, wis, cha, '
            + 'worneffect, worntype, proc_effect, focus_effect, itemtype')
      .eq('id', itemId).maybeSingle(),
    sb.from('eqemu_npc_drops').select('npc_id, npc_name, effective_chance').eq('item_id', itemId).limit(500),
    sb.from('eqemu_merchantlist').select('merchantid').eq('item', itemId).limit(500),
    // Quest turn-ins, both directions: what this item is handed IN for, and
    // what hands it OUT. jsonb containment against the arrays of {item_id,…}.
    sb.from('scripted_npc_turnins')
      .select('id, npc_name, npc_id, zone_short, inputs, outputs, cash, exp_award')
      .filter('inputs', 'cs', JSON.stringify([{ item_id: itemId }]))
      .eq('is_duplicate', false).limit(30),
    sb.from('scripted_npc_turnins')
      .select('id, npc_name, npc_id, zone_short, inputs, outputs, cash, exp_award')
      .filter('outputs', 'cs', JSON.stringify([{ item_id: itemId }]))
      .eq('is_duplicate', false).limit(30),
  ]);

  const card = ((cardRes.data ?? []) as ItemCard[])[0];
  const itemRow = itemRes.data as ItemRow | null;
  if (!card && !itemRow) notFound();

  const name = card?.name ?? itemRow?.name ?? `Item #${itemId}`;

  // STR/STA/… are populated on every item and were never rendered: #8733 shows
  // STA 20 / WIS 15 on pqdi.cc and nothing here.
  const attrs = itemRow
    ? ATTR_ORDER.map(([k, label]) => {
        const v = itemRow[k] as number | null;
        return v ? `${label} ${v > 0 ? '+' : ''}${v}` : null;
      }).filter((x): x is string => !!x)
    : [];

  // Effects: show the SPELL NAME the way the in-game item window does
  // ("Effect: JourneymanBoots"), not a bare id.
  //
  // Until 2026-08-04 only the CLICK effect was rendered, so an item whose whole
  // point is a worn or proc effect looked like it had none — #8733 carries
  // Truesight in both `worneffect` and `proc_effect` and the page showed
  // neither (Uilnayar, comparing against pqdi.cc). All three resolve in one
  // query rather than one round trip each.
  const effectIds = [card?.clickeffect, itemRow?.worneffect, itemRow?.proc_effect]
    .filter((n): n is number => typeof n === 'number' && n > 0);
  const spellNameById = new Map<number, string>();
  if (effectIds.length) {
    const { data: sp } = await sb.from('eqemu_spells').select('id, name').in('id', [...new Set(effectIds)]);
    for (const r of ((sp ?? []) as { id: number; name: string }[])) spellNameById.set(r.id, r.name);
  }
  const clickSpellName = card?.clickeffect ? (spellNameById.get(card.clickeffect) ?? null) : null;

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

  // ── Quest turn-ins ─────────────────────────────────────────────────────────
  const gives = (givesRes.data ?? []) as Turnin[];   // hand this item IN
  const gets  = (getsRes.data  ?? []) as Turnin[];   // receive this item
  // Resolve the names of every OTHER item referenced, so the rows read
  // "Ring of Dain → Coldain Insignia Ring" instead of bare ids.
  const refIds = new Set<number>();
  for (const t of [...gives, ...gets]) {
    for (const io of [...(t.inputs ?? []), ...(t.outputs ?? [])]) {
      if (io?.item_id && io.item_id !== itemId) refIds.add(io.item_id);
    }
  }
  const itemNameById = new Map<number, string>();
  if (refIds.size) {
    const { data: refs } = await sb.from('eqemu_items').select('id, name').in('id', [...refIds]);
    for (const r of ((refs ?? []) as { id: number; name: string }[])) itemNameById.set(r.id, r.name);
  }
  const ioLabel = (io: TurninIO) => {
    if (!io?.item_id) return null;
    const nm = io.item_id === itemId ? name : (itemNameById.get(io.item_id) || `#${io.item_id}`);
    return io.qty && io.qty > 1 ? `${nm} ×${io.qty}` : nm;
  };

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
            {[card.magic ? 'MAGIC ITEM' : 'ITEM',
              isLoreItem(itemRow?.lore) ? 'LORE ITEM' : null,
              isNoDrop(card) ? 'NO DROP' : null,
              isNoRent(itemRow) ? 'NO RENT' : null].filter(Boolean).join(' ')}
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
            {attrs.length > 0 && <Line k="Stats">{attrs.join('  ')}</Line>}
            {!!itemRow?.worneffect && itemRow.worneffect > 0 && (
              <Line k="Worn effect">
                <Link href={`/db/spell/${itemRow.worneffect}`} className="text-blue hover:underline">
                  {spellNameById.get(itemRow.worneffect) || `spell #${itemRow.worneffect}`}
                </Link>
              </Line>
            )}
            {!!itemRow?.proc_effect && itemRow.proc_effect > 0 && (
              <Line k="Combat effect">
                <Link href={`/db/spell/${itemRow.proc_effect}`} className="text-blue hover:underline">
                  {spellNameById.get(itemRow.proc_effect) || `spell #${itemRow.proc_effect}`}
                </Link>
              </Line>
            )}
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

        {loreText(card?.lore) && loreText(card?.lore) !== card?.name && (
          <div className="text-purple/90 text-xs mt-3">Lore: {loreText(card?.lore)}</div>
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

      {/* Quest turn-ins — what this is FOR, and what hands it out. */}
      {(gives.length > 0 || gets.length > 0) && (
        <section className="bg-panel border border-border rounded-lg p-4">
          <h2 className="text-sm text-orange mb-2">Quest turn-ins</h2>
          {gives.length > 0 && (
            <>
              <h3 className="text-xs text-dim uppercase tracking-wide mb-1">Hand in to</h3>
              <ul className="text-sm space-y-1 mb-3">
                {gives.map(t => <TurninRow key={`g${t.id}`} t={t} ioLabel={ioLabel} />)}
              </ul>
            </>
          )}
          {gets.length > 0 && (
            <>
              <h3 className="text-xs text-dim uppercase tracking-wide mb-1">Received from</h3>
              <ul className="text-sm space-y-1">
                {gets.map(t => <TurninRow key={`r${t.id}`} t={t} ioLabel={ioLabel} />)}
              </ul>
            </>
          )}
          <p className="text-dim/60 text-[10px] mt-2">Read from the server&apos;s quest scripts — rewards can be conditional (faction, class, or a spoken keyword) in ways a script scrape can&apos;t always see.</p>
        </section>
      )}

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

// "<NPC> (zone): give A, B → get C, D  +exp/coin"
function TurninRow({ t, ioLabel }: { t: Turnin; ioLabel: (io: TurninIO) => string | null }) {
  const give = (t.inputs  ?? []).map(ioLabel).filter(Boolean).join(', ');
  const get  = (t.outputs ?? []).map(ioLabel).filter(Boolean).join(', ');
  return (
    <li className="border-b border-border/30 pb-1">
      <span className="text-text">
        {t.npc_id
          ? <Link href={`/db/npc/${t.npc_id}`} className="hover:text-blue hover:underline">{deUnderscore(t.npc_name)}</Link>
          : deUnderscore(t.npc_name)}
      </span>
      {t.zone_short && <span className="text-dim text-[11px]"> · {t.zone_short}</span>}
      <div className="text-[11px] text-dim">
        {give && <>give <span className="text-text/90">{give}</span></>}
        {give && get ? ' → ' : ''}
        {get && <>get <span className="text-green/90">{get}</span></>}
        {!!t.exp_award && <span className="text-purple/80"> · {t.exp_award.toLocaleString()} exp</span>}
      </div>
    </li>
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
