'use client';

// The reactive half of /ai — a chronological spine you can scrub.
//
// DESIGN NOTES (see .claude/skills/frontend-design):
//
// Colour is semantic, and here it carries the whole thesis of the page in
// three values: ORANGE is what went wrong, GREEN is the rule that came out of
// it, BLUE is the commit that implemented it. Every rule on this page was born
// from an incident, so the palette says that before any prose does. GOLD marks
// only the slider's current position — one highlight, spent once.
//
// The rail is the signature element and it encodes real information rather
// than decorating: its lit length IS the ruleset in force at the selected
// date. Scrubbing back does not filter a list, it un-adopts rules.
//
// Motion: the platform's overlays treat animation as a cost because they are
// read mid-fight. This is a page read deliberately, and Hitya asked for smooth
// transitions, so they earn their place here — but every principle card stays
// MOUNTED and toggles a class instead of unmounting, because that is what
// makes the transition continuous rather than a flash of re-layout. All of it
// is disabled under prefers-reduced-motion.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Milestone, Principle } from '@/lib/aiMethodology';
import { commitUrl, fileUrl } from '@/lib/aiMethodology';

type Props = { milestones: Milestone[]; principles: Principle[] };

const fmtDate = (iso: string) =>
  new Date(iso + 'T12:00:00Z').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC',
  });

