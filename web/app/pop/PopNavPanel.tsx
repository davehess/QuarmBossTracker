// /pop sidebar, variant B (?v=b): navigation. The view buttons that sit in the header card on production
// (whose characters, Chart or Matrix, the checklist, the latest flags) live here, and below them a jump link to
// every tier and plane with its "N in" count: how many of the counted characters can enter it today.
//
// Plain anchors for the jumps: a hash-only link (`base` is '') is a same-page jump with no round trip, and from
// the Matrix or My Characters (no tier sections on screen) `base` is the chart's address, so the link opens the
// chart and lands on the plane.

import Link from 'next/link';
import { ESSENCES_ANCHOR, type NavGroup } from '@/lib/popSidebar';

export type NavLink = { label: string; href: string; title?: string; active?: boolean };

const btn = (active: boolean) =>
  `block px-2 py-1.5 rounded border text-xs ${active ? 'border-gold text-gold' : 'border-border text-dim hover:text-text'}`;
const cap = 'text-[10px] uppercase tracking-wide text-dim mb-1';

export default function PopNavPanel({ scopes, views, extras, groups, base, essencesQueued }: {
  scopes: NavLink[]; views: NavLink[]; extras: NavLink[]; groups: NavGroup[];
  /** '' on the chart (jump in place), else the chart's own address (open it, then jump). */
  base: string; essencesQueued: number;
}) {
  return (
    <nav aria-label="PoP flags navigation" className="space-y-4">
      <div>
        <div className={cap}>Whose characters</div>
        <div className="space-y-1">
          {scopes.map(s => (
            <Link key={s.label} href={s.href} title={s.title} aria-current={s.active ? 'true' : undefined} className={btn(!!s.active)}>{s.label}</Link>
          ))}
        </div>
      </div>
      <div>
        <div className={cap}>How to draw them</div>
        <div className="grid grid-cols-2 gap-1">
          {views.map(v => (
            <Link key={v.label} href={v.href} aria-current={v.active ? 'true' : undefined} className={`${btn(!!v.active)} text-center`}>{v.label}</Link>
          ))}
        </div>
        <div className="space-y-1 mt-1">
          {extras.map(x => <Link key={x.label} href={x.href} className={btn(false)}>{x.label}</Link>)}
        </div>
      </div>
      <div>
        <div className={cap}>Jump to</div>
        <ul className="space-y-3">
          {groups.map(g => (
            <li key={g.tier}>
              <a href={`${base}#${g.id}`} className="block text-[11px] font-bold tracking-wide py-0.5 hover:underline" style={{ color: g.color }}>
                {g.name}
              </a>
              <ul className="mt-0.5">
                {g.zones.map(z => (
                  <li key={z.key}>
                    <a href={`${base}#${z.id}`} title={`${z.name}: ${z.elig} can enter today`}
                       className="flex items-baseline justify-between gap-2 px-2 py-1.5 rounded text-[13px] text-text hover:bg-white/5">
                      <span className="min-w-0 truncate">{z.short}</span>
                      <span className={`text-[10px] px-1.5 rounded border whitespace-nowrap ${z.elig > 0 ? 'border-green/60 text-green' : 'border-border text-dim'}`}>{z.elig} in</span>
                    </a>
                  </li>
                ))}
                {g.tier === 4 && (
                  <li>
                    <a href={`${base}#${ESSENCES_ANCHOR}`}
                       className="flex items-baseline justify-between gap-2 px-2 py-1.5 rounded text-[13px] text-orange hover:bg-white/5">
                      <span className="min-w-0 truncate">💠 Essences</span>
                      <span className="text-[10px] text-dim whitespace-nowrap">{essencesQueued} queued</span>
                    </a>
                  </li>
                )}
              </ul>
            </li>
          ))}
          <li>
            <a href="#pop-spells" className="block px-2 py-1.5 rounded text-[13px] text-text hover:bg-white/5">📜 Spells needed</a>
          </li>
        </ul>
      </div>
    </nav>
  );
}
