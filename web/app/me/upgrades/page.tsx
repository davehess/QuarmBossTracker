// /me/upgrades — the gear upgrade finder: for one of the signed-in member's own characters, each worn slot's
// current item and the three best upgrades that exist in the current era, scored for the class, with where
// each one drops or sells and whether it is already on that character's wishlist.
//
// The guild lead's pick from the Decision Desk (2026-10-19, DECISIONS §383; the companion gap of §94). New page,
// so it goes live with the [beta] tag (DECISIONS §135). First slice: the scoring model is web/lib/gearUpgrades.ts
// and its tuning table is web/lib/gearWeights.ts.
//
// Data: character_gear (what is worn and carried), eqemu_items (the stats and the pool of candidates),
// eqemu_npc_drops / eqemu_merchantlist / eqemu_zone (where each can be had, current era only), item_alt_sources
// (quest rewards and tradeskill recipes for what neither drops nor sells; migration 20261026200000, and the page
// works without it), character_aas + eqemu_aa_effects (the character's stat-cap raises, so the cap is 305 with
// Planar Power, not 280), wishlists (the character's own list; the viewer is the owner, and the bid columns are
// never selected here). The evaluation itself is web/lib/gearUpgradesRun.ts, shared with the gear page.
//
// Caps (2026-10-26): a stat is worth what lands BELOW its cap (web/lib/gearCaps.ts), not its face value, and each
// slot shows how close the swap takes the worn set to ATK 250, Flowing Thought, HP regen, AC and the rest.
//
// Wishlist controls (2026-10-26): each upgrade can be added to the wishlist with a priority and a sealed
// pre-bid, changed or removed (components/WishlistControls.tsx, actions.ts). Those writes, and the read of the member's OWN
// pre-bids, go through the bot (lib/wishlistBot.ts -> utils/webWishlist.js), which holds the only key that can
// encrypt or decrypt a bid. Ears, wrists and rings sit in side-by-side pairs (groupPairedSlots).
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
import ItemIcon from '@/app/character/[name]/inventory/ItemIcon';
import WishlistControls from '@/components/WishlistControls';
import { callBotWishlist, wishlistWritesEnabled, type BotItem } from '@/lib/wishlistBot';
import {
  scoredClass, resolveWeights, isOptedOut, groupPairedSlots, capRows, capRowText, sourceLine,
  type ItemStats, type SlotResult, type Upgrade, type Equipped,
} from '@/lib/gearUpgrades';
import { loadSpellNames, loadWishlist } from '@/lib/gearUpgradesLoad';
import { parseAttrEnd, runUpgradeEval, type UpgradeEval } from '@/lib/gearUpgradesRun';
import { attrCapLabel } from '@/lib/gearCaps';
import {
  STAT_KEYS, STAT_LABEL, MIN_GAIN, TOP_N, BASE_TIERS, CLASS_TIERS, TIER_POINTS, MR_BELOW_FLOOR_TIER,
  ATTR_ASSUMED_NONGEAR, type AttrEnd, type StatKey, type Tier,
} from '@/lib/gearWeights';
import { MR_FLOOR } from '@/lib/raidKit';
import { GUILD_TAG } from '@/lib/guild';

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

export default async function UpgradesPage({ searchParams }: { searchParams: Promise<{ c?: string; ends?: string }> }) {
  const { c, ends } = await searchParams;
  const attrEnd = parseAttrEnd(ends);
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
        <span className="mx-2 text-dim">·</span>
        <Link href="/me/wishlist" className="text-blue hover:underline">★ My wishlist</Link>
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
            <label htmlFor="ends" className="text-dim sm:ml-3">Stats</label>
            <select id="ends" name="ends" defaultValue={attrEnd} className="bg-bg border border-border rounded px-2 py-1 text-text">
              <option value="high">High end: stats already near cap</option>
              <option value="low">Low end: count every stat point</option>
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
        await CharacterUpgrades({ pick, userId: user.id, attrEnd })
      )}
    </div>
  );
}

