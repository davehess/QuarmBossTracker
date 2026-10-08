'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';

// A live counter that does not update is worse than no counter — it looks like
// zero traffic when it is actually a stale render. So the page refreshes itself
// and, more importantly, SAYS how long ago it last succeeded, so a reader can
// tell "we are sending nothing" from "this tab has been asleep".
export default function AutoRefresh({ seconds = 30 }: { seconds?: number }) {
  const router = useRouter();
  const [age, setAge] = useState(0);

  useEffect(() => {
    const tick = setInterval(() => setAge(a => a + 1), 1000);
    const pull = setInterval(() => {
      // Don't refresh a tab nobody is looking at — this page is meant to be
      // left open for hours, and a background tab polling all night is exactly
      // the kind of thing that started this whole incident.
      if (typeof document !== 'undefined' && document.hidden) return;
      router.refresh();
      setAge(0);
    }, Math.max(10, seconds) * 1000);
    return () => { clearInterval(tick); clearInterval(pull); };
  }, [router, seconds]);

  return (
    <span className="text-xs text-dim" suppressHydrationWarning>
      updated {age < 2 ? 'just now' : `${age}s ago`} · refreshes every {seconds}s
    </span>
  );
}
