'use client';
// The stacked attempt timelines, the first and largest thing on the gold-splits page (DECISIONS §555). One tall row per
// attempt on a shared time scale. Clicking a key event slides every row (a CSS transform) so that event lines up, and
// shows each attempt's time to the NEXT event with the fastest in gold. The "play together" link hands the checked
// attempts' windows to the replay.
import { useMemo, useState } from 'react';

export type TLMoment = { key: string; label: string };
export type TLAttempt = {
  key: string;
  when: string;
  success: boolean;
  wiped: boolean;
  /** Seconds from the attempt's first moment, aligned to the moments; null = not seen. */
  rel: (number | null)[];
  /** The mob that took each slot, for the tooltip. */
  names: (string | null)[];
  fromIso: string;
  toIso: string;
};

const clock = (s: number | null) => {
  if (s == null) return '—';
  const r = Math.round(s);
  return `${Math.floor(r / 60)}:${String(r % 60).padStart(2, '0')}`;
};

export default function SplitsTimeline({ moments, attempts, replayBase }: { moments: TLMoment[]; attempts: TLAttempt[]; replayBase: string }) {
  const [align, setAlign] = useState<number | null>(null);
  const [picked, setPicked] = useState<Set<string>>(() => new Set(attempts.map(a => a.key)));

  const geo = useMemo(() => {
    const k = align;
    const has = (a: TLAttempt) => k != null && a.rel[k] != null;
    const ref = k == null ? 0 : Math.max(0, ...attempts.filter(has).map(a => a.rel[k] as number));
    const rows = attempts.map(a => {
      const dur = Math.max(0, ...a.rel.filter((x): x is number => x != null));
      const shift = k != null && has(a) ? ref - (a.rel[k] as number) : 0;
      return { shift, dur };
    });
    const span = Math.max(1, ...rows.map(r => r.shift + r.dur));
    const next = attempts.map(a => (k != null && has(a) && a.rel[k + 1] != null ? (a.rel[k + 1] as number) - (a.rel[k] as number) : null));
    const fastest = Math.min(...next.filter((x): x is number => x != null));
    return { rows, span, next, fastest: Number.isFinite(fastest) ? fastest : null };
  }, [align, attempts]);

  const chosen = attempts.filter(a => picked.has(a.key));
  const overlay = chosen.map(a => `${a.fromIso}~${a.toIso}`).join(',');
  const alignKey = align != null ? moments[align]?.key : undefined;
  const playHref = `${replayBase}?overlay=${encodeURIComponent(overlay)}${alignKey ? `&align=${encodeURIComponent(alignKey)}` : ''}`;

  return (
    <section aria-label="Attempt timelines" className="rounded-lg border border-border bg-panel p-3 sm:p-4">
      <div className="flex flex-wrap items-center gap-2">
        <h2 className="text-sm font-semibold uppercase tracking-wider text-dim">Line the attempts up on</h2>
        <button type="button" onClick={() => setAlign(null)} aria-pressed={align == null}
          className={`rounded border px-3 py-1.5 text-sm ${align == null ? 'border-gold bg-gold/10 text-gold' : 'border-border text-dim hover:text-text'}`}>
          Start of each run
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-2">
        {moments.map((m, i) => (
          <button key={m.key} type="button" onClick={() => setAlign(align === i ? null : i)} aria-pressed={align === i}
            className={`rounded border px-3 py-1.5 text-sm ${align === i ? 'border-gold bg-gold/10 text-gold' : 'border-border text-text hover:border-gold/60'}`}>
            {m.label}
          </button>
        ))}
        <button type="button" onClick={() => setAlign(null)} disabled={align == null}
          className="ml-auto rounded border border-border px-3 py-1.5 text-sm text-dim hover:text-text disabled:opacity-40">Reset</button>
      </div>
      <p className="mt-2 text-xs text-dim">
        {align == null
          ? 'Each run is drawn from its own first moment on one shared time scale. Pick an event to slide every run so that event lines up.'
          : `Every run is slid so that "${moments[align]?.label}" lines up. The number on the right is how long each run took to reach the next event; the fastest is gold.`}
      </p>

      <ol className="mt-4 space-y-4">
        {attempts.map((a, ri) => {
          const g = geo.rows[ri];
          const dim = align != null && a.rel[align] == null;
          const isFast = geo.next[ri] != null && geo.next[ri] === geo.fastest && attempts.length > 1;
          const pts = a.rel.map((t, i) => ({ t, i })).filter((p): p is { t: number; i: number } => p.t != null);
          return (
            <li key={a.key} className={dim ? 'opacity-50' : ''}>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={picked.has(a.key)} onChange={() => setPicked(s => { const n = new Set(s); if (n.has(a.key)) n.delete(a.key); else n.add(a.key); return n; })} />
                  <span className="text-text">{a.when}</span>
                </label>
                <span className={`rounded border px-1.5 py-0.5 text-[11px] ${a.success ? 'border-green/60 text-green' : 'border-red/60 text-red'}`}>
                  {a.success ? 'finished' : a.wiped ? 'wiped' : 'did not finish'}
                </span>
                {align != null && (
                  <span className={`ml-auto rounded border px-2 py-0.5 tabular-nums ${isFast ? 'border-gold bg-gold/10 text-gold' : 'border-border text-dim'}`}
                    title="Time from the lined-up event to the next one">
                    {align + 1 < moments.length ? `to ${moments[align + 1].label}: ` : ''}{clock(geo.next[ri])}
                  </span>
                )}
              </div>
              <div className="relative mt-1 h-14 overflow-hidden rounded border border-border bg-bg sm:h-16">
                <div className="absolute inset-0 transition-transform duration-500 ease-out motion-reduce:transition-none"
                  style={{ transform: `translateX(${(g.shift / geo.span) * 100}%)` }}>
                  {pts.length > 1 && (
                    <div className="absolute top-1/2 h-0.5 -translate-y-1/2 bg-border"
                      style={{ left: `${(pts[0].t / geo.span) * 100}%`, width: `${((pts[pts.length - 1].t - pts[0].t) / geo.span) * 100}%` }} />
                  )}
                  {pts.slice(1).map((p, j) => {
                    const prev = pts[j];
                    if (p.i !== prev.i + 1) return null;
                    return (
                      <div key={p.i} className={`absolute top-1/2 flex h-6 -translate-y-1/2 items-center justify-center overflow-hidden text-[11px] tabular-nums sm:h-7 ${j % 2 ? 'bg-blue/25' : 'bg-blue/40'}`}
                        style={{ left: `${(prev.t / geo.span) * 100}%`, width: `${((p.t - prev.t) / geo.span) * 100}%` }}
                        title={`${moments[prev.i].label} to ${moments[p.i].label}: ${clock(p.t - prev.t)}`}>
                        <span className="px-0.5 text-text">{clock(p.t - prev.t)}</span>
                      </div>
                    );
                  })}
                  {pts.map(p => (
                    <button key={p.i} type="button" onClick={() => setAlign(align === p.i ? null : p.i)}
                      aria-label={`${moments[p.i].label} at ${clock(p.t)}. Line the runs up on it.`}
                      title={`${a.names[p.i] ?? moments[p.i].label} at ${clock(p.t)}`}
                      className={`absolute top-1/2 h-5 w-5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 ${align === p.i ? 'border-gold bg-gold' : 'border-text bg-panel hover:border-gold'}`}
                      style={{ left: `${(p.t / geo.span) * 100}%` }} />
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ol>

      <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-border pt-3 text-sm">
        {chosen.length > 0 ? (
          <a href={playHref} className="rounded border border-gold bg-gold/10 px-3 py-1.5 text-gold hover:bg-gold/20">Play these attempts together</a>
        ) : (
          <span className="rounded border border-border px-3 py-1.5 text-dim">Tick an attempt to play it</span>
        )}
        <span className="rounded border border-orange/50 bg-orange/10 px-2 py-0.5 text-[11px] text-orange">overlay playback: coming</span>
        <span className="text-xs text-dim">
          Opens the replay with each ticked attempt&apos;s window{alignKey ? ' and the lined-up event' : ''}. The replay shows one window until overlaying lands.
        </span>
      </div>
    </section>
  );
}