export default function AiMethodology({ milestones, principles }: Props) {
  const last = milestones.length - 1;
  const [idx, setIdx] = useState(last);
  const [live, setLive] = useState('');
  const railRef = useRef<HTMLDivElement>(null);

  const current = milestones[idx];
  const atNow = idx === last;

  // Adopted at or before the selected milestone's date. Sorted newest-first so
  // the most recent rule — the one the selected milestone just introduced —
  // reads first instead of being buried under a year of older ones.
  const inForce = useMemo(() => {
    const s = new Set(
      principles.filter(p => p.adopted <= current.date).map(p => p.id),
    );
    return s;
  }, [principles, current.date]);

  const ordered = useMemo(
    () => [...principles].sort((a, b) => b.adopted.localeCompare(a.adopted) || a.id.localeCompare(b.id)),
    [principles],
  );

  // Announce for screen readers — a slider that silently rewrites the page
  // below it is unusable without this.
  useEffect(() => {
    setLive(`${fmtDate(current.date)}. ${current.title}. ${inForce.size} of ${principles.length} rules in force.`);
  }, [current, inForce.size, principles.length]);

  const onKey = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Home') { setIdx(0); e.preventDefault(); }
    if (e.key === 'End')  { setIdx(last); e.preventDefault(); }
  }, [last]);

  const pct = last === 0 ? 100 : (idx / last) * 100;

  return (
    <div className="space-y-6">
      {/* ── Scrubber ─────────────────────────────────────────────────────── */}
      <section
        className="bg-panel border border-border rounded-lg p-4 md:p-5 sticky top-2 z-20
                   shadow-[0_8px_24px_-12px_rgba(0,0,0,0.9)] backdrop-blur"
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
          <div className="min-w-0">
            <div className="text-[11px] uppercase tracking-wider text-dim">
              {atNow ? 'Current ruleset' : 'Ruleset as it stood'}
            </div>
            <h2 className="text-lg md:text-xl text-gold truncate">{current.title}</h2>
          </div>
          <div className="text-right shrink-0">
            <div className="text-sm text-text tabular-nums">{fmtDate(current.date)}</div>
            <div className="text-[11px] text-dim tabular-nums">
              <span className="text-green">{inForce.size}</span>/{principles.length} rules in force
            </div>
          </div>
        </div>

        <label htmlFor="ai-scrub" className="sr-only">
          Scrub through methodology milestones
        </label>
        <input
          id="ai-scrub"
          type="range"
          min={0}
          max={last}
          step={1}
          value={idx}
          onChange={e => setIdx(Number(e.target.value))}
          onKeyDown={onKey}
          aria-valuetext={`${fmtDate(current.date)} — ${current.title}`}
          className="wp-scrub mt-4 w-full"
          style={{ ['--wp-pct' as string]: `${pct}%` }}
        />

        {/* Tick marks double as buttons — the slider is the coarse control, a
            tick is the precise one. Labelled by date for keyboard users. */}
        <div className="relative mt-1 h-5">
          {milestones.map((m, i) => {
            const left = last === 0 ? 0 : (i / last) * 100;
            const on = i <= idx;
            return (
              <button
                key={m.id}
                type="button"
                onClick={() => setIdx(i)}
                aria-label={`${fmtDate(m.date)} — ${m.title}`}
                aria-current={i === idx ? 'true' : undefined}
                title={`${fmtDate(m.date)} — ${m.title}`}
                className="absolute -translate-x-1/2 top-0 h-5 w-5 flex items-start justify-center
                           focus:outline-none focus-visible:ring-2 focus-visible:ring-blue rounded"
                style={{ left: `${left}%` }}
              >
                <span
                  className={`block rounded-full wp-anim
                    ${i === idx
                      ? 'h-2.5 w-2.5 bg-gold ring-4 ring-gold/20'
                      : on ? 'h-1.5 w-1.5 bg-green/70' : 'h-1.5 w-1.5 bg-dim/50'}`}
                />
              </button>
            );
          })}
        </div>

        <div className="mt-2 flex items-center justify-between text-[11px] text-dim">
          <span>{fmtDate(milestones[0].date)}</span>
          <button
            type="button"
            onClick={() => setIdx(last)}
            className={`px-2 py-0.5 rounded border wp-anim
              ${atNow ? 'border-transparent text-dim' : 'border-blue/40 text-blue hover:bg-blue/10'}`}
            disabled={atNow}
          >
            {atNow ? 'at today' : 'jump to today →'}
          </button>
          <span>{fmtDate(milestones[last].date)}</span>
        </div>
        <p aria-live="polite" className="sr-only">{live}</p>
      </section>

      {/* ── The spine ────────────────────────────────────────────────────── */}
      <div ref={railRef} className="relative pl-7 md:pl-9">
        {/* Unlit rail — the future, dashed because it has not happened yet at
            the selected position. */}
        <div
          className="absolute left-[9px] md:left-[13px] top-2 bottom-2 w-px
                     bg-[repeating-linear-gradient(to_bottom,#30363d_0_4px,transparent_4px_9px)]"
          aria-hidden
        />
        {/* Lit rail — its height IS the elapsed method. */}
        <div
          className="absolute left-[9px] md:left-[13px] top-2 w-px
                     bg-gradient-to-b from-green/60 to-gold wp-rail"
          style={{ height: `calc((100% - 1rem) * ${last === 0 ? 1 : idx / last})` }}
          aria-hidden
        />

        <ol className="space-y-3">
          {milestones.map((m, i) => {
            const past = i < idx;
            const here = i === idx;
            const future = i > idx;
            const born = principles.filter(p => p.milestone === m.id);
            return (
              <li key={m.id} className="relative">
                <span
                  aria-hidden
                  className={`absolute -left-7 md:-left-9 top-4 h-2.5 w-2.5 rounded-full wp-anim
                    ${here ? 'bg-gold ring-4 ring-gold/20 scale-125'
                          : past ? 'bg-green/70' : 'bg-bg border border-border'}`}
                  style={{ marginLeft: here ? '2px' : '3px' }}
                />
                <article
                  className={`rounded-lg border wp-anim overflow-hidden
                    ${here ? 'border-gold/45 bg-panel'
                          : past ? 'border-border bg-panel/70' : 'border-border/50 bg-panel/30'}`}
                  style={{ opacity: future ? 0.42 : 1 }}
                >
                  <button
                    type="button"
                    onClick={() => setIdx(i)}
                    className="w-full text-left px-4 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue rounded-lg"
                  >
                    <div className="flex items-baseline gap-3">
                      <time
                        dateTime={m.date}
                        className={`text-[11px] tabular-nums shrink-0 ${here ? 'text-gold' : 'text-dim'}`}
                      >
                        {fmtDate(m.date)}
                      </time>
                      <h3 className={`text-sm md:text-base leading-6 ${here ? 'text-text' : past ? 'text-text/80' : 'text-dim'}`}>
                        {m.title}
                      </h3>
                    </div>
                  </button>

                  {/* Detail expands for the selected node only. Grid-rows is the
                      trick that lets an auto-height block transition at all. */}
                  <div
                    className="grid wp-anim"
                    style={{ gridTemplateRows: here ? '1fr' : '0fr' }}
                  >
                    <div className="overflow-hidden">
                      <div className="px-4 pb-4 space-y-3 text-sm leading-6">
                        <p className="text-orange/90">
                          <span className="text-[11px] uppercase tracking-wider text-orange/70 mr-2">
                            what forced it
                          </span>
                          {m.trigger}
                        </p>
                        <p className="text-text">
                          <span className="text-[11px] uppercase tracking-wider text-dim mr-2">
                            what changed
                          </span>
                          {m.change}
                        </p>
                        {m.outcome && (
                          <p className="text-green/85">
                            <span className="text-[11px] uppercase tracking-wider text-green/60 mr-2">
                              measured after
                            </span>
                            {m.outcome}
                          </p>
                        )}

                        {born.length > 0 && (
                          <div className="pt-1">
                            <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">
                              rules this introduced
                            </div>
                            <ul className="flex flex-wrap gap-1.5">
                              {born.map(p => (
                                <li
                                  key={p.id}
                                  className="text-[11px] px-2 py-0.5 rounded border border-green/30 text-green/90 bg-green/5"
                                >
                                  {p.title}
                                </li>
                              ))}
                            </ul>
                          </div>
                        )}

                        <div className="pt-1">
                          <div className="text-[11px] uppercase tracking-wider text-dim mb-1.5">
                            commits
                          </div>
                          <ul className="space-y-1">
                            {m.commits.map(c => (
                              <li key={c.sha} className="flex gap-2 items-baseline">
                                <a
                                  href={commitUrl(c.sha)}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className="text-blue hover:underline tabular-nums shrink-0"
                                >
                                  {c.sha.slice(0, 8)}
                                </a>
                                <span className="text-dim break-words">{c.subject}</span>
                              </li>
                            ))}
                          </ul>
                        </div>
                      </div>
                    </div>
                  </div>
                </article>
              </li>
            );
          })}
        </ol>
      </div>

      {/* ── The ruleset at this position ─────────────────────────────────── */}
      <section aria-labelledby="ai-rules">
        <h2 id="ai-rules" className="text-sm uppercase tracking-wider text-dim mb-3">
          The rules {atNow ? 'in force today' : `in force on ${fmtDate(current.date)}`}
        </h2>
        <div className="grid gap-3 md:grid-cols-2">
          {ordered.map(p => {
            const on = inForce.has(p.id);
            const isNew = p.milestone === current.id;
            return (
              <article
                key={p.id}
                data-principle={p.id}
                data-adopted={p.adopted}
                data-in-force={on}
                className={`rounded-lg border p-4 wp-anim
                  ${isNew ? 'border-gold/45 bg-panel'
                          : on ? 'border-border bg-panel' : 'border-border/40 bg-panel/25'}`}
                style={{ opacity: on ? 1 : 0.38 }}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className={`text-sm ${on ? 'text-text' : 'text-dim'}`}>{p.title}</h3>
                  <span className={`text-[11px] tabular-nums shrink-0 ${isNew ? 'text-gold' : on ? 'text-green/70' : 'text-dim'}`}>
                    {on ? (isNew ? 'adopted here' : 'in force') : `not until ${fmtDate(p.adopted)}`}
                  </span>
                </div>
                <p className={`mt-2 text-sm leading-6 ${on ? 'text-text' : 'text-dim'}`}>{p.rule}</p>
                <p className="mt-2 text-[13px] leading-6 text-orange/80">
                  <span className="text-[11px] uppercase tracking-wider text-orange/60 mr-2">because</span>
                  {p.because}
                </p>
                <a
                  href={fileUrl(p.sourceDoc)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="mt-2 inline-block text-[11px] text-blue hover:underline break-all"
                >
                  {p.sourceDoc}
                </a>
              </article>
            );
          })}
        </div>
      </section>
    </div>
  );
}
