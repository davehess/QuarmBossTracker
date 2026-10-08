// /screen: the raid screen the raid leader drives (the guild lead picked option B, 2026-10-06). One page the
// whole raid watches on a second monitor or a phone: an officer switches it between Map, Slides, Loot and
// Overview, and everyone else's page follows within a few seconds. New page, so it goes live with the [beta] tag.
//
// Members only, like /spectator and /raid: the page itself reads nothing but who is looking (isOfficer decides
// whether the leader bar shows). The board polls /api/screen/state, /api/screen/feed and /api/spectator/positions,
// each member-gated; changing anything is officer-only at the API, whatever this page shows.
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';
import ScreenBoard from './ScreenBoard';

export const metadata: Metadata = {
  title: '[beta] Raid screen',
  description: 'One page the whole raid watches: the map, slides, loot or an overview, switched by the raid leader.',
};

export const dynamic = 'force-dynamic';

export default async function ScreenPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/screen');
  const canDrive = await isOfficer(user.id);

  return (
    <div className="mx-auto max-w-7xl py-2">
      <NewPageTag note="New page: the raid screen the raid leader drives." />
      <h1 className="mb-3 text-2xl text-gold">Raid screen</h1>
      <ScreenBoard canDrive={canDrive} />
      <p className="mt-4 border-t border-border pt-3 text-xs text-dim">
        {canDrive
          ? 'You can switch this screen: everyone who has it open follows within a few seconds.'
          : 'Everyone sees what the raid leader picks. It updates every few seconds.'}
        {' '}Map: Brewall&apos;s EverQuest maps (via Zeal) and EQEmu maps. Loot follows the OpenDKP sync.{' '}
        <a href="/privacy" className="underline hover:text-text">Privacy</a>.
      </p>
    </div>
  );
}
