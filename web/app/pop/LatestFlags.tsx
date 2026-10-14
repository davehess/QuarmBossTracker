// "Latest flags" strip at the top of /pop (the guild lead, 2026-10-14). Server component, no client JS: the
// "2h ago" is computed at request time. The rules and both groupings live in web/lib/popLatestFlags.ts.
//   layout a — newest first, one row per character per moment
//   layout b — grouped by flag step, newest step first

import Link from 'next/link';
import {
  LATEST_DAYS, LATEST_MAX_ROWS, LATEST_MAX_STEPS, LATEST_NAMES_PER_STEP, LATEST_STEPS_PER_ROW,
  agoText, groupByMoment, groupByStep, verifiedBadge, zoneLabel, type LatestRow,
} from '@/lib/popLatestFlags';

const BADGE_CLS: Record<string, string> = {
  event: 'border-green/60 text-green',
  recital: 'border-blue/60 text-blue',
};

const charHref = (name: string) => `/character/${encodeURIComponent(name)}`;

export default function LatestFlags({ layout, rows, now }: { layout: 'a' | 'b'; rows: LatestRow[]; now: number }) {
  const moments = layout === 'a' ? groupByMoment(rows).slice(0, LATEST_MAX_ROWS) : [];
  const steps = layout === 'b' ? groupByStep(rows).slice(0, LATEST_MAX_STEPS) : [];
  const empty = layout === 'a' ? moments.length === 0 : steps.length === 0;
  return (
    <section className="bg-panel border border-border rounded-lg p-4" aria-label="Latest flags">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 mb-2">
        <h3 className="text-base text-orange">Latest flags</h3>
        <span className="text-xs text-dim">
          Done and confirmed by the server or an NPC recital, last {LATEST_DAYS} days
        </span>
        <span className="text-[10px] px-1.5 py-0.5 rounded border border-gold/60 text-gold" title="Layout comparison on beta">
          preview · layout {layout}
        </span>
      </div>
      {empty && <p className="text-sm text-dim">No verified flags in the last {LATEST_DAYS} days.</p>}
      {layout === 'a' && moments.length > 0 && (
        <ul className="divide-y divide-border/50 text-sm">
          {moments.map(m => {
            const badge = verifiedBadge(m.source);
            const zone = zoneLabel(m.zone);
            const shown = m.steps.slice(0, LATEST_STEPS_PER_ROW);
            const more = m.steps.length - shown.length;
            return (
              <li key={`${m.character}|${m.at}`} className="py-1.5 flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                <Link href={charHref(m.character)} className="text-text hover:underline">{m.character}</Link>
                <span className="text-dim min-w-0">
                  {shown.map(s => s.label).join(' · ')}
                  {more > 0 && <span title={m.steps.slice(LATEST_STEPS_PER_ROW).map(s => s.label).join(' · ')}> · +{more} more</span>}
                </span>
                {zone && <span className="text-[11px] text-dim" title={zone.name}>{zone.short}</span>}
                <span className="ml-auto flex items-baseline gap-2 whitespace-nowrap">
                  <span className="text-[11px] text-dim" title={new Date(m.at).toISOString()}>{agoText(now, m.at)}</span>
                  {badge && (
                    <span className={`text-[10px] px-1.5 py-0.5 rounded border ${BADGE_CLS[m.source] ?? ''}`} title={badge.title}>
                      ✓ {badge.label}
                    </span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      )}
      {layout === 'b' && steps.length > 0 && (
        <ul className="divide-y divide-border/50 text-sm">
          {steps.map(g => {
            const zone = zoneLabel(g.zone);
            const shown = g.characters.slice(0, LATEST_NAMES_PER_STEP);
            const more = g.characters.length - shown.length;
            return (
              <li key={g.key} className="py-1.5">
                <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
                  <span className="text-text">{g.label}</span>
                  {zone && <span className="text-[11px] text-dim">({zone.name})</span>}
                  <span className="text-[11px] text-dim ml-auto whitespace-nowrap">
                    {g.characters.length} raider{g.characters.length === 1 ? '' : 's'} · latest {agoText(now, g.at)}
                  </span>
                </div>
                <div className="text-xs text-dim">
                  {shown.map((c, i) => (
                    <span key={c.name}>
                      {i > 0 && ', '}
                      <Link href={charHref(c.name)} className="hover:underline">{c.name}</Link>
                    </span>
                  ))}
                  {more > 0 && <span> and {more} more</span>}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
