// /guilds/new: "Start a guild" (the guild lead, 2026-10-31, DECISIONS §492; docs/DESIGN-raidmimic-hosted.md §4 wizard step 2).
// New page, so it goes live with the [beta] tag. Signed-in players only, the same gate as /guilds. The form and the
// rules are NewGuildForm.tsx and actions.ts; the page reads nothing. Served on raidmimic.com too (the middleware lets
// /guilds/* through, web/lib/raidmimicHost.ts).
import { headers } from 'next/headers';
import { redirect } from 'next/navigation';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { EQMIMIC_ORIGIN, interestUrl } from '@/lib/raidmimicLanding';
import NewPageTag from '@/components/NewPageTag';
import NewGuildForm from './NewGuildForm';

export const metadata: Metadata = {
  title: '[beta] Start a guild',
  description: 'Start a guild on Raid Mimic: name it, pick its address and optionally link its Discord server, then invite your raiders with codes.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

export default async function NewGuildPage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/guilds/new');
  const onHost = isRaidmimicHost(headers().get('host'));

  return (
    <div className="mx-auto max-w-xl px-1 py-2 pb-12">
      <NewPageTag note="New page: start a guild and invite your raiders." href={onHost ? interestUrl(`${EQMIMIC_ORIGIN}/feedback`) : '/feedback'} />
      <h1 className="text-2xl text-gold">Start a guild</h1>
      <p className="mt-1 text-sm text-dim">
        You become its owner. Once it exists you can make invite codes and hand them to your raiders. One guild a day per person.
      </p>
      <NewGuildForm />
      <p className="mt-6"><a href="/guilds" className="inline-flex min-h-11 items-center text-sm">&larr; Your guilds</a></p>
    </div>
  );
}
