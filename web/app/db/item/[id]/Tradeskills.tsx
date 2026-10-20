// Tradeskill section for /db/item — the grouped index: PQDI's shape, Result of /
// Component in, split by tradeskill, recipe names as chips with the trivial. Scans
// fast and scales to any count (Water Flask sits in 744); the ingredients are one
// click away on /db/recipe/<id>. A member, 2026-09-24: "our pages don't have
// tradeskill recipes or quests listed". The guild lead picked this layout over the
// inline-combine one on 2026-10-19 (DECISIONS §383).
//
// Reads item_recipes() (supabase/migrations/20260924141000_item_recipes.sql).

import Link from 'next/link';
import { type RecipePart, tradeskillName, isQuestCombine } from '@/lib/tradeskills';

export type ItemRecipe = {
  recipe_id: number; name: string; tradeskill: number | null; trivial: number | null;
  nofail: boolean; role: 'made' | 'used' | 'tool' | 'container'; parts: RecipePart[] | null;
};

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
