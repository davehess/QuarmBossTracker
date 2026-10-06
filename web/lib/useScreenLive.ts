'use client';
// The React side of lib/screenLive.ts: one poll loop per mounted board, paused while the tab is hidden, stopped
// on unmount. `enabled: false` leaves it idle (the board was handed its positions by a parent that polls).
// `onState` is held in a ref so a new callback each render does not restart the loop.
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  createScreenLive, type LiveAuction, type LiveStatus, type PositionsFeed,
} from '@/lib/screenLive';
import type { ScreenState } from '@/lib/raidScreen';

export type ScreenLive = LiveStatus & {
  feed: PositionsFeed | null;
  /** The bot's list of open loot auctions, or null (Vercel fallback, or the bot holds none fresh). */
  auctions: LiveAuction[] | null;
  /** Read again now. */
  kick: () => void;
};

const IDLE: LiveStatus = { transport: 'connecting', netErr: false, stateErr: false, signedOut: false };

export function useScreenLive(opts: { enabled?: boolean; wantState?: boolean; onState?: (s: ScreenState) => void } = {}): ScreenLive {
  const { enabled = true, wantState = false } = opts;
  const [feed, setFeed] = useState<PositionsFeed | null>(null);
  const [auctions, setAuctions] = useState<LiveAuction[] | null>(null);
  const [status, setStatus] = useState<LiveStatus>(IDLE);
  const onState = useRef(opts.onState);
  onState.current = opts.onState;
  const engine = useRef<ReturnType<typeof createScreenLive> | null>(null);

  useEffect(() => {
    if (!enabled) return;
    const e = createScreenLive({
      wantState,
      isHidden: () => document.hidden,
      sinks: { onPositions: setFeed, onState: s => onState.current?.(s), onAuctions: setAuctions, onStatus: setStatus },
    });
    engine.current = e;
    const onVisibility = () => e.visibilityChanged();
    document.addEventListener('visibilitychange', onVisibility);
    e.start();
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      e.stop();
      engine.current = null;
    };
  }, [enabled, wantState]);

  const kick = useCallback(() => engine.current?.kick(), []);
  return { ...status, feed, auctions, kick };
}