async function CharacterUpgrades({ pick, userId, attrEnd }: { pick: OwnedChar; userId: string; attrEnd: AttrEnd }) {
  const sb = supabaseAdmin();
  const name = pick.name;
  if (!/^[A-Za-z]{2,}$/.test(name)) {
    return <section className="bg-panel border border-border rounded-lg p-6 text-sm text-dim">That character name is not one we can look up.</section>;
  }

  // The owner's opt-outs are read first, and an opted-out character stops here: its gear is never read.
  const { data: flagRows } = await sb
    .from('characters')
    .select('name, race, class, exclude_inventory, exclude_from_stats')
    .eq('guild_id', GUILD_TAG)
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

  // The ranking, the character's own caps and every source (web/lib/gearUpgradesRun.ts; the gear page runs the same).
  const [ev, wishlist] = await Promise.all([
    runUpgradeEval(sb, { name, className, race, gear, attrEnd }),
    loadWishlist(sb, name),
  ]);
  if (!ev) return null;
  const { equipped, perSlot, finalistItems, ctx, caps } = ev;

  // The member's OWN sealed pre-bids, decrypted by the bot (the key never leaves it). Asked only when the site can
  // reach the bot and something shown is already listed; if the bot does not answer, the cards show no bid line.
  const writesEnabled = wishlistWritesEnabled();
  const shownIds = new Set(perSlot.flatMap(p => p.top.map(u => u.item.id)));
  const anyListed = [...shownIds].some(id => wishlist.has(id));
  const botList = writesEnabled && anyListed
    ? await callBotWishlist<{ items: BotItem[] }>(userId, { op: 'list', character: name })
    : null;
  const bids = new Map<number, number | null>(botList && botList.ok ? botList.items.map(i => [i.item_id, i.bid]) : []);
  const wish = { name, enabled: writesEnabled, bids, bidsKnown: !anyListed || !!(botList && botList.ok) };
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
          {wornMrNow < MR_FLOOR ? ', so MR counts for more until you reach it' : ', met'}). A stat only scores for the part
          that lands under its cap, haste does not stack, and the best swap must gain at least {MIN_GAIN} point.
        </p>
        <CapSummary ev={ev} keys={keys} attrEnd={attrEnd} />
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
        {groupPairedSlots(perSlot, p => p.r.slot).map(g => {
          const cards = g.items.map(({ r, top }) => (
            <SlotCard
              key={r.slot} r={r} top={top} keys={keys} equipped={equipped} caps={caps}
              finalists={finalistItems} wishlist={wishlist} spellNames={spellNames} wish={wish}
            />
          ));
          // Interchangeable slots (ears, wrists, rings) sit together under one heading: stacked on a phone,
          // side by side from md up.
          return g.title ? (
            <section key={g.title} aria-label={g.title} className="space-y-2">
              <h3 className="text-xs uppercase tracking-wide text-dim">{g.title} <span className="normal-case">· either slot</span></h3>
              <div className="grid gap-3 md:grid-cols-2">{cards}</div>
            </section>
          ) : cards;
        })}
      </div>

      <p className="text-[11px] text-dim leading-5">
        Scores are a guide, not a verdict: they weigh the numbers on the item, not set bonuses or what your raid will
        actually have to loot. Quest rewards and crafted pieces are included when nothing drops or sells them; a recipe
        has no zone, so it counts as current era when the item&apos;s level is within the cap. Only stats on the item
        count; +ATK and haste that ride a worn spell are not read. Worn gear comes from your Quarmy export, so run it
        again after a swap.
        {!ev.altOk && <> Quest and crafted sources could not be read just now, so only drops and vendors are listed.</>}
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
    <span className="inline-flex items-center gap-1.5">
      <ItemIcon icon={it.icon} alt={it.name ?? `Item #${it.id}`} size={24} />
      <Link href={`/db/item/${it.id}`} className="text-blue hover:underline">{it.name ?? `Item #${it.id}`}</Link>
    </span>
  );
}

// Where the worn set stands against every cap the class has, and what the stat-cap numbers rest on.
function CapSummary({ ev, keys, attrEnd }: { ev: UpgradeEval; keys: StatKey[]; attrEnd: AttrEnd }) {
  const { ctx, capNow } = ev;
  const rows = capNow.filter(r => keys.includes(r.key));   // only the stats this class weighs
  const text = (r: (typeof capNow)[number]) => {
    if (r.kind === 'max') return `${r.label} ${r.have}%`;
    if (r.kind === 'soft') return `${r.label} ${r.have} / soft cap ${r.cap}`;
    const gear = (['str', 'sta', 'agi', 'dex', 'wis', 'intel', 'cha'] as StatKey[]).includes(r.key) ? ' gear' : '';
    return `${r.label}${gear} ${r.have} / ${r.cap}`;
  };
  const aaText = ctx.aa.used.length > 0
    ? ctx.aa.used.filter((u, i, a) => a.findIndex(x => x.eqmacid === u.eqmacid) === i)
        .map(u => `${u.name} rank ${u.rank}`).join(', ')
    : null;
  return (
    <div className="space-y-1">
      <div className="text-xs text-orange">Worn set against the caps</div>
      <ul className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
        {rows.map(r => {
          const full = r.cap != null && r.kind === 'sum' && r.have >= r.cap;
          return (
            <li key={r.key} title={r.detail ?? undefined} className={full ? 'text-green' : 'text-text'}>{text(r)}{full ? ' ✓' : ''}</li>
          );
        })}
      </ul>
      <p className="text-[11px] text-dim leading-5">
        Stat cap at level {ctx.level}: {attrCapLabel(ctx, 'str')}
        {aaText ? <> (from {aaText})</> : ctx.aa.known ? ' (no cap-raising AAs trained)' : ''}.
        {ctx.aa.known && ctx.aa.mods.wis ? <> Wisdom and intelligence reach {attrCapLabel(ctx, 'wis')} for you.</> : null}
        {' '}Base stats are not in our data, so {attrEnd === 'high'
          ? <><b className="text-text">High end</b> assumes you already hold {ATTR_ASSUMED_NONGEAR.high} of each stat before gear and only counts gear points under the cap</>
          : <><b className="text-text">Low end</b> counts every gear stat point up to the cap</>}.
        {' '}Flowing Thought counts to {ev.caps.manaregen && 'cap' in ev.caps.manaregen ? ev.caps.manaregen.cap : 15} and HP regen to {ev.caps.regen && 'cap' in ev.caps.regen ? ev.caps.regen.cap : 35} for a level {ctx.level} {ctx.base}.
      </p>
    </div>
  );
}

