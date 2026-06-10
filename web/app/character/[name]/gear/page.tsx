// /character/[name]/gear — BETA. Equipped gear + clickies + AAs ingested from
// the member's in-game Quarmy export (<Name>Quarmy.txt) by the agent.
//
// Privacy (docs/DESIGN-quarmy-gear.md): the agent drops every Bank /
// SharedBank / coin row on the member's machine BEFORE upload — they are not
// in the database at all. exclude_inventory on /me stops the file from being
// read in the first place; the bot refuses writes for excluded characters as
// defense in depth, and this page shows an opt-out panel instead of data.
//
// Effects come from joining item ids against the eqemu_items mirror
// (focus_effect / worneffect / clickeffect / proc_effect → eqemu_spells
// names). worneffect + attack/haste land with the next weekly catalog sync
// (migration 20260610210000 added the columns) — the page says so until then.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

export const dynamic = 'force-dynamic';

type GearRow = { loc: string; slot: string; item_id: number; item_name: string; count: number; updated_at: string };
type AaRow = { aa_index: number; rank: number };
type ItemRow = {
  id: number; name: string; ac: number | null; hp: number | null; mana: number | null;
  damage: number | null; delay: number | null; attack: number | null; haste: number | null;
  focus_effect: number | null; proc_effect: number | null; clickeffect: number | null; worneffect: number | null;
};

const SLOT_ORDER = [
  'Charm', 'Ear1', 'Head', 'Face', 'Ear2', 'Neck', 'Shoulders', 'Arms', 'Back',
  'Wrist1', 'Wrist2', 'Range', 'Hands', 'Primary', 'Secondary',
  'Fingers1', 'Fingers2', 'Chest', 'Legs', 'Feet', 'Waist', 'Ammo',
];
const slotRank = (s: string) => {
  const i = SLOT_ORDER.indexOf(s);
  return i === -1 ? 99 : i;
};

// Worn/click effects that restore sight to the night-blind — called out
// prominently per the owner ask ("supremely important to the blind among us").
const VISION_RX = /infravision|ultravision|see invisible|deadeye|eyes of the cat|faerune|truesight/i;

async function load(decoded: string) {
  const sb = supabaseAdmin();
  const [charRes, gearRes, aaRes] = await Promise.all([
    sb.from('characters')
      .select('name, race, class, exclude_inventory, deity_id, quarmy_synced_at')
      .ilike('name', decoded)
      .limit(1),
    sb.from('character_gear')
      .select('loc, slot, item_id, item_name, count, updated_at')
      .ilike('character', decoded)
      .limit(300),
    sb.from('character_aas')
      .select('aa_index, rank')
      .ilike('character', decoded)
      .order('aa_index')
      .limit(300),
  ]);
  const gear = (gearRes.data ?? []) as GearRow[];
  const aas = (aaRes.data ?? []) as AaRow[];
  const char = (charRes.data && charRes.data[0]) || null;

  const itemIds = [...new Set(gear.map(g => g.item_id))];
  let items: Record<number, ItemRow> = {};
  let spellNames: Record<number, string> = {};
  if (itemIds.length) {
    const { data: itemRows } = await sb
      .from('eqemu_items')
      .select('id, name, ac, hp, mana, damage, delay, attack, haste, focus_effect, proc_effect, clickeffect, worneffect')
      .in('id', itemIds);
    for (const it of (itemRows ?? []) as ItemRow[]) items[it.id] = it;
    const spellIds = [...new Set(
      Object.values(items).flatMap(it =>
        [it.focus_effect, it.proc_effect, it.clickeffect, it.worneffect]
          .filter((x): x is number => typeof x === 'number' && x > 0),
      ),
    )];
    if (spellIds.length) {
      const { data: spellRows } = await sb.from('eqemu_spells').select('id, name').in('id', spellIds);
      for (const s of (spellRows ?? []) as { id: number; name: string }[]) spellNames[s.id] = s.name;
    }
  }
  return { char, gear, aas, items, spellNames };
}

const fx = (id: number | null | undefined, spellNames: Record<number, string>) =>
  id && id > 0 ? (spellNames[id] || `#${id}`) : null;

