// /pop/guide — the PoP checklist: where to start, the must-haves, and who you need for each step
// (the guild lead, 2026-09-28: "where to start, what quests are must haves, what can be done with a
// group or a raid or solo. Make this a checkbox type of thing").
//
// Items live in web/lib/popGuide.ts. Ticks are per character: the ones you tick by hand are saved in
// pop_guide_ticks; the ones whose PoP flag Mimic already recorded (pop_flags) tick themselves. Items
// named in a step get the site's item card on hover (item_card_info, one call per render).
// Members only, and you only ever see your own characters.

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { LIST_MIN_LEVEL, loadLevels, partitionListable } from '@/lib/listableChars';
import { guideItemIds } from '@/lib/popGuide';
import { type ItemCard } from '@/app/character/[name]/inventory/ItemHover';
import GuideChecklist, { type GuideChar } from './GuideChecklist';
import GuideRoute from './GuideRoute';
import { loadRoute } from './routeData';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PoP Checklist — Wolf Pack' };

export default async function PopGuidePage(
  { searchParams }: { searchParams: Promise<{ c?: string; v?: string; all?: string }> },
) {
  const { c, v, all } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/guide');

  // Traders and characters under level 46 stay out of the character picker unless ?all=1 (the guild lead,
  // 2026-10-03: "low level characters do not need to show up on the pop flag page"). A character picked
  // on purpose, ?c=<name>, is kept whatever it is: a shared or bookmarked link must still open it.
  const mineAll = await ownedCharacters(user.id);
  const showAll = all === '1';
  const levels = await loadLevels(supabaseAdmin(), mineAll.map(ch => ch.name));
  const picked = c?.toLowerCase();
  const lowKeys = new Set(partitionListable(mineAll, ch => ({ rank: ch.rank, level: levels.get(ch.name.toLowerCase()) }))
    .hidden.map(ch => ch.name.toLowerCase()));
  // Nobody listable at all (a new account of one low-level character): show them rather than an empty
  // picker that reads "no characters linked".
  const mine = showAll || lowKeys.size === mineAll.length
    ? mineAll
    : mineAll.filter(ch => !lowKeys.has(ch.name.toLowerCase()) || ch.name.toLowerCase() === picked);
  const hiddenCount = mineAll.length - mine.length;
  const toggleQuery = new URLSearchParams();
  if (c) toggleQuery.set('c', c);
  if (v) toggleQuery.set('v', v);
  if (!showAll) toggleQuery.set('all', '1');
  const toggleHref = '/pop/guide' + (toggleQuery.toString() ? `?${toggleQuery}` : '');
  const hiddenNote = (showAll ? lowKeys.size > 0 : hiddenCount > 0) && (
    <p className="text-xs text-dim mt-2">
      {showAll
        ? `Traders and characters under level ${LIST_MIN_LEVEL} are shown. `
        : `Traders and characters under level ${LIST_MIN_LEVEL} are hidden from the picker (${hiddenCount}). `}
      <Link href={toggleHref} className="text-blue hover:underline">{showAll ? 'Hide them' : 'Show all'}</Link>
    </p>
  );

  // Beta (the guild lead, 2026-09-29: "more detail, maps, who to turn things into, expectations and who
  // you will go back to. a sidebar nav with sections"): two layouts to pick from, GuideRoute.tsx. No
  // ?v= is this page as production has it.
  if (v === 'b' || v === 'c') {
    const [{ chars: routeChars, outlines }, { data: routeCards }] = await Promise.all([
      loadRoute(mine),
      supabaseAdmin().rpc('item_card_info', { p_item_ids: guideItemIds() }),
    ]);
    const rc: Record<number, ItemCard> = {};
    for (const r of (routeCards ?? []) as ItemCard[]) rc[r.item_id] = r;
    const pickedChar = c ? routeChars.find(ch => ch.name.toLowerCase() === c.toLowerCase()) : undefined;
    const first = (pickedChar ?? routeChars.find(ch => ch.isMain) ?? routeChars[0])?.name ?? null;
    return (
      <div className="max-w-7xl mx-auto flex flex-col gap-4">
        <section className="bg-panel border border-border rounded-lg p-4">
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h1 className="text-lg text-gold">Planes of Power: your checklist</h1>
            <Link href="/pop" className="text-xs text-blue hover:underline">flag chart →</Link>
          </div>
          <p className="text-sm text-dim mt-1 max-w-3xl">
            Where to start, what you can&apos;t skip, who you need, who takes what and who you go back to, by
            progression level. Open a level to see its steps; hover 🗺 for the map. Steps Mimic saw you do, that
            our records already show, or that /who proves (you were seen inside a plane that needs them) tick
            themselves and say which.
          </p>
          {hiddenNote}
        </section>
        <GuideRoute chars={routeChars} initial={first} cards={rc} outlines={outlines} layout={v} />
      </div>
    );
  }
  const names = mine.map(ch => ch.name);
  const admin = supabaseAdmin();
  const [{ data: tickRows }, { data: flagRows }, { data: cardRows }] = await Promise.all([
    names.length === 0 ? Promise.resolve({ data: [] }) :
      admin.from('pop_guide_ticks').select('character_name, item_key')
        .eq('guild_id', 'wolfpack').in('character_name', names),
    // pop_flags.character is free text, so match names case-blind (same as /pop).
    names.length === 0 ? Promise.resolve({ data: [] }) :
      admin.from('pop_flags').select('character, flag_key')
        .or(names.map(n => `character.ilike.${n}`).join(',')).limit(1000),
    admin.rpc('item_card_info', { p_item_ids: guideItemIds() }),
  ]);

  const cards: Record<number, ItemCard> = {};
  for (const r of (cardRows ?? []) as ItemCard[]) cards[r.item_id] = r;

  const chars: GuideChar[] = mine.map(ch => {
    const lc = ch.name.toLowerCase();
    return {
      name: ch.name,
      cls: ch.class,
      isMain: !ch.main_name || ch.main_name.toLowerCase() === lc,
      manual: ((tickRows ?? []) as { character_name: string; item_key: string }[])
        .filter(r => r.character_name.toLowerCase() === lc).map(r => r.item_key),
      flags: ((flagRows ?? []) as { character: string; flag_key: string }[])
        .filter(r => r.character.toLowerCase() === lc && r.flag_key !== 'unmapped' && r.flag_key !== 'hail').map(r => r.flag_key),
    };
  });
  const byParam = c ? chars.find(ch => ch.name.toLowerCase() === c.toLowerCase()) : undefined;
  const initial = (byParam ?? chars.find(ch => ch.isMain) ?? chars[0])?.name ?? null;

  return (
    <div className="max-w-5xl mx-auto flex flex-col gap-4">
      <section className="bg-panel border border-border rounded-lg p-4">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h1 className="text-lg text-gold">Planes of Power: your checklist</h1>
          <Link href="/pop" className="text-xs text-blue hover:underline">flag chart →</Link>
        </div>
        <p className="text-sm text-dim mt-1 max-w-3xl">
          Where to start, what you can&apos;t skip, and who you need for each step. Tick things off as you go;
          your ticks are saved per character, and any flag Mimic has recorded ticks itself.
        </p>
        {hiddenNote}
      </section>
      <GuideChecklist chars={chars} initial={initial} cards={cards} />
    </div>
  );
}