type WishCtx = { name: string; enabled: boolean; bids: Map<number, number | null>; bidsKnown: boolean };

function SlotCard({ r, top, keys, equipped, caps, finalists, wishlist, spellNames, wish: wc }: {
  r: SlotResult; top: Upgrade[]; keys: StatKey[]; equipped: Equipped[]; caps: UpgradeEval['caps'];
  finalists: Map<number, ItemStats>; wishlist: Map<number, number | null>; spellNames: Map<number, string>;
  wish: WishCtx;
}) {
  const cur = r.current;
  const others = equipped.filter(e => e.slot !== r.slot).map(e => e.item);   // the rest of the worn set
  const effect = (it: ItemStats) => {
    const f = it.focus_effect && it.focus_effect > 0 ? spellNames.get(it.focus_effect) : null;
    const w = it.worneffect && it.worneffect > 0 ? spellNames.get(it.worneffect) : null;
    return [f ? `Focus: ${f}` : null, w ? `Worn: ${w}` : null].filter(Boolean).join(' · ');
  };
  return (
    // id = the slot name: the gear page links here (/me/upgrades?c=<name>#Chest)
    <section id={r.slot} className="bg-panel border border-border rounded-lg p-4 scroll-mt-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h4 className="text-sm text-orange">{r.slot}</h4>
        <span className="text-[11px] text-dim inline-flex items-center gap-1.5">
          {cur ? <>{cur.icon != null && <ItemIcon icon={cur.icon} alt={cur.name ?? `Item #${cur.id}`} size={20} />}wearing <b className="text-text">{cur.name ?? `Item #${cur.id}`}</b> · score {fmtScore(r.currentScore)}</> : 'empty'}
        </span>
      </div>
      {cur && <p className="text-[11px] text-dim mt-0.5">{statLine(cur, keys)}</p>}

      {top.length === 0 ? (
        <p className="text-xs text-dim mt-2">
          {r.note ?? (r.candidates.length > 0
            ? 'Better pieces exist, but none with a known drop, vendor, quest or recipe in the current era.'
            : `Nothing in the current era beats this by ${MIN_GAIN}+ points.`)}
        </p>
      ) : (
        <ol className="mt-2 space-y-2">
          {top.slice(0, TOP_N).map((u, i) => {
            const it = finalists.get(u.item.id) ?? u.item;
            const fx = effect(it);
            const cap = capRows(it, cur, others, caps).slice(0, 5).map(capRowText);
            return (
              <li key={u.item.id} className="rounded border border-border bg-bg p-3">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                  <span className="text-dim text-xs">{i + 1}.</span>
                  <ItemLink it={it} />
                  <span className="text-green text-xs">+{fmtScore(u.gain)} points</span>
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
                {cap.length > 0 && (
                  <p className="text-[11px] text-dim mt-1" title="Worn total before → after the swap, against its cap. Stat lines count gear points only.">
                    <span className="text-text">Cap:</span> {cap.join(' · ')}
                  </p>
                )}
                {fx && <p className="text-[11px] text-dim mt-1">{fx}</p>}
                <p className="text-xs text-text mt-1">
                  {sourceLine(u.best)}
                  {u.sources.length > 1 && <span className="text-dim"> · +{u.sources.length - 1} more source{u.sources.length > 2 ? 's' : ''}</span>}
                </p>
                <WishlistControls
                  itemId={u.item.id} itemName={it.name ?? `Item #${u.item.id}`} enabled={wc.enabled}
                  characters={[wc.name]} defaultCharacter={wc.name}
                  states={wishlist.has(u.item.id)
                    ? { [wc.name]: { priority: wishlist.get(u.item.id) ?? null, bid: wc.bids.get(u.item.id) ?? null, bidKnown: wc.bidsKnown } }
                    : {}}
                />
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}
