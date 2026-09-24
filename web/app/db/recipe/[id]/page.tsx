// /db/recipe/[id] — one tradeskill combine, laid out the way the combine
// window reads: what goes in, what it goes in, what comes out (a member,
// 2026-09-24: "our pages don't have tradeskill recipes or quests listed").
//
// The item page lists the recipes an item takes part in; this is where each of
// them resolves. PQDI's /recipe/<id> is the reference shape — it shows the same
// four lists (components, containers, on success, on failure). Tools that come
// back on success (hammers, files, molds) are split out rather than listed as a
// result: see splitParts in lib/tradeskills.ts for why.

import Link from 'next/link';
import { redirect, notFound } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import {
  type RecipePart, splitParts, partLabel, containerLabel, isWorldContainer, tradeskillName, isQuestCombine,
} from '@/lib/tradeskills';

export const dynamic = 'force-dynamic';

type RecipeRow = {
  id: number; name: string; tradeskill: number | null; skillneeded: number | null;
  trivial: number | null; nofail: number | null; notes: string | null;
};
type EntryRow = { item_id: number; componentcount: number; successcount: number; failcount: number; iscontainer: number };

export default async function DbRecipePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const recipeId = Number(id);
  if (!Number.isInteger(recipeId) || recipeId <= 0) notFound();

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect(`/auth/signin?next=/db/recipe/${recipeId}`);

  const sb = supabaseAdmin();
  const [recRes, entRes] = await Promise.all([
    sb.from('eqemu_tradeskill_recipe')
      .select('id, name, tradeskill, skillneeded, trivial, nofail, notes')
      .eq('id', recipeId).maybeSingle(),
    sb.from('eqemu_tradeskill_recipe_entries')
      .select('item_id, componentcount, successcount, failcount, iscontainer')
      .eq('recipe_id', recipeId).limit(100),
  ]);
  const rec = recRes.data as RecipeRow | null;
  if (!rec) notFound();
  const entries = (entRes.data ?? []) as EntryRow[];

  const itemIds = [...new Set(entries.filter(e => !(e.iscontainer === 1 && e.item_id < 75)).map(e => e.item_id))];
  const nameById = new Map<number, string>();
  if (itemIds.length) {
    const { data } = await sb.from('eqemu_items').select('id, name').in('id', itemIds);
    for (const r of ((data ?? []) as { id: number; name: string }[])) nameById.set(r.id, r.name);
  }
  const parts: RecipePart[] = entries.map(e => ({
    id: e.item_id, n: nameById.get(e.item_id) ?? null,
    c: e.componentcount, s: e.successcount, k: e.iscontainer,
  }));
  const { containers, tools, components, results } = splitParts(parts);
  const onFail = entries.filter(e => e.failcount > 0);

  const itemLink = (p: RecipePart, count: number, tone = 'text-text') => (
    <Link href={`/db/item/${p.id}`} className={`${tone} hover:text-blue hover:underline`}>{partLabel(p, count)}</Link>
  );

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="text-sm text-dim">
        <Link href="/search" className="text-blue hover:underline">← search</Link>
        <span className="mx-2">·</span>
        <span className="text-dim/70">wpqdi · recipe #{recipeId}</span>
      </div>

      <section className="bg-panel border border-border rounded-lg p-4 font-mono">
        <h1 className="text-lg text-gold text-center">{rec.name}</h1>
        <div className="text-[11px] uppercase tracking-wider text-dim mt-1 mb-3 text-center">
          {isQuestCombine(rec.tradeskill)
            ? 'Quest combine'
            : `${tradeskillName(rec.tradeskill)}${rec.trivial ? ` · trivial ${rec.trivial}` : ''}`}
          {rec.nofail ? ' · never fails' : ''}
          {!!rec.skillneeded && ` · needs ${rec.skillneeded} skill`}
        </div>

        <div className="text-sm space-y-2">
          <Row k="Combine in">
            {containers.length
              ? containers.map((c, i) => (
                  <span key={c.id}>
                    {i > 0 && <span className="text-dim"> or </span>}
                    {isWorldContainer(c)
                      ? <span className="text-text">{containerLabel(c)}</span>
                      : <Link href={`/db/item/${c.id}`} className="text-text hover:text-blue hover:underline">{containerLabel(c)}</Link>}
                  </span>
                ))
              : <span className="text-dim">—</span>}
          </Row>
          <Row k="Components">
            {components.length
              ? <List items={components.map(p => itemLink(p, p.c))} />
              : <span className="text-dim">—</span>}
          </Row>
          {tools.length > 0 && (
            <Row k="Tools">
              <List items={tools.map(p => itemLink(p, p.c))} />
              <span className="text-dim text-[11px]"> — returned on success</span>
            </Row>
          )}
          <Row k="Makes">
            {results.length
              ? <List items={results.map(p => itemLink(p, p.s, 'text-green'))} />
              : <span className="text-dim">—</span>}
          </Row>
          {onFail.length > 0 && (
            <Row k="On failure, keep">
              <List items={onFail.map(e => {
                const p = parts.find(x => x.id === e.item_id)!;
                return itemLink(p, e.failcount);
              })} />
            </Row>
          )}
        </div>

        {rec.notes && <p className="text-dim text-xs mt-3">{rec.notes}</p>}
        <div className="mt-3 text-[11px] font-sans">
          <a href={`https://www.pqdi.cc/recipe/${recipeId}`} target="_blank" rel="noreferrer"
             className="text-blue hover:underline">View on PQDI ↗</a>
        </div>
      </section>
    </div>
  );
}

function Row({ k, children }: { k: string; children: React.ReactNode }) {
  return (
    <div className="text-text">
      <span className="text-dim">{k}:</span> {children}
    </div>
  );
}

function List({ items }: { items: React.ReactNode[] }) {
  return <>{items.map((it, i) => <span key={i}>{i > 0 && <span className="text-dim">, </span>}{it}</span>)}</>;
}
