// /me/upgrades — the gear upgrade finder: for one of the signed-in member's own characters, each worn slot's
// current item and the three best upgrades that exist in the current era, scored for the class, with where
// each one drops or sells and whether it is already on that character's wishlist.
//
// The guild lead's pick from the Decision Desk (2026-10-19, DECISIONS §383; the companion gap of §94). New page,
// so it goes live with the [beta] tag (DECISIONS §135). First slice: the scoring model is web/lib/gearUpgrades.ts
// and its tuning table is web/lib/gearWeights.ts.
//
// Read-only; no migration. Data: character_gear (what is worn and carried), eqemu_items (the stats and the pool of
// candidates), eqemu_npc_drops / eqemu_merchantlist / eqemu_zone (where each can be had, current era only),
// wishlists (the character's own list; the viewer is the owner, and the bid columns are never selected).
//
// Privacy. The page is scoped to the viewer's OWN characters (ownedCharacters), which is also what makes the
// wishlist safe to show: a wishlist is private to its owner. A character with exclude_inventory or
// exclude_from_stats set is opted out: its gear is not read at all and the page says so (isOptedOut runs
// BEFORE the first character_gear read). The URL carries one character name, checked against the owned list.
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters, type OwnedChar } from '@/lib/ownedCharacters';
import { selectAll } from '@/lib/selectAll';
import NewPageTag from '@/components/NewPageTag';
import {
  rankUpgrades, selectTop, candidateIds, scoredClass, resolveWeights, levelCap, expansionCap, isOptedOut,
  UPGRADE_SLOTS, type ItemStats, type SlotResult, type Upgrade, type Source, type Equipped,
} from '@/lib/gearUpgrades';
import {
  loadItemPool, loadItems, loadZones, loadSources, loadSpellNames, loadWishlist,
} from '@/lib/gearUpgradesLoad';
import {
  STAT_KEYS, STAT_LABEL, MIN_GAIN, TOP_N, BASE_TIERS, CLASS_TIERS, TIER_POINTS, MR_BELOW_FLOOR_TIER,
  type StatKey, type Tier,
} from '@/lib/gearWeights';
import { MR_FLOOR } from '@/lib/raidKit';

export const metadata: Metadata = {
  title: '[beta] Gear upgrades',
  description: 'For one of your characters, the best upgrade for every worn slot in the current era, scored for the class, with where it drops or sells.',
};

export const dynamic = 'force-dynamic';

