'use client';
// raidmimic.com/setup, one step at a time (the guild lead, 2026-10-28: "setup needs the step-by-step by default").
//
// The page (page.tsx) stays a server component and hands this the already-rendered step cards. The state lives in
// web/lib/raidmimicSetupSteps.ts: the URL hash says which step, localStorage remembers "Show all steps".
//
// No JavaScript, a crawler, or a reader that strips scripts: the server HTML contains EVERY step, the later ones
// only carry the `hidden` attribute, and the <noscript> rule below un-hides them. Nothing here is the only copy of a
// sentence, the words stay in web/lib/raidmimicSetup.ts.
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import {
  clampStep, hashForStep, isStepHash, readShowAll, stepFromHash, stepKeyDelta, stepLabel, writeShowAll,
} from '@/lib/raidmimicSetupSteps';

export interface StepSlot { id: string; title: string; node: ReactNode }

const NAV_BTN = 'inline-flex min-h-12 flex-1 items-center justify-center rounded-md border px-4 text-sm font-semibold no-underline transition-colors motion-reduce:transition-none hover:no-underline sm:flex-none sm:min-w-32';

export default function SetupSteps({ steps }: { steps: StepSlot[] }) {
  const ids = steps.map(s => s.id);
  const total = steps.length;
  const [idx, setIdx] = useState(0);
  const [all, setAll] = useState(false);
  const top = useRef<HTMLDivElement>(null);

  // On arrival: which step the hash names, and whether this browser asked for the full page.
  useEffect(() => {
    const fromHash = () => setIdx(stepFromHash(window.location.hash, ids));
    let stored = false;
    try { stored = readShowAll(window.localStorage); } catch { /* storage blocked */ }
    setAll(stored);
    fromHash();
    // A link to #first-run reached a hidden step, so the browser had nothing to scroll to: bring the guide into view.
    if (isStepHash(window.location.hash, ids)) requestAnimationFrame(() => top.current?.scrollIntoView({ block: 'start' }));
    window.addEventListener('hashchange', fromHash);
    window.addEventListener('popstate', fromHash);
    return () => { window.removeEventListener('hashchange', fromHash); window.removeEventListener('popstate', fromHash); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const go = useCallback((to: number) => {
    const next = clampStep(to, total);
    if (typeof window !== 'undefined') {
      const h = hashForStep(next, ids);
      if (window.location.hash !== h) window.history.pushState(null, '', h);
    }
    setIdx(next);
    top.current?.scrollIntoView({ block: 'start' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [total]);

  useEffect(() => {
    if (all) return;
    const onKey = (e: KeyboardEvent) => {
      const d = stepKeyDelta(e);
      if (d) go(idx + d);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [all, idx, go]);

  const flip = () => {
    const on = !all;
    setAll(on);
    try { writeShowAll(window.localStorage, on); } catch { /* storage blocked */ }
  };

  const here = steps[idx];
  return (
    <div ref={top} className="scroll-mt-4">
      {/* No JavaScript: show every step and drop the controls that need it. */}
      <noscript><style>{'[data-wp-step]{display:list-item!important}.wp-js-only{display:none!important}'}</style></noscript>

      <div className="wp-js-only mb-3 flex items-center justify-between gap-3">
        <p aria-live="polite" className="min-w-0 text-xs uppercase tracking-widest text-gold">
          {all ? `All ${total} steps` : <>{stepLabel(idx, total)}<span className="hidden sm:inline"> · {here.title}</span></>}
        </p>
        <button
          type="button" role="switch" aria-checked={all} onClick={flip}
          className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border px-3 text-xs text-text hover:border-gold/70"
        >
          <span aria-hidden className={`inline-block h-2 w-2 rounded-full ${all ? 'bg-gold' : 'border border-dim'}`} />
          Show all steps
        </button>
      </div>

      <nav aria-label="Steps" className="mb-3">
        <ol className="m-0 flex list-none flex-wrap gap-2 p-0">
          {steps.map((s, i) => {
            const current = !all && i === idx;
            return (
              <li key={s.id}>
                <a
                  href={`#${s.id}`}
                  aria-current={current ? 'step' : undefined}
                  onClick={all ? undefined : (e) => { e.preventDefault(); go(i); }}
                  className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-md border px-3 text-xs no-underline hover:border-gold/70 hover:no-underline ${all ? '' : 'min-w-11 sm:min-w-0'} ${current ? 'border-gold bg-gold/10 text-[#f2ede1]' : 'border-border text-text'}`}
                >
                  <span aria-hidden className="text-gold">{i + 1}</span>
                  <span className={all ? '' : 'sr-only sm:not-sr-only'}>{s.title}</span>
                </a>
              </li>
            );
          })}
        </ol>
      </nav>

      {!all && (
        <div aria-hidden className="wp-js-only mb-4 h-0.5 w-full overflow-hidden rounded-full bg-border">
          <div className="h-full bg-gold transition-[width] motion-reduce:transition-none" style={{ width: `${((idx + 1) / total) * 100}%` }} />
        </div>
      )}

      <ol className="m-0 list-none space-y-4 p-0">
        {steps.map((s, i) => (
          <li key={s.id} id={s.id} data-wp-step hidden={!all && i !== idx} className="scroll-mt-4">{s.node}</li>
        ))}
      </ol>

      {!all && (
        <div className="wp-js-only mt-4 flex gap-3">
          {idx > 0 ? (
            <a href={hashForStep(idx - 1, ids)} onClick={(e) => { e.preventDefault(); go(idx - 1); }} className={`${NAV_BTN} border-border text-text hover:border-gold/70`}>← Back</a>
          ) : (
            <span aria-hidden className={`${NAV_BTN} cursor-default border-border/50 text-dim`}>← Back</span>
          )}
          {idx < total - 1 ? (
            <a href={hashForStep(idx + 1, ids)} onClick={(e) => { e.preventDefault(); go(idx + 1); }} className={`${NAV_BTN} border-gold bg-gold text-[#1a1206] hover:bg-[#e0a92c] sm:ml-auto`}>Next →</a>
          ) : (
            <a href="#troubleshooting" className={`${NAV_BTN} border-gold bg-gold text-[#1a1206] hover:bg-[#e0a92c] sm:ml-auto`}>If something does not work ↓</a>
          )}
        </div>
      )}
      {!all && <p className="wp-js-only mt-2 hidden text-xs text-dim sm:block">Tip: the left and right arrow keys step through.</p>}
    </div>
  );
}
