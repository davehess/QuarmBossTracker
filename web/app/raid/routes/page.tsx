// /raid/routes: replay all our recorded nights in a zone on top of each other and average the path between the named
// mobs, so we can map out our route (the guild lead, 2026-10-21: "replay all of our raids synced up ... by path
// between mobs overlayed in one shot, average paths. We want to map out our route"). New page, so it goes live
// with the [beta] tag.
//
// Members only: the page reads nothing itself; the board fetches /api/raid/routes (member-gated) and
// /api/spectator/map (the walls). The officer test only decides whether the save button is drawn; the save itself
// (actions.ts) checks again.
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';
import RoutesBoard from './RoutesBoard';

export const metadata: Metadata = {
  title: '[beta] Raid routes',
  description: 'Every recorded raid night in a zone laid over each other: the averaged route between the named mobs, the time of each leg and which spawns we clear.',
};

export const dynamic = 'force-dynamic';

export default async function RaidRoutesPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/raid/routes');
  const officer = await isOfficer(user.id);

  return (
    <div className="mx-auto max-w-7xl py-2">
      <NewPageTag note="New page: our recorded raids, averaged into a route." />
      <h1 className="text-2xl text-gold">Raid routes</h1>
      <p className="mt-1 mb-4 max-w-3xl text-sm text-dim">
        Pick a zone and the nights to include. Each night&apos;s raid centre is traced from the first mob we pulled to every named kill; the
        gold line is the average of the nights, the numbers are the named stops, and the table gives the time of each leg and what we cleared in it.
      </p>
      <RoutesBoard officer={officer} />
      <p className="mt-6 text-xs text-dim">
        Positions are the ones Zeal reported through the raiders running Mimic. Spawn points are the server&apos;s spawn table; a mob with several is placed at
        the one nearest the raid when it died. <a href="/spectator/replay" className="underline hover:text-text">Replay a single night</a>.{' '}
        <a href="/privacy" className="underline hover:text-text">Privacy</a>.
      </p>
    </div>
  );
}
