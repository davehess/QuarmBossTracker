'use client';

// The bar across the top of b.wolfpack.quest.
//
// The whole point of the `b.` mirror is that you can put a `b.` in front of
// ANY page and see that page as it stands on the beta branch. So the banner
// has to do two things: say unmistakably that this is not production, and get
// you back to the same page on production in one click — hence usePathname
// rather than a bare link to the root.
//
// Rendered only when NEXT_PUBLIC_IS_BETA is set, which next.config.js derives
// from the branch being built (see the note there).
//
// It is dismissible (Hitya, 2026-08-28), because the person who reads it most
// is the one reviewing beta all evening and it costs ~100px of a phone's first
// viewport on every page. Dismissing collapses it to a thin strip in the same
// amber rather than removing it: "you are not on production" has to survive
// being dismissed, or someone files a bug against the wrong site.

import { usePathname } from 'next/navigation';
import { useEffect, useLayoutEffect, useState } from 'react';

const KEY = 'wp_beta_collapsed';

// ⚠ Layout effect, not effect: it runs before paint, so a stored dismissal
// applies without the full bar flashing at its full height first on every
// single navigation. React warns if useLayoutEffect is called during SSR, so
// pick the effect by environment rather than suppressing the warning.
const useIsoLayout = typeof window === 'undefined' ? useEffect : useLayoutEffect;

export default function BetaBanner() {
  const pathname = usePathname() || '/';
  // Same path, production host. Query/hash are deliberately dropped — this is
  // a "show me the real one" escape hatch, not a state-preserving mirror.
  const prodHref = `https://wolfpack.quest${pathname}`;

  // Server and first client render agree on `false`; the stored value is
  // applied before paint below.
  const [collapsed, setCollapsed] = useState(false);
  useIsoLayout(() => {
    try { if (localStorage.getItem(KEY) === '1') setCollapsed(true); } catch { /* private mode */ }
  }, []);

  const store = (v: boolean) => {
    setCollapsed(v);
    try { localStorage.setItem(KEY, v ? '1' : '0'); } catch { /* private mode */ }
  };

  if (collapsed) {
    return (
      <button
        type="button"
        onClick={() => store(false)}
        aria-expanded={false}
        aria-label="Show the beta notice"
        className="flex w-full items-center justify-center gap-1.5
                   border-b border-amber-500/45 bg-amber-500/20 py-0.5
                   font-mono text-[10px] tracking-wider text-amber-300
                   transition-colors hover:bg-amber-500/30"
      >
        <span className="font-bold">BETA</span>
        <svg viewBox="0 0 10 6" width="9" height="6" aria-hidden="true" className="text-amber-400">
          <path d="M1 1.2 5 4.8 9 1.2" fill="none" stroke="currentColor" strokeWidth="1.6"
                strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>
    );
  }

  return (
    <div
      role="status"
      className="bg-amber-500 text-black text-xs sm:text-sm font-mono"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 flex items-center gap-x-2 sm:gap-x-3 gap-y-1 flex-wrap">
        <span className="font-bold tracking-wider">BETA</span>
        {/* The same warning at two lengths. At 360px the full sentence alone ran
            three lines and the bar cost 104px of the first viewport. */}
        <span className="opacity-80 hidden sm:inline">
          You are on <b>b.wolfpack.quest</b> — the beta branch. Changes here may be unfinished.
        </span>
        <span className="opacity-80 sm:hidden">
          <b>b.wolfpack.quest</b> — may be unfinished.
        </span>
        {/* "What is actually different?" answered as a CODE diff rather than a
            side-by-side of the two sites. A visual diff would be swamped by
            noise here: 69 of 75 pages read live data, and both hosts hit the
            same database, so timers, DKP and who-is-online move between the two
            requests. The repo is public, so GitHub renders the real answer. */}
        <a
          href="https://github.com/davehess/QuarmBossTracker/compare/main...beta"
          target="_blank"
          rel="noreferrer"
          className="underline whitespace-nowrap hover:opacity-70"
          title="Every code change on beta that is not yet on production. Empty means the two are identical."
        >
          what&apos;s different?
        </a>
        <a
          href={prodHref}
          className="ml-auto underline whitespace-nowrap font-semibold hover:opacity-70"
        >
          View <span className="hidden sm:inline">this page on wolfpack.quest</span><span className="sm:hidden">on production</span> →
        </a>
        <button
          type="button"
          onClick={() => store(true)}
          aria-expanded
          aria-label="Collapse the beta notice"
          title="Collapse to a thin strip"
          className="shrink-0 rounded px-1 leading-none text-base font-bold
                     transition-colors hover:bg-black/15"
        >
          ×
        </button>
      </div>
    </div>
  );
}
