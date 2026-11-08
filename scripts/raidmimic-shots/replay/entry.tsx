// Harness entry for the raidmimic "Raid replay" capture (scripts/raidmimic-shots/shoot-replay.mjs): the REAL
// web/app/spectator/replay/ReplayBoard.tsx mounted on a bare page, the way web/app/spectator/replay/page.tsx wraps it.
// Everything it fetches is answered by the capture script's stand-in server (fixture data, invented names only).
import { createRoot } from 'react-dom/client';
import ReplayBoard from '@web/app/spectator/replay/ReplayBoard';

createRoot(document.getElementById('root') as HTMLElement).render(
  <div className="mx-auto max-w-6xl py-2">
    <h1 className="text-2xl text-gold">Spectator replay</h1>
    <ReplayBoard timeline />
  </div>,
);
