// /screen: the raid screen the raid leader drives (the guild lead picked option B, 2026-10-06). One page the
// whole raid watches on a second monitor or a phone: an officer switches it between Map, Slides, Loot and
// Overview, and everyone else's page follows within a few seconds. New page, so it goes live with the [beta] tag.
//
// Members only, like /spectator and /raid: the page itself reads who is looking (isOfficer decides whether the
// leader bar shows) and, once, the preflag summary for the Overview (see loadPreflags). The board polls /api/screen/state, /api/screen/feed and /api/spectator/positions,
// each member-gated; changing anything is officer-only at the API, whatever this page shows.
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import NewPageTag from '@/components/NewPageTag';
import { PLAN, PREFLAGS } from '@/lib/raidPlan';
import { loadHeld, loadRaiders } from '@/lib/raidPreflags';
import { planOverlays, preflagSummary, type PreflagSummary } from '@/lib/screenPlan';
import ScreenBoard from './ScreenBoard';

export const metadata: Metadata = {
  title: '[beta] Raid screen',
  description: 'One page the whole raid watches: the map, slides, loot or an overview, switched by the raid leader.',
};

export const dynamic = 'force-dynamic';

// Who still lacks which preflag, for the Overview. Read once per page load, NOT live: it is a snapshot from when
// the page was opened, and a raider who earns a flag mid-raid shows as missing until the page is reloaded
// (the live polls carry positions, loot and the screen state, not flags). Any failure leaves the box out.
async function loadPreflags(): Promise<PreflagSummary | null> {
  try {
    const { raiders, note } = await loadRaiders();
    if (!raiders.length) return null;
    const held = await loadHeld(raiders.map(r => r.name));
    return preflagSummary(raiders, held, PREFLAGS, note);
  } catch {
    return null;
  }
}

export default async function ScreenPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/screen');
  const preflagsRead = loadPreflags();   // started now so it runs beside the officer check
  const canDrive = await isOfficer(user.id);
  const preflags = await preflagsRead;
  // Tonight's plan, drawn under the live map when the raid is in one of its zones (the guild lead, 2026-10-14).
  const plan = planOverlays(PLAN);

  return (
    <div className="mx-auto max-w-7xl py-2">
      <NewPageTag note="New page: the raid screen the raid leader drives." />
      <h1 className="mb-3 text-2xl text-gold">Raid screen</h1>
      <ScreenBoard canDrive={canDrive} plan={plan} preflags={preflags} />
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
