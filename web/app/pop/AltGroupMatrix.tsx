// The /pop matrix with alts grouped under their main (?alts=group; the guild lead, 2026-10-14). Server component,
// no client JS: each family with alts is a native <details>, closed unless ?open=1, and the "2d ago" is computed at
// request time. The rules (what is a change, the buckets, the sort) live in web/lib/popAltGroups.ts.
//
// Rows are a CSS grid, not a <table>: a <details> cannot wrap table rows. Every row shares one column template, so
// the gate columns line up between a main, its alts and the next family. The page wraps this in the
// SelfFlagsProvider, so the cells the viewer may tick are the same buttons the flat matrix has.
//
// Two highlight levels, both gold (the site's "highlight" colour) and both said in words as well as colour:
//   changed in the last 24 h    a filled dot, "new today", a solid bar and a stronger wash
//   changed in the last 3 days  a hollow dot, "last 3 days", a thinner bar and a faint wash
// On a collapsed family the dot shows the newest change anywhere in it, so you can see which to open.

import type { ReactNode } from 'react';
import Link from 'next/link';
import type { PopNode } from '@/lib/popFlags';
import { agoText } from '@/lib/popLatestFlags';
import {
  familyLevel, familySummary, levelOf, recentSteps, type ChangeEntry, type ChangeLevel, type Family,
} from '@/lib/popAltGroups';

const BAR: Record<string, string> = {
  day: 'border-gold bg-gold/15',
  recent: 'border-gold/50 bg-gold/[0.06]',
  none: 'border-transparent',
};
const CHIP: Record<string, string> = {
  day: 'border-gold text-gold bg-gold/10',
  recent: 'border-gold/60 text-gold',
};
const CHIP_TEXT: Record<string, string> = { day: '● new today', recent: '○ last 3 days' };
const CHIP_TITLE: Record<string, string> = {
  day: 'A flag changed in the last 24 hours', recent: 'A flag changed in the last 3 days',
};

const charHref = (name: string) => `/character/${encodeURIComponent(name)}`;

function Chip({ level, title }: { level: ChangeLevel; title?: string }) {
  if (!level) return null;
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded border whitespace-nowrap ${CHIP[level]}`} title={title ?? CHIP_TITLE[level]}>
      {CHIP_TEXT[level]}
    </span>
  );
}

export default function AltGroupMatrix<T extends { name: string }>(
  { families, zones, now, openAll, changes, altOf, renderGate, renderFlags }: {
    families: Family<T>[];
    zones: PopNode[];
    now: number;
    openAll: boolean;
    changes: Map<string, ChangeEntry[]>;
    // The main a character belongs to when that main is not on this list (so the alt stands alone), else null.
    altOf: (c: T) => string | null;
    renderGate: (z: PopNode, c: T) => ReactNode;
    renderFlags: (c: T) => ReactNode;
  },
) {
  const template = `minmax(11rem,1.7fr) repeat(${zones.length}, minmax(2.25rem,1fr)) 3.25rem minmax(10rem,1.5fr)`;
  const minWidth = `${Math.round(11 + zones.length * 2.5 + 3.25 + 10)}rem`;
  const grid = { gridTemplateColumns: template } as const;

  // What changed in the last 3 days for one character: the newest steps, the time, and the bar level.
  const changeCell = (c: T) => {
    const entries = changes.get(c.name.toLowerCase());
    const steps = recentSteps(entries, now);
    if (!entries || entries.length === 0) return <span className="text-dim">—</span>;
    const newest = entries[0].at;
    const shown = steps.slice(0, 2);
    const more = steps.length - shown.length;
    return (
      <span className="min-w-0">
        <span className="text-dim" title={new Date(newest).toISOString()}>{agoText(now, newest)}</span>
        {shown.length > 0 && (
          <span className="block text-[11px] text-text/80 leading-4" title={steps.map(s => s.label).join(' · ')}>
            {shown.map(s => s.label).join(' · ')}{more > 0 && ` · +${more} more`}
          </span>
        )}
      </span>
    );
  };

  const cells = (c: T) => (
    <>
      {zones.map(z => <span key={z.key} className="text-center">{renderGate(z, c)}</span>)}
      <span className="text-right text-dim text-xs">{renderFlags(c)}</span>
      <span className="text-xs">{changeCell(c)}</span>
    </>
  );
  const barOf = (c: T) => BAR[levelOf(now, changes.get(c.name.toLowerCase())?.[0]?.at) ?? 'none'];

  const nameLink = (c: T, tag?: ReactNode) => (
    <span className="min-w-0">
      <Link href={charHref(c.name)} className="text-text hover:underline">{c.name}</Link>
      {tag}
    </span>
  );

  const altRow = (c: T) => (
    <div key={c.name} className={`grid items-center gap-x-1 border-l-4 pl-6 pr-2 py-1.5 text-sm ${barOf(c)}`} style={grid}>
      <span className="min-w-0">
        {nameLink(c, <span className="ml-1 text-[10px] text-dim">alt</span>)}
        <Chip level={levelOf(now, changes.get(c.name.toLowerCase())?.[0]?.at)} />
      </span>
      {cells(c)}
    </div>
  );

  return (
    <div className="overflow-x-auto">
      <div style={{ minWidth }}>
        <div className="grid items-end gap-x-1 border-l-4 border-transparent pl-2 pr-2 py-1 text-dim text-xs" style={grid}>
          <span>Character</span>
          {zones.map(z => <span key={z.key} className="text-center" title={z.name}>{z.short}</span>)}
          <span className="text-right">Flags</span>
          <span title="When the newest flag change was, and which steps changed in the last 3 days">Latest change</span>
        </div>
        <div className="divide-y divide-border/50">
          {families.map(f => {
            const own = levelOf(now, f.headAt);
            const fam = familyLevel(f, now);
            if (f.alts.length === 0) {
              const orphan = altOf(f.head);
              return (
                <div key={f.head.name} className={`grid items-center gap-x-1 border-l-4 pl-2 pr-2 py-1.5 text-sm ${BAR[own ?? 'none']}`} style={grid}>
                  <span className="min-w-0">
                    {nameLink(f.head, orphan ? <span className="ml-1 text-[10px] text-dim" title="Its main is not on this list">alt of {orphan}</span> : undefined)}
                    <Chip level={own} />
                  </span>
                  {cells(f.head)}
                </div>
              );
            }
            return (
              <details key={f.head.name} open={openAll} className="group">
                <summary className={`grid items-center gap-x-1 border-l-4 pl-2 pr-2 py-1.5 text-sm cursor-pointer list-none [&::-webkit-details-marker]:hidden hover:bg-white/5 ${BAR[own ?? 'none']}`} style={grid}>
                  <span className="min-w-0">
                    <span className="inline-block w-4 text-dim transition-transform group-open:rotate-90" aria-hidden="true">▸</span>
                    {nameLink(f.head)}
                    <span className="ml-1 text-[10px] text-gold" title="main">★</span>
                    <span className="block pl-4 text-[11px] text-dim leading-4">
                      {familySummary(f, now)}{' '}
                      <Chip level={fam} title={`${CHIP_TITLE[fam ?? 'recent']} — anywhere in this family`} />
                    </span>
                  </span>
                  {cells(f.head)}
                </summary>
                <div className="bg-bg/30">{f.alts.map(altRow)}</div>
              </details>
            );
          })}
        </div>
      </div>
    </div>
  );
}
