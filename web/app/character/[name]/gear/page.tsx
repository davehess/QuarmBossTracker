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
// AA catalog: the export's AAIndex matches eqemu_altadv_vars.eqmacid
// (verified: Hitya's AAIndex 10 rank 4 ↔ Quarmy skill_id 47 / eqmacid 10 =
// Innate Magic Protection). Quarmy's web payload keys on skill_id instead.
// classes is a bitmask keyed 1 << classId (SHM=10 → 1024); aa_expansion
// 3 = Luclin (live), 4 = PoP (locked until 2026-10-01).
type AaCat = { eqmacid: number; name: string; max_level: number | null; classes: number | null; cost: number | null; aa_expansion: number | null };

const CLASS_ID: Record<string, number> = {
  warrior: 1, cleric: 2, paladin: 3, ranger: 4, 'shadow knight': 5, shadowknight: 5,
  druid: 6, monk: 7, bard: 8, rogue: 9, shaman: 10, necromancer: 11,
  wizard: 12, magician: 13, enchanter: 14,
};

// ── Spell-effect decoding ────────────────────────────────────────────────────
// The Quarm-era item catalog carries no attack/haste/FT columns — those stats
// ride the worn-effect SPELL. eqemu_spells.raw holds all 12 effect slots
// ({eff, base, max} arrays, populated by sync-from-eqmac); the 3 dedicated
// columns are the fallback until the next catalog sync lands.
type SpellRaw = { eff: (number | null)[]; base: (number | null)[]; max: (number | null)[] } | null;
type Fx = { atk: number; hastePct: number; ft: number; focus: string | null };

const RESIST_NAME: Record<number, string> = { 1: 'magic', 2: 'fire', 3: 'cold', 4: 'poison', 5: 'disease' };
const TARGET_NAME: Record<number, string> = { 3: 'group', 4: 'PB AE', 5: 'single-target', 6: 'self', 8: 'targeted AE', 14: 'pet', 41: 'group' };

function decodeSpell(s: any): Fx {
  const raw = (s?.raw ?? null) as SpellRaw;
  const slots: { eff: number; base: number; max: number }[] = [];
  if (raw && Array.isArray(raw.eff)) {
    for (let i = 0; i < raw.eff.length; i++) {
      const eff = raw.eff[i];
      if (eff == null || eff === 254) continue;   // 254 = empty slot
      slots.push({ eff, base: raw.base?.[i] ?? 0, max: raw.max?.[i] ?? 0 });
    }
  } else {
    for (const i of [1, 2, 3]) {
      const eff = s?.[`effect_id_${i}`];
      if (eff == null || eff === 254) continue;
      slots.push({ eff, base: s?.[`effect_base_value_${i}`] ?? 0, max: 0 });
    }
  }
  const fx: Fx = { atk: 0, hastePct: 0, ft: 0, focus: null };
  let primary: string | null = null;
  const quals: string[] = [];
  for (const { eff, base, max } of slots) {
    switch (eff) {
      case 2:   fx.atk += base; break;
      case 11: { const pct = Math.max(base, max) - 100; if (pct > 0) fx.hastePct = Math.max(fx.hastePct, pct); break; }
      case 15:  fx.ft += base; break;
      // Focus primaries
      case 124: primary = `Increased spell damage up to ${Math.max(base, max)}%`; break;
      case 125: primary = `Increased healing up to ${Math.max(base, max)}%`; break;
      case 127: primary = `Spell haste ${Math.max(base, max)}%`; break;
      case 128: primary = `Spell duration +${Math.max(base, max)}%`; break;
      case 129: primary = `Spell range +${Math.max(base, max)}%`; break;
      case 131: primary = `Mana cost reduced up to ${Math.abs(Math.min(base, max))}%`; break;
      // Focus limits
      case 134: if (base > 0) quals.push(`spells up to L${base}`); break;
      case 135: if (RESIST_NAME[base]) quals.push(`${RESIST_NAME[base]} spells`); break;
      case 136: if (TARGET_NAME[base]) quals.push(TARGET_NAME[base]); break;
      case 138: quals.push(base ? 'beneficial' : 'detrimental'); break;
      case 140: quals.push('duration spells'); break;
      case 143: if (base > 0) quals.push(`casts ≥${base / 1000}s`); break;
    }
  }
  if (primary) fx.focus = quals.length ? `${primary} — ${quals.join(', ')}` : primary;
  return fx;
}
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
  let spellFx: Record<number, Fx> = {};
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
      const { data: spellRows } = await sb
        .from('eqemu_spells')
        .select('id, name, raw, effect_id_1, effect_base_value_1, effect_id_2, effect_base_value_2, effect_id_3, effect_base_value_3')
        .in('id', spellIds);
      for (const s of (spellRows ?? []) as any[]) {
        spellNames[s.id] = s.name;
        spellFx[s.id] = decodeSpell(s);
      }
    }
  }
  // Whole AA catalog (~220 rows): resolves trained names AND drives the
  // "available to train" list for the character's class.
  const { data: aaRows } = await sb
    .from('eqemu_altadv_vars')
    .select('eqmacid, name, max_level, classes, cost, aa_expansion');
  const aaCatalog = (aaRows ?? []) as AaCat[];
  return { char, gear, aas, items, spellNames, spellFx, aaCatalog };
}

