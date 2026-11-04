// /pop/elementals: Elemental Planes planning (the guild lead, 2026-11-04: "map out the elemental planes with travel time,
// strategy for each of the boss fights, ability to avoid fights ... Make a fresh Artifact before we put it onto our
// website", then "lets push the rest to main"). Water, Air, Earth and Fire: each plane's map with a minimal and a
// full-clear boss path, the event clocks at our damage rate, the named and the trash.
//
// New page, so it goes live with the [beta] tag (DECISIONS §135). Public, like /platform: game data and our own damage
// rate, no member data. The planner is one self-contained page (web/public/pop/elementals.html, ~580 KB with its maps),
// so it is embedded in an iframe, the /platform/architecture pattern: its script and maps stay out of the site bundle.
// Its route drags stay on the viewer's screen here; the raid's shared copy lives in the claude.ai artifact it came from.
import type { Metadata } from 'next';
import NewPageTag from '@/components/NewPageTag';

export const metadata: Metadata = {
  title: '[beta] Elemental Planes planning',
  description: 'Water, Air, Earth and Fire planned for Wolf Pack: maps with a minimal and a full-clear boss path, travel and fight times at our damage rate, the event clocks, the named and the trash.',
};

export default function ElementalsPage() {
  return (
    <main className="mx-auto max-w-7xl px-4 py-6">
      <NewPageTag note="New page: the elemental planes plan, still being shaped." />
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <h1 className="text-xl font-semibold text-text">Elemental Planes planning</h1>
        <a href="/pop/elementals.html" className="font-mono text-xs text-dim underline hover:text-text">Open full screen</a>
      </div>
      <iframe
        src="/pop/elementals.html"
        title="Elemental Planes planning"
        className="block w-full rounded-lg border border-border bg-bg"
        style={{ height: 'calc(100vh - 160px)', minHeight: 640, border: 0 }}
      />
    </main>
  );
}
