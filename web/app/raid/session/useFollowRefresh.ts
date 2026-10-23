'use client';
// A shared raid that follows the raid redraws itself about once a minute (lib/shareFollow.ts has the rule and why).
// Every five seconds this asks "is a refresh due, and is the viewer still?", so a refresh held back by a recent touch or
// a parked playhead goes out within five seconds of the hold lifting, not a minute later. A tab in the background
// asks for nothing. `router.refresh()` re-runs the page's server component and keeps this page's client state.
import { useEffect, useRef, type MutableRefObject } from 'react';
import { useRouter } from 'next/navigation';
import { followDue, followHeld } from '@/lib/shareFollow';

export function useFollowRefresh(opts: {
  /** The share is still following the raid (the server says so on every render; false ends the loop). */
  on: boolean;
  endMs: number;
  playheadRef: MutableRefObject<number | null>;
  openedRef: MutableRefObject<number | null>;
  touchedRef: MutableRefObject<number>;
}) {
  const router = useRouter();
  const { on, endMs, playheadRef, openedRef, touchedRef } = opts;
  const endRef = useRef(endMs);
  endRef.current = endMs;
  useEffect(() => {
    if (!on) return;
    let last = Date.now();
    const id = setInterval(() => {
      const now = Date.now();
      if (!followDue(now, last, typeof document !== 'undefined' && document.hidden)) return;
      if (followHeld({ nowMs: now, lastTouchMs: touchedRef.current, playheadMs: playheadRef.current, openedMs: openedRef.current, endMs: endRef.current })) return;
      last = now;
      router.refresh();
    }, 5000);
    return () => clearInterval(id);
  }, [on, router, playheadRef, openedRef, touchedRef]);
}
