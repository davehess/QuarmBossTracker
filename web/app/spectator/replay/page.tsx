// /spectator/replay: a recorded raid night played back on the spectator map (option A, the scrubber).
// New page, so it goes live with the [beta] tag.
//
// Members only, like /spectator: the page itself reads nothing; the board fetches /api/spectator/replay
// (member-gated, 15-minute windows) and /api/spectator/map (the map layers for one zone).
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';
import ReplayBoard from './ReplayBoard';

export const metadata: Metadata = {
  title: '[beta] Spectator replay',
  description: 'Play a recorded raid night back on the zone map: where everyone stood, minute by minute.',
};

export const dynamic = 'force-dynamic';

export default async function SpectatorReplayPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/spectator/replay');

  return (
    <div className="mx-auto max-w-6xl py-2">
      <NewPageTag note="New page: a raid night, replayed on the map." />
      <h1 className="text-2xl text-gold">Spectator replay</h1>
      <p className="mt-1 mb-4 text-sm text-dim">
        Pick a recorded night and drag the time slider, or press play. A night opens on the guild raid; other groups
        recorded that day are in the Session list. The map follows the zone with the most raiders;
        pick a zone to stay in it. <a href="/spectator" className="underline hover:text-text">Back to the live map</a>.
      </p>
      <ReplayBoard timeline />
      <p className="mt-6 text-xs text-dim">
        Positions are the ones Zeal reported through the raiders running Mimic, kept every few seconds while a raid is on.
        Map lines: Brewall&apos;s EverQuest maps (via Zeal). Generated walls: EQEmu maps (GPLv2+, © EQEmulator.NET, AX-Classic and ProjectEQ).{' '}
        <a href="/privacy" className="underline hover:text-text">Privacy</a>.
      </p>
    </div>
  );
}
