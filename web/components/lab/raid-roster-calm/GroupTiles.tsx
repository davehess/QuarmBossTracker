'use client';
import { useState } from 'react';
import { type CalmRaider, type CalmView, hpTone } from '@/lib/raidRosterCalmView';
import { AlertStrip, HeaderLine, HP_TEXT, detailFor, hpLabel, type RenderDetail } from './shared';

// Version B, "Group tiles". One tile per raid group, six name chips like the in-game raid window. A chip is
// coloured by state; tapping it opens that raider's detail right under its tile.
function chipClass(r: CalmRaider): string {
  const t = hpTone(r.hp);
  if (r.curse || r.dead || t === 'crit') return 'border-red bg-red/20';
  if (t === 'hurt') return 'border-orange bg-orange/15';
  return 'border-border bg-bg/60';
}

export default function GroupTiles({
  view, renderDetail, fullViewHref,
}: { view: CalmView; renderDetail?: RenderDetail; fullViewHref?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const problems = view.alerts.length;
  return (
    <div className="space-y-3 font-mono">
      <HeaderLine view={view} fullViewHref={fullViewHref} />
      {problems > 0 ? <AlertStrip alerts={view.alerts} onPick={setOpen} /> : null}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
        {view.groups.map((g) => {
          const sel = g.raiders.find((r) => r.name === open) ?? null;
          return (
            <section key={g.label} className="rounded-lg border border-border bg-panel p-2">
              <h2 className="mb-2 px-1 text-sm text-gold">{g.label}</h2>
              <ul className="grid grid-cols-2 gap-1.5">
                {g.raiders.map((r) => (
                  <li key={r.name}>
                    <button
                      type="button" aria-pressed={open === r.name}
                      onClick={() => setOpen(open === r.name ? null : r.name)}
                      className={'flex min-h-[40px] w-full items-baseline justify-between gap-1 rounded border px-2 py-1 text-left text-sm ' + chipClass(r) + (open === r.name ? ' ring-2 ring-accent' : '')}
                    >
                      <span className="truncate text-text">{r.name}</span>
                      <b className={'shrink-0 tabular-nums ' + HP_TEXT[hpTone(r.hp)]}>{r.curse ? <span className="text-red">curse </span> : null}{hpLabel(r)}</b>
                    </button>
                  </li>
                ))}
              </ul>
              {sel ? <div className="mt-2 overflow-hidden rounded border border-border">{detailFor(renderDetail, sel, () => setOpen(null))}</div> : null}
            </section>
          );
        })}
      </div>
    </div>
  );
}
