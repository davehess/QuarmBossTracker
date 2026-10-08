// Tradeskill section for /db/item — two layouts on beta for the guild lead to
// pick from (?v=b / ?v=c; no ?v= is production's page, the baseline). A member,
// 2026-09-24: "our pages don't have tradeskill recipes or quests listed".
//
//   B  INLINE COMBINES — each recipe carries its whole combine on one line
//      (components → result, container, skill/trivial). Answers "what else do I
//      need?" without a click. The first INLINE_CAP recipes get the detail line;
//      the rest collapse to a name list, because Water Flask sits in 744.
//   C  GROUPED INDEX — PQDI's shape: Result of / Component in, split by
//      tradeskill, recipe names as chips with the trivial. Scans fast and scales
//      to any count; ingredients are one click away on /db/recipe/<id>.
//
// Both read item_recipes() (supabase/migrations/20260924141000_item_recipes.sql).
// When one is picked, graduate it and delete the other in the same change.

import Link from 'next/link';
import {
  type RecipePart, splitParts, partLabel, containerLabel,
  skillLine, tradeskillName, isQuestCombine,
} from '@/lib/tradeskills';

export type ItemRecipe = {
  recipe_id: number; name: string; tradeskill: number | null; trivial: number | null;
  nofail: boolean; role: 'made' | 'used' | 'tool' | 'container'; parts: RecipePart[] | null;
};

export const INLINE_CAP = 25;

const ROLES = [
  { role: 'made',      title: 'Made by' },
  { role: 'used',      title: 'Used in' },
  { role: 'tool',      title: 'Tool in',       note: 'returned on success' },
  { role: 'container', title: 'Container for' },
] as const;

function Shell({ children, empty }: { children: React.ReactNode; empty: boolean }) {
  return (
    <section className="bg-panel border border-border rounded-lg p-4">
      <h2 className="text-sm text-orange mb-2">Tradeskills</h2>
      {empty ? <p className="text-dim text-xs">Not part of any tradeskill recipe in the mirror.</p> : children}
    </section>
  );
}

const RecipeLink = ({ r }: { r: ItemRecipe }) => (
  <Link href={`/db/recipe/${r.recipe_id}`} className="text-text hover:text-blue hover:underline">{r.name}</Link>
);

// ── B: inline combines ──────────────────────────────────────────────────────
export function TradeskillsInline({ recipes, itemId }: { recipes: ItemRecipe[]; itemId: number }) {
  return (
    <Shell empty={!recipes.length}>
      {ROLES.map(({ role, title, ...rest }) => {
        const list = recipes.filter(r => r.role === role);
        if (!list.length) return null;
        const detailed = list.filter(r => r.parts);
        const more = list.filter(r => !r.parts);
        const note = 'note' in rest ? rest.note : null;
        return (
          <div key={role} className="mb-3 last:mb-0">
            <h3 className="text-xs text-dim uppercase tracking-wide mb-1">
              {title} ({list.length}){note && <span className="normal-case tracking-normal"> — {note}</span>}
            </h3>
            {detailed.length > 0 && (
              <ul className="text-sm space-y-1">
                {detailed.map(r => <InlineRow key={r.recipe_id} r={r} itemId={itemId} />)}
              </ul>
            )}
            {more.length > 0 && (
              <p className="text-[11px] text-dim mt-1.5 leading-relaxed">
                {detailed.length > 0 ? `and ${more.length} more: ` : ''}
                {more.map((r, i) => (
                  <span key={r.recipe_id}>{i > 0 && ', '}<RecipeLink r={r} /></span>
                ))}
              </p>
            )}
          </div>
        );
      })}
    </Shell>
  );
}

function InlineRow({ r, itemId }: { r: ItemRecipe; itemId: number }) {
  const { containers, tools, components, results } = splitParts(r.parts);
  // The item this page is about reads in gold instead of as a link to itself,
  // so the eye finds where it sits in the combine.
  const part = (p: RecipePart, n: number, tone: string) => p.id === itemId
    ? <span className="text-gold">{partLabel(p, n)}</span>
    : <Link href={`/db/item/${p.id}`} className={`${tone} hover:text-blue hover:underline`}>{partLabel(p, n)}</Link>;
  const join = (xs: React.ReactNode[]) => xs.map((x, i) => <span key={i}>{i > 0 && ', '}{x}</span>);
  return (
    <li className="border-b border-border/30 pb-1">
      <RecipeLink r={r} />
      <span className="text-dim text-[11px]">
        {' · '}{skillLine(r.tradeskill, r.trivial)}
        {containers.length > 0 && <> · in {containers.map(c => containerLabel(c)).join(' or ')}</>}
        {r.nofail && ' · never fails'}
      </span>
      <div className="text-[11px] text-dim">
        {join(components.map(p => part(p, p.c, 'text-text/90')))}
        {tools.length > 0 && <> + {join(tools.map(p => part(p, p.c, 'text-text/90')))} <span className="text-dim/70">(kept)</span></>}
        {results.length > 0 && <> → {join(results.map(p => part(p, p.s, 'text-green/90')))}</>}
      </div>
    </li>
  );
}

// ── C: grouped index ────────────────────────────────────────────────────────
// A group opens by default only when the whole role is short enough to read at
// a glance; Water Flask's 744 arrive as closed per-skill groups.
const OPEN_UNDER = 40;

export function TradeskillsGrouped({ recipes }: { recipes: ItemRecipe[] }) {
  return (
    <Shell empty={!recipes.length}>
      {ROLES.map(({ role, title, ...rest }) => {
        const list = recipes.filter(r => r.role === role);
        if (!list.length) return null;
        const note = 'note' in rest ? rest.note : null;
        const bySkill = new Map<string, ItemRecipe[]>();
        for (const r of list) {
          const k = tradeskillName(r.tradeskill);
          if (!bySkill.has(k)) bySkill.set(k, []);
          bySkill.get(k)!.push(r);
        }
        const groups = [...bySkill.entries()].sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]));
        const open = list.length < OPEN_UNDER;
        return (
          <div key={role} className="mb-3 last:mb-0">
            <h3 className="text-xs text-dim uppercase tracking-wide mb-1">
              {title} ({list.length}){note && <span className="normal-case tracking-normal"> — {note}</span>}
            </h3>
            <div className="space-y-1.5">
              {groups.map(([skill, rs]) => (
                <details key={skill} open={open} className="group">
                  <summary className="cursor-pointer text-xs text-text/80 hover:text-text select-none">
                    {skill} <span className="text-dim">({rs.length})</span>
                  </summary>
                  <div className="flex flex-wrap gap-1.5 mt-1 ml-3 text-sm">
                    {rs.map(r => (
                      <Link key={r.recipe_id} href={`/db/recipe/${r.recipe_id}`}
                        className="px-2 py-0.5 rounded bg-bg border border-border/60 text-text hover:border-blue hover:text-blue">
                        {r.name}
                        {r.trivial && !isQuestCombine(r.tradeskill) ?<span className="text-dim/70 text-[10px] ml-1">{r.trivial}</span> : null}
                      </Link>
                    ))}
                  </div>
                </details>
              ))}
            </div>
          </div>
        );
      })}
    </Shell>
  );
}
