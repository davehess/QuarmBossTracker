'use client';
// The video-first block of the eqmimic.quest landing page (the guild lead, 2026-10-09: "landing page should
// be a large video page to start, where people can click in and view each recorded scenario"; DECISIONS §209).
// The ONLY client component on the page: it holds which scenario is selected and keeps it in step with the
// URL fragment (#clip-<slug>), so a scenario is linkable and a link opens on it. Everything else is server
// rendered. Scenarios come from SCENARIOS in web/lib/eqmimicLanding.ts; a scenario without a `src` shows a
// "clip coming" placeholder that still names it. No autoplay, nothing external is fetched or embedded.
import { useEffect, useState } from 'react';
import {
  SCENARIOS, formatDuration, matchScenario, scenarioFromHash, scenarioHash, type Scenario,
} from '@/lib/eqmimicLanding';

function Stage({ s }: { s: Scenario }) {
  return (
    <div className="relative aspect-video w-full overflow-hidden rounded-md border border-border bg-panel">
      {s.src ? (
        <video key={s.slug} src={s.src} poster={s.poster} controls playsInline preload="none"
               className="h-full w-full bg-bg object-contain" />
      ) : (
        <div className="flex h-full w-full flex-col items-center justify-center gap-3 px-4 text-center text-dim"
             style={{ backgroundImage: 'repeating-linear-gradient(135deg, rgba(48,54,61,0.35) 0 1px, transparent 1px 12px)' }}>
          <span aria-hidden className="block h-0 w-0 border-y-[14px] border-l-[22px] border-y-transparent border-l-dim/70" />
          <span className="text-xs uppercase tracking-widest">clip coming</span>
          <span className="max-w-[40ch] text-sm text-[#f2ede1] sm:text-base">{s.title}</span>
        </div>
      )}
    </div>
  );
}

export default function ScenarioPlayer() {
  // Server and first client render agree on the first scenario; the fragment is read after mount.
  const [slug, setSlug] = useState(SCENARIOS[0]?.slug ?? '');

  useEffect(() => {
    setSlug(scenarioFromHash(window.location.hash, SCENARIOS));
    // Only a fragment that names a scenario moves the selection: a click on #setup must not reset it.
    const onHash = () => {
      const named = matchScenario(window.location.hash, SCENARIOS);
      if (named) setSlug(named);
    };
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  const pick = (next: string) => {
    setSlug(next);
    try { window.history.replaceState(null, '', scenarioHash(next)); } catch { /* the page still works without it */ }
  };

  const current = SCENARIOS.find(s => s.slug === slug) ?? SCENARIOS[0];
  if (!current) return null;
  const dur = formatDuration(current.durationSec);

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_19rem]">
      <div className="min-w-0">
        <Stage s={current} />
        <div className="mt-3" aria-live="polite">
          <h2 className="text-lg text-[#f2ede1] sm:text-xl">
            {current.title}
            {dur && <span className="ml-2 text-xs font-normal text-dim">{dur}</span>}
          </h2>
          <p className="mt-1 max-w-[70ch] text-sm leading-6 text-text">{current.caption}</p>
        </div>
      </div>

      <nav aria-label="Recorded scenarios" className="min-w-0">
        <ul className="m-0 flex list-none gap-2 overflow-x-auto p-0 pb-2 lg:flex-col lg:overflow-visible lg:pb-0">
          {SCENARIOS.map((s, i) => {
            const on = s.slug === current.slug;
            const d = formatDuration(s.durationSec);
            return (
              <li key={s.slug} className="w-60 shrink-0 lg:w-auto">
                <button type="button" onClick={() => pick(s.slug)} aria-current={on ? 'true' : undefined}
                        className={`flex min-h-14 w-full flex-col justify-center rounded-md border px-3 py-2 text-left transition-colors motion-reduce:transition-none focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold ${
                          on ? 'border-gold bg-gold/10' : 'border-border bg-panel hover:border-gold/60'}`}>
                  <span className="flex items-baseline justify-between gap-2 text-sm text-[#f2ede1]">
                    <span><span className="mr-1.5 text-xs text-dim">{i + 1}</span>{s.title}</span>
                    {d && <span className="shrink-0 text-xs text-dim">{d}</span>}
                  </span>
                  <span className="mt-0.5 line-clamp-2 text-xs leading-4 text-dim">{s.caption}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </nav>
    </div>
  );
}
