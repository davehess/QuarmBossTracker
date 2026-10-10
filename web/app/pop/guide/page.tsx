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
import { LIST_MIN_LEVEL, loadLevels, partitionTiers } from '@/lib/listableChars';
import { guideItemIds } from '@/lib/popGuide';
import { charNextSteps, nextCard, nxMode } from '@/lib/popNextSteps';
import { type ItemCard } from '@/app/character/[name]/inventory/ItemHover';
import GuideChecklist, { type GuideChar } from './GuideChecklist';
import GuideRoute from './GuideRoute';
import NextUp from './NextUp';
import NextTable from './NextTable';
import { loadRoute } from './routeData';
import { GUILD_TAG } from '@/lib/guild';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PoP Checklist — Wolf Pack' };

export default async function PopGuidePage(
  { searchParams }: { searchParams: Promise<{ c?: string; v?: string; all?: string; nx?: string }> },
) {
  const { c, v, all, nx } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/guide');

  // Traders, characters under level 46 and characters their owner hid stay out of the character picker
  // unless ?all=1 (the guild lead, 2026-10-03: "low level characters do not need to show up on the pop
  // flag page"). A character picked on purpose, ?c=<name>, is kept whatever it is: a shared or bookmarked
  // link must still open it. Characters with no known level stay in the picker, in a "No known level"
  // group at the bottom ("put any unknown characters into a minimized area").
  const mineAll = await ownedCharacters(user.id);
  const showAll = all === '1';
  const levels = await loadLevels(supabaseAdmin(), mineAll.map(ch => ch.name));
  const picked = c?.toLowerCase();
  const tiers = partitionTiers(mineAll, ch => ({ rank: ch.rank, level: levels.get(ch.name.toLowerCase()), hidden: ch.hidden_from_lists }));
  const lowKeys = new Set(tiers.hidden.map(ch => ch.name.toLowerCase()));
  const noLevel = tiers.unknown.map(ch => ch.name);
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
        ? `Traders, hidden characters and characters under level ${LIST_MIN_LEVEL} are shown. `
        : `Traders, hidden characters and characters under level ${LIST_MIN_LEVEL} are hidden from the picker (${hiddenCount}). `}
      <Link href={toggleHref} className="text-blue hover:underline">{showAll ? 'Hide them' : 'Show all'}</Link>
    </p>
  );

  // Beta (the guild lead, 2026-10-10: "put at the top of the guide next steps for flags in a consolidated
  // place"): two panels to pick from, over any of the layouts below. ?nx=a is one character's next few steps
  // (NextUp.tsx), ?nx=b is every character at once (NextTable.tsx). No ?nx is this page as production has
  // it: nothing is loaded for it and nothing is drawn. The panels read loadRoute's data, the fullest
  // done-state we have (Mimic, /who, loot, records, ticks), so with ?v=b/c it is the data the layout already
  // loaded. Their links jump to the step's row; the row ids differ by layout.
  const mode = nxMode(nx);
  const routeLoad = (v === 'b' || v === 'c' || mode) ? loadRoute(mine) : null;
  const anchorPrefix = (v === 'b' || v === 'c') ? 'route-' : 'guide-';
  const nxHref = (name: string | null, variant: 'a' | 'b', stepKey?: string) => {
    const q = new URLSearchParams();
    if (name) q.set('c', name);
    if (v === 'b' || v === 'c') q.set('v', v);
    if (all === '1') q.set('all', '1');
    q.set('nx', variant);
    return `/pop/guide?${q}${stepKey ? `#${anchorPrefix}${stepKey}` : ''}`;
  };
  const nxChars = mode ? (await routeLoad!).chars : [];
  const nxRows = nxChars.map(ch => ({ name: ch.name, cls: ch.cls, isMain: ch.isMain, lines: charNextSteps(ch) }));
  const nxFirst = (nxChars.find(ch => c && ch.name.toLowerCase() === c.toLowerCase()) ?? nxChars.find(ch => ch.isMain) ?? nxChars[0])?.name ?? null;
  const nxPanel = mode
    ? (mode === 'a'
      ? <NextUp chars={nxRows.map(r => ({ name: r.name, cls: r.cls, isMain: r.isMain, card: nextCard(r.lines) }))}
                initial={nxFirst} anchorPrefix={anchorPrefix} compareHref={nxHref(null, 'b')} />
      : <NextTable rows={nxRows} hrefFor={(name, key) => nxHref(name, 'b', key)} singleHref={nxHref(nxFirst, 'a')} />)
    : null;

  // Beta (the guild lead, 2026-09-29: "more detail, maps, who to turn things into, expectations and who
  // you will go back to. a sidebar nav with sections"): two layouts to pick from, GuideRoute.tsx. No
  // ?v= is this page as production has it.
  if (v === 'b' || v === 'c') {
    const [{ chars: routeChars, outlines }, { data: routeCards }] = await Promise.all([
      routeLoad!,
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
        {nxPanel}
        <GuideRoute chars={routeChars} initial={first} cards={rc} outlines={outlines} layout={v} noLevel={noLevel} />
      </div>
    );
  }
  const names = mine.map(ch => ch.name);
  const admin = supabaseAdmin();
  const [{ data: tickRows }, { data: flagRows }, { data: cardRows }] = await Promise.all([
    names.length === 0 ? Promise.resolve({ data: [] }) :
      admin.from('pop_guide_ticks').select('character_name, item_key')
        .eq('guild_id', GUILD_TAG).in('character_name', names),
    // pop_flags.character is free text, so match names case-blind (same as /pop). The real flags only:
    // 'unmapped' and 'hail' rows are not flags and there are thousands of them (about 16,000 unmapped
    // across the roster's households on 2026-10-04; three households hold over 1,000 rows each, max 2,291,
    // none of them real). Real flags are the newest rows, so a bare .limit(1000) read the oldest 1,000 and
    // would drop every real flag those households earn. A household holds at most 26 real ones.
    names.length === 0 ? Promise.resolve({ data: [] }) :
      admin.from('pop_flags').select('character, flag_key')
        .not('flag_key', 'in', '(unmapped,hail)')
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
      {nxPanel}
      <GuideChecklist chars={chars} initial={initial} cards={cards} noLevel={noLevel} />
    </div>
  );
}
