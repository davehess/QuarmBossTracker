// Harness entry for the raidmimic "Spectator" capture: the REAL web/app/spectator/SpectatorBoard.tsx (the live raid map),
// handed a position feed through its `shared` prop instead of the live poll. The feed is baked into the page by the
// capture script as window.__FEED (invented raiders, one moment of the raid on Bertoxxulous).
import { createRoot } from 'react-dom/client';
import SpectatorBoard from '@web/app/spectator/SpectatorBoard';

const feed = (window as unknown as { __FEED: { data: never; rxAt: number } }).__FEED;
feed.rxAt = Date.now();
createRoot(document.getElementById('root') as HTMLElement).render(
  <div className="mx-auto max-w-6xl py-2">
    <h1 className="text-2xl text-gold">Spectator</h1>
    <p className="mt-1 mb-4 text-sm text-dim">Everyone in the raid, where they are standing right now.</p>
    <SpectatorBoard shared={{ feed, netErr: false, signedOut: false }} />
  </div>,
);
