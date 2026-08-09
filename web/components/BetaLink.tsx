'use client';

// The production → beta half of the `b.` mirror. (Beta → production lives in
// BetaBanner, which is the loud one; this is the quiet one, since on production
// the mirror is a side door rather than something to announce.)
//
// Path-preserving in both directions: the mental model is "put a b. in front of
// the page you are on", so a link that dumped you on the beta HOME page would
// break the one thing the feature is for.
//
// Rendered only when NEXT_PUBLIC_IS_BETA is unset — see next.config.js.

import { usePathname } from 'next/navigation';

export default function BetaLink() {
  const pathname = usePathname() || '/';
  return (
    <a
      href={`https://b.wolfpack.quest${pathname}`}
      className="text-blue hover:underline"
      title="See this page as it stands on the beta branch. Usually identical — web changes ship straight to production unless one is deliberately staged on beta first."
    >
      β beta
    </a>
  );
}