const TIER_ORDER: Tier[] = ['crit', 'high', 'med', 'low'];
const signed = (n: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n)}`;
const fmtScore = (n: number) => (Math.round(n * 10) / 10).toString();

/** The stats an item carries that the class weighs (or the headline ones), as a short line. */
function statLine(it: ItemStats | null, keys: StatKey[]): string {
  if (!it) return '';
  const parts: string[] = [];
  for (const k of keys) {
    const v = k === 'dmgRatio'
      ? ((it.delay ?? 0) > 0 && (it.damage ?? 0) > 0 ? `${it.damage}/${it.delay}` : null)
      : (it[k] ? String(it[k]) : null);
    if (v) parts.push(`${STAT_LABEL[k]} ${v}`);
  }
  return parts.join(' · ');
}

function sourceText(s: Source): string {
  if (s.kind === 'bag') return 'Already in your bags';
  const where = s.zone ?? 'an unknown zone';
  if (s.kind === 'vendor') return `Sold in ${where}${s.npc ? ` by ${s.npc}` : ''}`;
  return `Drops in ${where}${s.npc ? ` from ${s.npc}` : ''}${s.chance != null && s.chance > 0 ? ` (${s.chance}%)` : ''}`;
}

export default async function UpgradesPage({ searchParams }: { searchParams: Promise<{ c?: string }> }) {
  const { c } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/upgrades');

  const owned = await ownedCharacters(user.id);
  // Characters the picker offers: a class the finder can score, and not tucked away by the owner. The one the
  // URL names is always offered (a hidden mule can still be asked for), but only if it is the viewer's own.
  const wanted = (c ?? '').trim().toLowerCase();
  const pick: OwnedChar | undefined =
    owned.find(o => o.name.toLowerCase() === wanted)
    ?? owned.find(o => o.active && !o.hidden_from_lists && scoredClass(o.class))
    ?? owned.find(o => !o.hidden_from_lists && scoredClass(o.class));
  const choices = owned.filter(o => scoredClass(o.class) && (!o.hidden_from_lists || o === pick));

  return (
    <div className="space-y-6">
      <NewPageTag note="First slice of the gear upgrade finder: per-slot upgrades scored for your class." />
      <div className="text-sm">
        <Link href="/me" className="text-blue hover:underline">← back to My Stats</Link>
      </div>

      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-2xl text-gold mb-1">⬆ Gear upgrades</h2>
        <p className="text-sm text-dim leading-6">
          For one of your characters: what is worn in each slot, and the three best swaps that exist in the
          current era, scored for the class. Each upgrade says where it drops or sells and whether it is on your
          wishlist. Private to you: only your own characters are listed.
        </p>
        {choices.length > 0 && (
          <form method="get" className="mt-4 flex flex-wrap items-center gap-2 text-sm">
            <label htmlFor="c" className="text-dim">Character</label>
            <select id="c" name="c" defaultValue={pick?.name} className="bg-bg border border-border rounded px-2 py-1 text-text">
              {choices.map(o => (
                <option key={o.name} value={o.name}>{o.name}{o.class ? ` (${o.class})` : ''}</option>
              ))}
            </select>
            <button type="submit" className="px-3 py-1 rounded border border-border bg-bg text-blue hover:underline">Show upgrades</button>
          </form>
        )}
      </section>

      {!pick ? (
        <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">
          None of your characters has a class we can score yet. Link your characters on{' '}
          <Link href="/me" className="text-blue hover:underline">My Stats</Link>, then come back.
        </section>
      ) : (
        await CharacterUpgrades({ pick })
      )}
    </div>
  );
}

async function CharacterUpgrades({ pick }: { pick: OwnedChar }) {
  const sb = supabaseAdmin();
  const name = pick.name;
  if (!/^[A-Za-z]{2,}$/.test(name)) {
    return <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">That character name is not one we can look up.</section>;
  }

  // The owner's opt-outs are read first, and an opted-out character stops here: its gear is never read.
  const { data: flagRows } = await sb
    .from('characters')
    .select('name, race, class, exclude_inventory, exclude_from_stats')
    .eq('guild_id', 'wolfpack')
    .ilike('name', name)
    .limit(1);
  const flags = ((flagRows ?? [])[0] ?? null) as { race: string | null; class: string | null; exclude_inventory: boolean | null; exclude_from_stats: boolean | null } | null;
  if (isOptedOut(flags)) {
    return (
      <section className="bg-panel border border-border rounded-lg p-6">
        <h3 className="text-lg text-gold mb-2">{name}</h3>
        <p className="text-sm text-dim">
          You opted this character out of {flags?.exclude_inventory ? 'inventory tracking' : 'stats'} on My Stats, so
          nothing about its gear is collected or read here. Turn the option off there to use the finder.
        </p>
      </section>
    );
  }

  const className = flags?.class ?? pick.class;
  const race = flags?.race ?? null;
  const base = scoredClass(className);
  if (!base) {
    return <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">{name}&apos;s class is not known yet, so there are no weights to score with.</section>;
  }

  const gear = await selectAll<{ loc: string; slot: string; item_id: number; item_name: string }>((from, to) => sb
    .from('character_gear')
    .select('loc, slot, item_id, item_name')
    .ilike('character', name)
    .order('character').order('loc').order('slot')
    .range(from, to) as any);
  const wornRows = gear.filter(g => g.loc === 'equipped');
  if (wornRows.length === 0) {
    return (
      <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim leading-6">
        <h3 className="text-lg text-gold mb-2">{name}</h3>
        No gear snapshot yet. Generate <code>{name}Quarmy.txt</code> in game and leave Mimic running; it uploads within
        about ten minutes. Then this page can compare what is worn with what exists.
      </section>
    );
  }

  const now = new Date();
  const cap = levelCap(now);
  const expCap = expansionCap(now);
  const bagIds = new Set(gear.filter(g => g.loc === 'bag').map(g => g.item_id));

  const [pool, wornItems, zones, wishlist] = await Promise.all([
    loadItemPool(sb, cap),
    loadItems(sb, [...wornRows.map(g => g.item_id), ...bagIds]),
    loadZones(sb),
    loadWishlist(sb, name),
  ]);

  const equipped: Equipped[] = [];
  for (const g of wornRows) {
    const it = wornItems.get(g.item_id);
    if (it && UPGRADE_SLOTS.some(s => s.name === g.slot)) equipped.push({ slot: g.slot, item: it });
  }
  // Items in the bags are candidates even when they are not in the pool (their stats were read above).
  const poolIds = new Set(pool.map(p => p.id));
  const bagExtras = [...bagIds].map(id => wornItems.get(id)).filter((x): x is ItemStats => !!x && !poolIds.has(x.id));
  const results = rankUpgrades({ className, race, equipped, pool: [...pool, ...bagExtras], levelCap: cap });
  if (!results) return null;

  const ids = candidateIds(results);
  const [sources, finalistItems] = await Promise.all([
    loadSources(sb, ids, zones, expCap),
    loadItems(sb, ids),
  ]);
  // Anything already carried needs no drop source.
  for (const id of ids) {
    if (bagIds.has(id)) sources.set(id, [{ kind: 'bag', zone: null, expansion: null, npc: null, chance: null }, ...(sources.get(id) ?? [])]);
  }

  const perSlot = results.map(r => ({ r, top: selectTop(r.candidates, sources) }));
  // Names and effect labels for what is on screen.
  const shown = perSlot.flatMap(p => p.top.map(u => finalistItems.get(u.item.id) ?? u.item));
  const spellIds = [...shown, ...equipped.map(e => e.item)].flatMap(i => [i.focus_effect, i.worneffect]).filter((x): x is number => !!x && x > 0);
  const spellNames = await loadSpellNames(sb, spellIds);

  const weights = resolveWeights(base, equipped.map(e => e.item));
  const keys = STAT_KEYS.filter(k => weights[k] > 0);
  const wornMrNow = equipped.reduce((s, e) => s + (e.item.mr ?? 0), 0);

  const wins = perSlot
    .filter(p => p.top.length > 0)
    .map(p => ({ slot: p.r.slot, top: p.top[0] }))
    .sort((a, b) => b.top.gain - a.top.gain)
    .slice(0, 5);

  const tierGroups = TIER_ORDER.map(t => ({
    tier: t,
    stats: STAT_KEYS.filter(k => weightTier(base, equipped, k) === t).map(k => STAT_LABEL[k]),
  })).filter(g => g.stats.length > 0);

  return (
    <>
      <section className="bg-panel border border-border rounded-lg p-4 space-y-3">
        <h3 className="text-lg text-gold">{name} <span className="text-dim text-sm">· {base}</span></h3>
        <p className="text-xs text-dim leading-5">
          How a {base} is scored here:{' '}
          {tierGroups.map((g, i) => (
            <span key={g.tier}>{i > 0 && ' · '}<b className="text-text">{g.tier}</b> {g.stats.join(', ')}</span>
          ))}.
          {' '}Worn magic resist is {wornMrNow} (raid rule 12 wants {MR_FLOOR}
          {wornMrNow < MR_FLOOR ? ', so MR counts for more until you reach it' : ', met'}). Attack stops counting at 250 worn,
          haste does not stack, and the best swap must gain at least {MIN_GAIN} point.
        </p>
        {wins.length > 0 ? (
          <div>
            <div className="text-xs text-orange mb-1">Biggest wins</div>
            <ul className="text-sm space-y-1">
              {wins.map(w => (
                <li key={w.slot} className="flex flex-wrap items-baseline gap-x-2">
                  <span className="text-dim w-24 shrink-0">{w.slot}</span>
                  <ItemLink it={finalistItems.get(w.top.item.id) ?? w.top.item} />
                  <span className="text-green text-xs">+{fmtScore(w.top.gain)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : (
          <p className="text-sm text-dim">Nothing in the current era beats what {name} is wearing by enough to suggest. Nice kit.</p>
        )}
      </section>

      <div className="space-y-3">
        {perSlot.map(({ r, top }) => (
          <SlotCard
            key={r.slot} r={r} top={top} keys={keys}
            finalists={finalistItems} wishlist={wishlist} spellNames={spellNames}
          />
        ))}
      </div>

      <p className="text-[11px] text-dim leading-5">
        First slice. Scores are a guide, not a verdict: they weigh the numbers on the item, not set bonuses, quests or
        what your raid will actually have to loot. Items with no known drop or vendor (quest rewards, crafted pieces)
        are not suggested yet. Only stats on the item count; +ATK and haste that ride a worn spell are not read.
        Worn gear comes from your Quarmy export, so run it again after a swap.
      </p>
    </>
  );
}

// The tier a stat sits at for this class and worn set, for the "how it is scored" line.
function weightTier(base: string, equipped: Equipped[], k: StatKey): Tier {
  let t: Tier = CLASS_TIERS[base]?.[k] ?? BASE_TIERS[k];
  const mr = equipped.reduce((s, e) => s + (e.item.mr ?? 0), 0);
  if (k === 'mr' && mr < MR_FLOOR && TIER_POINTS[MR_BELOW_FLOOR_TIER] > TIER_POINTS[t]) t = MR_BELOW_FLOOR_TIER;
  return t;
}

function ItemLink({ it }: { it: ItemStats }) {
  return (
    <Link href={`/db/item/${it.id}`} className="text-blue hover:underline">{it.name ?? `Item #${it.id}`}</Link>
  );
}

