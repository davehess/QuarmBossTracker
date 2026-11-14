'use client';
import { useState } from 'react';
import { type CalmRaider, type CalmView, hpTone } from '@/lib/raidRosterCalmView';
import { AlertStrip, HeaderLine, HP_TEXT, classAbbr, detailFor, hpLabel, hpSize, type RenderDetail } from './shared';

// Version A, "Alert first". Header line, a red strip only when something is wrong, then groups with four
// columns per raider: name, class, HP, and at most one chip (a curse beats a missing buff).
export default function AlertFirst({
  view, renderDetail, fullViewHref,
}: { view: CalmView; renderDetail?: RenderDetail; fullViewHref?: string }) {
  const [open, setOpen] = useState<string | null>(null);
  const toggle = (n: string) => setOpen((o) => (o === n ? null : n));
  const pick = (who: string) => {
    setOpen(who);
    try { document.getElementById('calm-' + who)?.scrollIntoView({ block: 'center' }); } catch {}
  };
  return (
    <div className="space-y-3 font-mono">
      <HeaderLine view={view} fullViewHref={fullViewHref} />
      <AlertStrip alerts={view.alerts} onPick={pick} />
      {view.groups.length === 0 ? (
        <div className="rounded-lg border border-border bg-panel p-6 text-center text-sm text-text">
          No raid roster yet. Start any Mimic in the raid and it fills in within seconds.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {view.groups.map((g) => (
            <section key={g.label} className="overflow-hidden rounded-lg border border-border bg-panel">
              <h2 className="border-b border-border px-3 py-1.5 text-sm text-gold">{g.label}</h2>
              <ul className="divide-y divide-border/50">
                {g.raiders.map((r) => <Row key={r.name} r={r} open={open === r.name} onToggle={() => toggle(r.name)} onClose={() => setOpen(null)} renderDetail={renderDetail} />)}
              </ul>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}

function Row({ r, open, onToggle, onClose, renderDetail }: { r: CalmRaider; open: boolean; onToggle: () => void; onClose: () => void; renderDetail?: RenderDetail }) {
  const tone = hpTone(r.hp);
  const bad = !!r.curse || r.dead;
  const chip = r.curse
    ? { text: r.curse, cls: 'border-red text-red' }
    : r.gaps.length > 0 ? { text: 'no ' + r.gaps[0].toLowerCase(), cls: 'border-orange text-orange' } : null;
  return (
    <li id={'calm-' + r.name} className={bad ? 'bg-red/10' : ''}>
      <button
        type="button" onClick={onToggle} aria-expanded={open}
        className="grid min-h-[40px] w-full grid-cols-[minmax(0,1fr)_2.5rem_3.25rem] items-center gap-x-2 px-3 py-1 text-left text-sm hover:bg-bg/60 sm:grid-cols-[minmax(0,1fr)_2.5rem_3.25rem_9.5rem]"
      >
        <span className={'truncate ' + (r.dead ? 'text-red' : 'text-text') + (r.me ? ' font-bold' : '')}>{r.name}</span>
        <span className="text-text">{classAbbr(r.cls)}</span>
        <b className={'text-right tabular-nums ' + hpSize(r) + ' ' + HP_TEXT[tone]}>{hpLabel(r)}</b>
        <span className="col-span-3 row-start-2 min-h-0 empty:hidden sm:col-span-1 sm:row-start-auto">
          {chip ? <span className={'inline-block rounded border px-1.5 text-xs ' + chip.cls}>{chip.text}</span> : null}
        </span>
      </button>
      {open ? detailFor(renderDetail, r, onClose) : null}
    </li>
  );
}
