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

import { usePathname } from 'next/navigation';

export default function BetaBanner() {
  const pathname = usePathname() || '/';
  // Same path, production host. Query/hash are deliberately dropped — this is
  // a "show me the real one" escape hatch, not a state-preserving mirror.
  const prodHref = `https://wolfpack.quest${pathname}`;

  return (
    <div
      role="status"
      className="sticky top-0 z-50 bg-amber-500 text-black text-xs sm:text-sm font-mono"
    >
      <div className="max-w-7xl mx-auto px-3 sm:px-4 py-1.5 flex items-center gap-x-3 gap-y-1 flex-wrap">
        <span className="font-bold tracking-wider">BETA</span>
        <span className="opacity-80">
          You are on <b>b.wolfpack.quest</b> — the beta branch. Changes here may be unfinished.
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
          View this page on wolfpack.quest →
        </a>
      </div>
    </div>
  );
}
