'use client';
// The night's log: every named fight of the window, kills AND wipes AND another guild's, in time
// order, with the moments of mass death between them (many deaths close together, to anyone), and for each fight a
// "Timeline" that opens the parse page's own damage curve and deaths in place (components/DamageCurve.tsx, read from
// /api/raid/session/fight-timeline when the row is opened).
import { useEffect, useMemo, useState } from 'react';
import { DamageCurve } from '@/components/DamageCurve';
import { nightLog, type NightCtx } from '@/lib/nightSlices';
import type { FightTimeline } from '@/lib/raidFightTimeline';
import { classColor } from '@/lib/spectator';
import { etMin, fmtDur, plural, chip, chipIdle } from './nightStyle';

const mmss = (s: number) => `${s < 0 ? '-' : ''}${Math.floor(Math.abs(s) / 60)}:${String(Math.abs(s) % 60).padStart(2, '0')}`;

function TimelineBody({ id, fromMs, toMs }: { id: string; fromMs: number; toMs: number }) {
  const [data, setData] = useState<FightTimeline | 'error' | null>(null);
  useEffect(() => {
    let live = true;
    const q = `encounter=${encodeURIComponent(id)}&from=${encodeURIComponent(new Date(fromMs).toISOString())}&to=${encodeURIComponent(new Date(toMs).toISOString())}`;
    fetch(`/api/raid/session/fight-timeline?${q}`)
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then(j => { if (live) setData(j.timeline as FightTimeline); })
      .catch(() => { if (live) setData('error'); });
    return () => { live = false; };
  }, [id, fromMs, toMs]);

  if (data === null) return <p className="border-t border-border/50 px-3 py-3 text-xs text-dim">Loading the timeline…</p>;
  if (data === 'error') return <p className="border-t border-border/50 px-3 py-3 text-xs text-dim">That timeline could not be loaded.</p>;
  const c = data.curve;
  return (
    <div className="space-y-3 border-t border-border/50 px-3 py-3">
      {c && c.bands.length > 0
        ? <DamageCurve buckets={c.buckets} bands={c.bands} series={c.series} totalDamage={c.totalDamage} mt={c.mt}
            durationSec={data.durationSec || c.buckets[c.buckets.length - 1] || 1} classOf={data.classOf} />
        : <p className="text-xs text-dim">No damage snapshots were recorded for this fight, so there is no curve.</p>}
      <div>
        <h3 className="mb-1 text-xs uppercase tracking-wider text-dim">Deaths · {data.deaths.length}</h3>
        {data.deaths.length === 0 ? <p className="text-xs text-dim">No deaths were recorded.</p> : (
          <ul className="grid gap-x-4 text-xs sm:grid-cols-2">
            {data.deaths.map((d, i) => (
              <li key={i} className="flex justify-between gap-2 border-t border-border/40 py-0.5">
                <span><span aria-hidden="true" className="mr-1.5 inline-block h-2 w-2 rounded-full" style={{ background: classColor(d.cls) }} />{d.name}</span>
                <span className="tabular-nums text-dim">{mmss(d.atSec)}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FightRow({ item, fromMs, toMs, go }: {
  item: Extract<ReturnType<typeof nightLog>[number], { kind: 'fight' }>; fromMs: number; toMs: number; go: (ms: number | null) => void;
}) {
  const f = item.fight;
  const [opened, setOpened] = useState(false);
  const other = f.tag === 'foreign';
  return (
    <li className="rounded-md border border-border bg-panel">
      <details className="group" onToggle={e => { if (e.currentTarget.open) setOpened(true); }}>
        <summary className="flex cursor-pointer list-none flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-sm [&::-webkit-details-marker]:hidden">
          <span aria-hidden="true" className="text-dim transition-transform group-open:rotate-90">▸</span>
          <button type="button" onClick={e => { e.preventDefault(); go(f.startMs); }} title="Show this moment on the replay"
            className="whitespace-nowrap rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-xs text-blue hover:bg-[#21262d]">▶ {etMin.format(f.startMs)}</button>
          <span className={`min-w-0 flex-1 ${other ? 'text-orange' : 'text-gold'}`}>{f.name}</span>
          <span className={`rounded border px-1.5 py-0.5 text-[11px] ${f.result === 'wipe' ? 'border-red text-red' : 'border-green text-green'}`}>{f.result === 'wipe' ? 'Wipe' : 'Kill'}</span>
          {other && <span className="rounded border border-orange px-1.5 py-0.5 text-[11px] text-orange">Non-guild</span>}
          {f.tag && !other && <span className="rounded border border-border px-1.5 py-0.5 text-[11px] text-dim">{f.tag}</span>}
          {f.zone && <span className="text-xs text-dim">{f.zone}</span>}
          {f.durationSec != null && <span className="text-xs tabular-nums">{fmtDur(f.durationSec)}</span>}
          {item.deaths > 0 && <span className="text-xs tabular-nums text-red">{plural(item.deaths, 'death')}</span>}
          <a href={`/parses/${f.id}`} onClick={e => e.stopPropagation()} className="whitespace-nowrap text-xs text-blue hover:underline">Parse page ↗</a>
        </summary>
        {opened && <TimelineBody id={f.id} fromMs={fromMs} toMs={toMs} />}
      </details>
    </li>
  );
}

export default function NightFights({ ctx, fromMs, toMs, go }: { ctx: NightCtx; fromMs: number; toMs: number; go: (ms: number | null) => void }) {
  const log = useMemo(() => nightLog(ctx), [ctx]);
  const [massOnly, setMassOnly] = useState(false);
  const shown = massOnly ? log.filter(i => i.kind === 'mass') : log;
  const wipes = ctx.fights.filter(f => f.result === 'wipe').length;
  if (!log.length) return <p className="rounded-md border border-border bg-panel p-4 text-sm text-dim">No named fight and no mass death in this window.</p>;
  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-dim">
        <span>
          {plural(ctx.fights.length, 'named fight')} ({plural(wipes, 'wipe')}), {plural(ctx.mass.length, 'moment')} of mass death
          (5 or more deaths within a minute, to anyone)
        </span>
        <button type="button" aria-pressed={massOnly} onClick={() => setMassOnly(v => !v)}
          className={`${chip} ${massOnly ? 'border-accent bg-accent text-white' : chipIdle}`}>Mass deaths only</button>
      </div>
      <ul className="space-y-1.5">
        {shown.map((item, i) => item.kind === 'fight'
          ? <FightRow key={`f${item.fight.id}`} item={item} fromMs={fromMs} toMs={toMs} go={go} />
          : (
            <li key={`m${i}`} className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md border border-red/50 bg-red/10 px-3 py-2 text-sm">
              <button type="button" onClick={() => go(item.mass.fromMs)} title="Show this moment on the replay"
                className="whitespace-nowrap rounded border border-border bg-panel px-1.5 py-0.5 font-mono text-xs text-blue hover:bg-[#21262d]">▶ {etMin.format(item.mass.fromMs)}</button>
              <span className="text-red">☠ {plural(item.mass.count, 'death')} within {Math.max(1, Math.round((item.mass.toMs - item.mass.fromMs) / 1000))} s</span>
              <span className="text-xs text-dim">{item.during ? `during ${item.during}` : 'outside a named fight'}</span>
            </li>
          ))}
      </ul>
    </div>
  );
}