function SlotCard({ r, top, keys, finalists, wishlist, spellNames }: {
  r: SlotResult; top: Upgrade[]; keys: StatKey[];
  finalists: Map<number, ItemStats>; wishlist: Map<number, number | null>; spellNames: Map<number, string>;
}) {
  const cur = r.current;
  const effect = (it: ItemStats) => {
    const f = it.focus_effect && it.focus_effect > 0 ? spellNames.get(it.focus_effect) : null;
    const w = it.worneffect && it.worneffect > 0 ? spellNames.get(it.worneffect) : null;
    return [f ? `Focus: ${f}` : null, w ? `Worn: ${w}` : null].filter(Boolean).join(' · ');
  };
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm text-orange">{r.slot}</h4>
        <span className="text-[11px] text-dim">
          {cur ? <>wearing <b className="text-text">{cur.name ?? `Item #${cur.id}`}</b> · score {fmtScore(r.currentScore)}</> : 'empty'}
        </span>
      </div>
      {cur && <p className="text-[11px] text-dim mt-0.5">{statLine(cur, keys)}</p>}

      {top.length === 0 ? (
        <p className="text-xs text-dim mt-2">
          {r.note ?? (r.candidates.length > 0
            ? 'Better pieces exist, but none with a known drop or vendor in the current era.'
            : `Nothing in the current era beats this by ${MIN_GAIN}+ points.`)}
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {top.slice(0, TOP_N).map((u, i) => {
            const it = finalists.get(u.item.id) ?? u.item;
            const wish = wishlist.has(u.item.id);
            const prio = wishlist.get(u.item.id);
            const fx = effect(it);
            return (
              <li key={u.item.id} className="rounded border border-border bg-bg p-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-dim text-xs">{i + 1}.</span>
                  <ItemLink it={it} />
                  <span className="text-green text-xs">+{fmtScore(u.gain)} points</span>
                  {wish && (
                    <span className="text-[10px] tracking-wide uppercase px-1.5 py-0.5 rounded bg-gold/15 border border-gold/50 text-gold">
                      on your wishlist{prio != null ? ` · priority ${prio}` : ''}
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-dim mt-1">{statLine(it, keys)}</p>
                {u.diffs.length > 0 && (
                  <p className="text-[11px] mt-1 flex flex-wrap gap-x-3">
                    {u.diffs.slice(0, 6).map(d => (
                      <span key={d.key} className={d.diff > 0 ? 'text-green' : 'text-red'} title={d.capped ? 'Counted up to the cap, not the full number' : undefined}>
                        {d.label} {signed(d.diff)}{d.capped ? ' (capped)' : ''}
                      </span>
                    ))}
                  </p>
                )}
                {fx && <p className="text-[11px] text-dim mt-1">{fx}</p>}
                <p className="text-xs text-text mt-1">
                  {sourceText(u.best)}
                  {u.sources.length > 1 && <span className="text-dim"> · +{u.sources.length - 1} more source{u.sources.length > 2 ? 's' : ''}</span>}
                </p>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