const fx = (id: number | null | undefined, spellNames: Record<number, string>) =>
  id && id > 0 ? (spellNames[id] || `#${id}`) : null;

export default async function CharacterGearPage({ params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  const decoded = decodeURIComponent(name);
  if (!/^[A-Za-z]{2,}$/.test(decoded)) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/character/${encodeURIComponent(name)}/gear`);

  const { char, gear, aas, items, spellNames, spellFx, aaCatalog } = await load(decoded);

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
  // +ATK, haste %, and Flowing Thought ride the worn-effect SPELL on this
  // era's items (the item catalog has no columns for them), decoded above.
  let acSum = 0, hpSum = 0, manaSum = 0, atkSum = 0, hasteMax = 0, ftSum = 0;
  for (const g of equipped) {
    const it = items[g.item_id];
    if (!it) continue;
    acSum += it.ac ?? 0; hpSum += it.hp ?? 0; manaSum += it.mana ?? 0; atkSum += it.attack ?? 0;
    if ((it.haste ?? 0) > hasteMax) hasteMax = it.haste ?? 0;
    const wfx = it.worneffect && it.worneffect > 0 ? spellFx[it.worneffect] : null;
    if (wfx) {
      atkSum += wfx.atk;
      ftSum  += wfx.ft;
      if (wfx.hastePct > hasteMax) hasteMax = wfx.hastePct;
    }
  }

  const wornEffects = [...new Set(
    equipped
      .map(g => fx(items[g.item_id]?.worneffect, spellNames))
      .filter((x): x is string => !!x),
  )];
  // Focus list keyed by item so the description ("Increased spell damage up
  // to 35% — cold spells up to L65") sits next to what grants it.
  const focusEffects = equipped
    .map(g => {
      const it = items[g.item_id];
      if (!it?.focus_effect || it.focus_effect <= 0) return null;
      const name = spellNames[it.focus_effect] || `#${it.focus_effect}`;
      const desc = spellFx[it.focus_effect]?.focus || null;
      return { item: g.item_name, name, desc };
    })
    .filter((x): x is { item: string; name: string; desc: string | null } => !!x);
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

  // ── AAs: trained vs available ─────────────────────────────────────────────
  const aaByMac = new Map<number, AaCat>();
  for (const a of aaCatalog) if (!aaByMac.has(a.eqmacid)) aaByMac.set(a.eqmacid, a);
  const classBit = char?.class ? 1 << (CLASS_ID[String(char.class).toLowerCase()] ?? 0) : 0;
  const trainedIdx = new Set(aas.map(a => a.aa_index));
  // Live era = Luclin (aa_expansion <= 3). PoP AAs surface as a count only
  // until the 2026-10-01 unlock.
  const availableNow = classBit > 1
    ? aaCatalog.filter(a =>
        (a.aa_expansion ?? 0) <= 3
        && ((a.classes ?? 0) & classBit) !== 0
        && !trainedIdx.has(a.eqmacid))
    : [];
  const popCount = classBit > 1
    ? aaCatalog.filter(a => a.aa_expansion === 4 && ((a.classes ?? 0) & classBit) !== 0).length
    : 0;
  const trainedRanks = aas.reduce((s, a) => s + a.rank, 0);
  const spentPoints = aas.reduce((s, a) => {
    const cat = aaByMac.get(a.aa_index);
    // cost = first-rank cost; later ranks step by cost_inc which we don't
    // mirror — cost × ranks is the right floor for Luclin-era flat-cost AAs.
    return s + (cat?.cost ?? 0) * a.rank;
  }, 0);

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
            <div className="grid grid-cols-3 sm:grid-cols-6 gap-3 text-center">
              {[
                ['AC', acSum], ['HP', hpSum], ['Mana', manaSum], ['+ATK', atkSum],
                ['Haste', hasteMax > 0 ? `${hasteMax}%` : '—'],
                ['FT (mana/tick)', ftSum > 0 ? `+${ftSum}` : '—'],
              ].map(([label, val]) => (
                <div key={String(label)} className="bg-[#1f242c] rounded p-2">
                  <div className="text-lg text-text">{String(val)}</div>
                  <div className="text-[10px] uppercase tracking-wide text-dim">{label}</div>
                </div>
              ))}
            </div>
            <p className="text-xs text-dim mt-2">
              Item stats plus what their worn effects grant (+ATK, haste %, Flowing Thought) — this
              era delivers those via the worn spell, not item columns. The full calculator (base
              stats, softcaps, self-buffs, clicky layers, PvP best-practice buffs) is on the roadmap.
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
                        <td className="pl-4 text-green" title={(it?.focus_effect && spellFx[it.focus_effect]?.focus) || undefined}>
                          {fx(it?.focus_effect, spellNames) || <span className="text-dim">—</span>}
                        </td>
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
                <p className="text-xs text-dim">None detected. Gap analysis against the era&apos;s expected focus list is the next phase.</p>
              ) : (
                <ul className="text-sm space-y-2">
                  {focusEffects.map(f => (
                    <li key={f.item + f.name}>
                      <span className="text-green">{f.name}</span>
                      <span className="text-dim text-xs ml-2">({f.item})</span>
                      {f.desc
                        ? <div className="text-xs text-text">{f.desc}</div>
                        : <div className="text-xs text-dim italic">no decodable benefit — check the item on PQDI</div>}
                    </li>
                  ))}
                </ul>
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
                  <div key={g.loc + g.slot} className="grid grid-cols-[minmax(0,55%)_minmax(0,45%)] items-baseline gap-2 border-b border-border/40 py-0.5">
                    <a href={`https://www.pqdi.cc/item/${g.item_id}`} target="_blank" rel="noreferrer" className="text-blue hover:underline truncate" title={g.item_name}>
                      {g.item_name}{g.count > 1 ? ` ×${g.count}` : ''}
                    </a>
                    <span className="text-dim text-right truncate" title={click ?? undefined}>{click}</span>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section className="bg-panel border border-border rounded-lg p-4">
            <h3 className="text-sm text-orange mb-2">
              AAs — {aas.length} trained ({trainedRanks} ranks{spentPoints > 0 ? `, ≥${spentPoints} points spent` : ''})
            </h3>
            {aas.length === 0 ? (
              <p className="text-xs text-dim">No AA data in the export yet.</p>
            ) : (
              <div className="flex flex-wrap gap-2 text-xs">
                {aas.map(a => {
                  const cat = aaByMac.get(a.aa_index);
                  const maxed = cat?.max_level != null && a.rank >= cat.max_level;
                  return (
                    <span key={a.aa_index} className="px-2 py-0.5 rounded bg-[#1f242c] border border-border">
                      <span className="text-text">{cat?.name || `AA #${a.aa_index}`}</span>{' '}
                      <span className={maxed ? 'text-green' : 'text-dim'}>
                        {a.rank}{cat?.max_level != null ? `/${cat.max_level}` : ''}
                      </span>
                    </span>
                  );
                })}
              </div>
            )}
            {availableNow.length > 0 && (
              <>
                <h4 className="text-xs text-dim uppercase tracking-wide mt-4 mb-2">
                  Available to train ({availableNow.length}{char?.class ? ` for ${char.class}` : ''})
                </h4>
                <div className="flex flex-wrap gap-2 text-xs">
                  {availableNow
                    .slice()
                    .sort((a, b) => a.name.localeCompare(b.name))
                    .map(a => (
                      <span key={a.eqmacid} className="px-2 py-0.5 rounded bg-bg border border-border/60 text-dim">
                        {a.name}
                        {a.max_level != null && <span className="ml-1">0/{a.max_level}</span>}
                        {a.cost != null && a.cost > 0 && <span className="ml-1 text-[10px]">({a.cost}pt)</span>}
                      </span>
                    ))}
                </div>
              </>
            )}
            {popCount > 0 && (
              <p className="text-xs text-dim mt-3">
                +{popCount} more {char?.class} AAs arrive with PoP (locked until Oct 1).
              </p>
            )}
            {classBit <= 1 && aas.length > 0 && (
              <p className="text-xs text-dim mt-3">
                Class unknown — can&apos;t compute the available-to-train list. The roster sync fills
                class in within a few hours of the next OpenDKP pull.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
