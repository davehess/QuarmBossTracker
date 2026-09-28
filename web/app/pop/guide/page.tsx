// /pop/guide — the PoP checklist: where to start, the must-haves, and who you need for each step
// (the guild lead, 2026-09-28: "where to start, what quests are must haves, what can be done with a
// group or a raid or solo. Make this a checkbox type of thing").
//
// Items live in web/lib/popGuide.ts. Ticks are per character: the ones you tick by hand are saved in
// pop_guide_ticks; the ones whose PoP flag Mimic already recorded (pop_flags) tick themselves.
// Members only, and you only ever see your own characters.
//
// On beta two layouts are up for the guild lead to pick from:
//   default  — the path: one list in progression order, Start here → Plane of Time
//   ?v=b     — who's with you: Solo / Group / Raid columns under a "next must-haves" strip

import Link from 'next/link';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { ownedCharacters } from '@/lib/ownedCharacters';
import GuideChecklist, { type GuideChar } from './GuideChecklist';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'PoP Guide — Wolf Pack' };

export default async function PopGuidePage(
  { searchParams }: { searchParams: Promise<{ v?: string; c?: string }> },
) {
  const { v, c } = await searchParams;
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/pop/guide');

  const mine = await ownedCharacters(user.id);
  const names = mine.map(ch => ch.name);
  const admin = supabaseAdmin();
  const [{ data: tickRows }, { data: flagRows }] = names.length === 0
    ? [{ data: [] }, { data: [] }]
    : await Promise.all([
        admin.from('pop_guide_ticks').select('character_name, item_key')
          .eq('guild_id', 'wolfpack').in('character_name', names),
        // pop_flags.character is free text, so match names case-blind (same as /pop).
        admin.from('pop_flags').select('character, flag_key')
          .or(names.map(n => `character.ilike.${n}`).join(',')).limit(1000),
      ]);

  const chars: GuideChar[] = mine.map(ch => {
    const lc = ch.name.toLowerCase();
    return {
      name: ch.name,
      cls: ch.class,
      isMain: !ch.main_name || ch.main_name.toLowerCase() === lc,
      manual: ((tickRows ?? []) as { character_name: string; item_key: string }[])
        .filter(r => r.character_name.toLowerCase() === lc).map(r => r.item_key),
      flags: ((flagRows ?? []) as { character: string; flag_key: string }[])
        .filter(r => r.character.toLowerCase() === lc && r.flag_key !== 'unmapped').map(r => r.flag_key),
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
      </section>
      <GuideChecklist layout={v === 'b' ? 'who' : 'path'} chars={chars} initial={initial} />
    </div>
  );
}