export default async function CharacterGearPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/gear`);

  const { char, gear, aas, items, spellNames } = await load(decoded);

  if (char?.exclude_inventory) {
    return (
      <div className="space-y-6">
        <div className="text-sm">
          <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
        </div>
        <section className="bg-panel border border-border rounded-lg p-6">
          <h2 className="text-2xl text-gold mb-2">🛡️ {decoded} — Gear</h2>
          <p className="text-sm text-dim">
            This character&apos;s owner opted out of inventory tracking
            (<code>exclude_inventory</code> on /me). Nothing is collected or shown.
          </p>
        </section>
      </div>
    );
  }

  const equipped = gear.filter(g => g.loc === 'equipped').sort((a, b) => slotRank(a.slot) - slotRank(b.slot));
  const bagged = gear.filter(g => g.loc === 'bag' && /-Slot\d+$/.test(g.slot));

  // Item-sum totals — worn contribution only; the full calculator (race/class
  // base, softcaps, self-buffs, clicky layers) is the design doc's phase 7.
  let acSum = 0, hpSum = 0, manaSum = 0, atkSum = 0, hasteMax = 0;
  let wornDataMissing = 0;
  for (const g of equipped) {
    const it = items[g.item_id];
    if (!it) continue;
    acSum += it.ac ?? 0; hpSum += it.hp ?? 0; manaSum += it.mana ?? 0; atkSum += it.attack ?? 0;
    if ((it.haste ?? 0) > hasteMax) hasteMax = it.haste ?? 0;
    if (it.worneffect == null && it.attack == null) wornDataMissing++;
  }

  const wornEffects = [...new Set(
    equipped
      .map(g => fx(items[g.item_id]?.worneffect, spellNames))
      .filter((x): x is string => !!x),
  )];
  const focusEffects = [...new Set(
    equipped
      .map(g => fx(items[g.item_id]?.focus_effect, spellNames))
      .filter((x): x is string => !!x),
  )];
  const visionSources = equipped.filter(g => {
    const it = items[g.item_id];
    const worn = fx(it?.worneffect, spellNames) || '';
    const click = fx(it?.clickeffect, spellNames) || '';
    return VISION_RX.test(worn) || VISION_RX.test(click) || VISION_RX.test(g.item_name);
  });

  const clickies = [...bagged, ...equipped]
    .map(g => ({ g, click: fx(items[g.item_id]?.clickeffect, spellNames) }))
    .filter(x => !!x.click);

  const synced = gear[0]?.updated_at ? new Date(gear[0].updated_at) : null;

  return (
    <div className="space-y-6">
      <div className="text-sm">
        <Link href={`/character/${encodeURIComponent(decoded)}`} className="text-blue hover:underline">← back to {decoded}</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold flex items-center gap-3 mb-1">
          <span>🛡️ {decoded} — Gear</span>
          <span className="text-[10px] tracking-widest font-bold px-2 py-0.5 rounded bg-orange/20 border border-orange/60 text-orange uppercase">Beta</span>
        </h2>
        <p className="text-sm text-dim leading-6">
          Equipped gear, clickies, and AA ranks from this character&apos;s in-game Quarmy export
          (<code>{decoded}Quarmy.txt</code>), picked up automatically while Mimic runs.
          Bank, shared bank, and coin are stripped <b>on the member&apos;s machine</b> before
          anything uploads — they aren&apos;t in our database at all.
          {synced && <> Last sync: {synced.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}.</>}
        </p>
      </section>

      {equipped.length === 0 ? (
        <section className="bg-panel border border-border rounded-lg p-6">
          <p className="text-sm text-dim">
            No gear uploaded yet. Generate the Quarmy export in game (the same{' '}
            <code>{decoded}Quarmy.txt</code> you use for quarmy.com) so it lands in the EQ
            folder, then leave Mimic running — it picks the file up within ~10 minutes.
          </p>
        </section>
      ) : (
        <>
          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-sm text-orange mb-2">Item totals (worn gear only)</h3>
            <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 text-center">
              {[
                ['AC', acSum], ['HP', hpSum], ['Mana', manaSum], ['+ATK', atkSum],
                ['Haste', hasteMax > 0 ? `${hasteMax}%` : '—'],
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-[#1f242c] rounded p-2">
                  <div className="text-lg text-text">{String(val)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-dim">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-dim mt-2">
              Sums of item stats only — the full calculator (base stats, softcaps, self-buffs, clicky
              layers, PvP best-practice buffs) is on the roadmap.
              {wornDataMissing > 0 && <> Worn-effect / +ATK columns populate on the next weekly catalog sync; {wornDataMissing} item(s) are missing that data right now.</>}
            </p>
          </section>

          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-sm text-orange mb-3">Equipped ({equipped.length} slots)</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="text-dim text-xs uppercase">
                  <tr>
                    <th className="text-left py-1">Slot</th>
                    <th className="text-left py-1">Item</th>
                    <th className="text-right py-1">AC</th>
                    <th className="text-right py-1">HP</th>
                    <th className="text-left py-1 pl-4">Focus</th>
                    <th className="text-left py-1 pl-4">Worn</th>
                    <th className="text-left py-1 pl-4">Click</th>
                    <th className="text-left py-1 pl-4">Proc</th>
                  </tr>
                </thead>
                <tbody>
                  {equipped.map(g => {
                    const it = items[g.item_id];
                    const worn = fx(it?.worneffect, spellNames);
                    return (
                      <tr key={g.slot} className="border-t border-border hover:bg-[#1f242c]">
                        <td className="py-1 text-dim">{g.slot.replace(/(\d)$/, ' $1')}</td>
                        <td className="py-1">
                          <a href={`https://www.pqdi.cc/item/${g.item_id}`} target="_blank" rel="noreferrer" className="text-blue hover:underline">
                            {g.item_name}
                          </a>
                        </td>
                        <td className="text-right text-dim">{it?.ac || '—'}</td>
                        <td className="text-right text-dim">{it?.hp || '—'}</td>
                        <td className="pl-4 text-green">{fx(it?.focus_effect, spellNames) || <span className="text-dim">—</span>}</td>
                        <td className={`pl-4 ${worn && VISION_RX.test(worn) ? 'text-gold' : 'text-text'}`}>{worn || <span className="text-dim">—</span>}</td>
                        <td className="pl-4 text-blue">{fx(it?.clickeffect, spellNames) || <span className="text-dim">—</span>}</td>
                        <td className="pl-4 text-orange">{fx(it?.proc_effect, spellNames) || <span className="text-dim">—</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>

          <div className="grid md:grid-cols-2 gap-6">
            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-2">Focus effects worn ({focusEffects.length})</h3>
              {focusEffects.length === 0 ? (
                <p className="text-xs text-dim">None detected (or the catalog hasn&apos;t synced focus names yet). Gap analysis against the era&apos;s expected focus list is the next phase.</p>
              ) : (
                <ul className="text-sm space-y-1">{focusEffects.map(f => <li key={f} className="text-green">{f}</li>)}</ul>
              )}
            </section>

            <section className="bg-panel border border-border rounded-lg p-4">
              <h3 className="text-sm text-orange mb-2">👁 Vision &amp; worn effects</h3>
              {visionSources.length > 0 ? (
                <ul className="text-sm space-y-1 mb-3">
                  {visionSources.map(g => (
                    <li key={g.loc + g.slot} className="text-gold">
                      {g.item_name} <span className="text-dim text-xs">({g.loc === 'bag' ? 'in bags' : g.slot.replace(/(\d)$/, ' $1')})</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-xs text-red mb-3">No vision item detected — night-blind races want infravision/ultravision worn or clickable.</p>
              )}
              {wornEffects.length > 0 && (
                <ul className="text-sm space-y-1">{wornEffects.map(w => <li key={w} className="text-text">{w}</li>)}</ul>
              )}
            </section>
          </div>

          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-sm text-orange mb-2">Clickies ({clickies.length})</h3>
            {clickies.length === 0 ? (
              <p className="text-xs text-dim">No click-effect items found in equipped slots or bags.</p>
            ) : (
              <div className="grid sm:grid-cols-2 gap-x-6 gap-y-1 text-sm">
                {clickies.map(({ g, click }) => (
                  <div key={g.loc + g.slot} className="flex justify-between border-b border-border/40 py-0.5">
                    <a href={`https://www.pqdi.cc/item/${g.item_id}`} target="_blank" rel="noreferrer" className="text-blue hover:underline truncate pr-2">
                      {g.item_name}{g.count > 1 ? ` ×${g.count}` : ''}
                    </a>
                    <span className="text-dim whitespace-nowrap">{click}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-sm text-orange mb-2">AAs ({aas.length} lines, {aas.reduce((s, a) => s + a.rank, 0)} ranks)</h3>
            {aas.length === 0 ? (
              <p className="text-xs text-dim">No AA data in the export yet.</p>
            ) : (
              <>
                <p className="text-xs text-dim mb-2">
                  The export carries AA table indices, not names — the index ↔ name catalog is a
                  follow-up. Raw ranks below.
                </p>
                <div className="flex flex-wrap gap-2 text-xs">
                  {aas.map(a => (
                    <span key={a.aa_index} className="px-2 py-0.5 rounded bg-[#1f242c] border border-border text-dim">
                      AA #{a.aa_index} <span className="text-text">rank {a.rank}</span>
                    </span>
                  ))}
                </div>
              </>
            )}
          </section>
        </>
      )}
    </div>
  );
}
