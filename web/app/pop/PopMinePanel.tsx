// /pop sidebar, variant C (?v=c): your progress. For the signed-in raider: each of their characters' next flag
// step, the few targets that would move the most people forward, and the essences queue in a glance with a link
// to the full card. Everything comes from what the page has already loaded (the viewer's characters and their
// merged flags, the raid-night planner, the essences queue): no query of its own.
//
// "Next step" is read from the character's flags (web/lib/popNextSteps.ts, the same engine as the checklist's
// "next steps" panel); a step with no flag of its own only shows as done once a later flag proves it, so the
// checklist stays the exact record and is one link away.

import Link from 'next/link';
import { ESSENCES_ANCHOR, ESSENCE_ICON, type MineProgress, type RaidNextRow } from '@/lib/popSidebar';
import { ESSENCES, type NextUp } from '@/lib/essencesQueue';

const cap = 'text-[10px] uppercase tracking-wide text-dim mb-1.5';

export default function PopMinePanel({ demo, rows, hidden, mineHref, guideHref, raid, raidFor, next, queued, base }: {
  demo: boolean; rows: MineProgress[]; hidden: number; mineHref: string; guideHref: string;
  raid: RaidNextRow[]; raidFor: string; next: NextUp[]; queued: number;
  /** '' on the chart (jump in place), else the chart's own address. */
  base: string;
}) {
  return (
    <div className="space-y-4 text-xs">
      <section>
        <div className={`${cap} flex items-center gap-2`}>
          <span>Your characters</span>
          {demo && <span className="text-[9px] font-bold px-1.5 rounded bg-orange/20 border border-orange/60 text-orange">SAMPLE</span>}
        </div>
        {rows.length === 0 ? (
          <p className="text-dim leading-5">
            No characters of yours to show yet. They appear once Mimic sees them in your EQ logs; traders and characters
            under the lowest PoP level are left out.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {rows.map(r => (
              <li key={r.name} className="leading-5">
                <div className="flex items-baseline gap-1.5">
                  {demo ? <b className="text-text">{r.name}</b>
                    : <Link href={`/character/${encodeURIComponent(r.name)}`} className="text-text font-bold hover:underline">{r.name}</Link>}
                  {r.main && <span className="text-[10px] text-gold" title="main">★</span>}
                  <span className="text-dim">{r.cls ?? ''}</span>
                </div>
                {r.finished ? (
                  <div className="text-green">Every line done 🐺</div>
                ) : r.next ? (
                  <div>
                    <div className="text-text line-clamp-3" title={r.next.title}>→ {r.next.title}</div>
                    <div className="text-dim">
                      {r.next.line}{r.next.zone ? ` · ${r.next.zone}` : ''}{r.more > 0 ? ` · +${r.more} more` : ''}
                    </div>
                  </div>
                ) : (
                  <div className="text-orange">Waiting on {r.waitingOn ?? 'a gate'}</div>
                )}
              </li>
            ))}
          </ul>
        )}
        {hidden > 0 && <Link href={mineHref} className="block mt-2 text-blue hover:underline">+{hidden} more in My Characters</Link>}
        <Link href={guideHref} className="block mt-2 text-blue hover:underline">☑ Open my checklist</Link>
      </section>

      <section className="border-t border-border/60 pt-3">
        <div className={cap}>Raid next · {raidFor}</div>
        {raid.length === 0 ? (
          <p className="text-dim leading-5">Everyone counted is caught up. 🐺</p>
        ) : (
          <ul className="space-y-2">
            {raid.map(p => (
              <li key={p.key} className="leading-5">
                <div className="text-text">{p.icon} {p.label}</div>
                <div className="text-dim">
                  <Link href={p.zoneHref} className="hover:underline">{p.zoneShort}</Link>
                  {p.gains > 0 && <> · <span className="text-text">{p.gains}</span> gain it</>}
                  {p.unlocks > 0 && <> · <span className="text-green">+{p.unlocks}</span> through a gate</>}
                </div>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="border-t border-border/60 pt-3">
        <div className={`${cap} flex items-center justify-between`}>
          <span>💠 Essences · {queued} queued</span>
        </div>
        <ul className="space-y-1">
          {ESSENCES.map(e => {
            const n = next.find(x => x.key === e.key);
            return (
              <li key={e.key} className="flex items-baseline justify-between gap-2">
                <span className="text-dim">{ESSENCE_ICON[e.key]} {e.name.replace('Essence of ', '')}</span>
                {n && !n.bid && n.name ? <b className="text-text truncate">{n.name}</b> : <span className="text-gold">bid it</span>}
              </li>
            );
          })}
        </ul>
        <a href={`${base}#${ESSENCES_ANCHOR}`} className="block mt-2 text-blue hover:underline">Full queue ↓</a>
      </section>
    </div>
  );
}
