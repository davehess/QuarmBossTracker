// /spectator: a flat top-down map of the zone with the raid's live positions on top (DECISIONS §160,
// option C picked by the guild lead 2026-10-04). New page, so it goes live with the [beta] tag.
//
// Members only, like /raid: the page itself reads nothing; the board polls /api/spectator/positions
// (member-gated, nothing stored) and /api/spectator/map (the map layers for one zone).
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import NewPageTag from '@/components/NewPageTag';
import SpectatorBoard from './SpectatorBoard';
import RaidTimeline from '@/components/RaidTimeline';
import { isOfficer } from '@/lib/officer';

export const metadata: Metadata = {
  title: '[beta] Spectator',
  description: 'A live top-down map of the raid: where everyone is standing, in the zone they are in.',
};

export const dynamic = 'force-dynamic';

export default async function SpectatorPage({ searchParams }: { searchParams: { v?: string | string[] } }) {
  // ?v=newraid is the beta preview of "a new raid starts the timeline over" (lib/liveRaidWindow.ts). Without it the
  // page is as it was.
  const newRaid = (Array.isArray(searchParams.v) ? searchParams.v[0] : searchParams.v) === 'newraid';
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=' + encodeURIComponent('/spectator' + (newRaid ? '?v=newraid' : '')));
  const officer = newRaid && await isOfficer(user.id);

  return (
    <div className="mx-auto max-w-6xl py-2">
      <NewPageTag note="New page: the raid on a map, live." />
      <h1 className="text-2xl text-gold">Spectator</h1>
      <p className="mt-1 mb-4 text-sm text-dim">
        Everyone in the raid, where they are standing right now. Fed by Zeal through the raiders running Mimic;
        positions older than 30 seconds drop off.{' '}
        <a href="/spectator/replay" className="underline hover:text-text">Replay a recorded night</a>.
      </p>
      {newRaid ? <RaidTimeline src="/api/spectator/timeline?v=newraid" canCut={officer} /> : <RaidTimeline />}
      <SpectatorBoard />
      <p className="mt-6 text-xs text-dim">
        Map lines: Brewall&apos;s EverQuest maps (via Zeal). Generated walls: EQEmu maps (GPLv2+, © EQEmulator.NET, AX-Classic and ProjectEQ).
        While you are in a raid, your latest position in the zone is shown to signed-in members here.{' '}
        <a href="/privacy" className="underline hover:text-text">Privacy</a>.
      </p>
    </div>
  );
}
