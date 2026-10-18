// /admin/pronunciations: officers see every saved name pronunciation and can set or clear anyone's (the guild
// lead, 2026-10-17, picked option A). Members set their own from /me/voice; this is the fix-it-for-them page.
// New page, so it ships live with the [beta] tag (DECISIONS §135).
import Link from 'next/link';
import { requireOfficer } from '@/lib/officer';
import { supabaseAdmin } from '@/lib/supabase';
import { loadRoster } from '@/lib/roster';
import { allPronunciations } from '@/lib/pronunciations';
import NewPageTag from '@/components/NewPageTag';
import PronunciationList from './PronunciationList';

export const metadata = {
  title: '[beta] Name pronunciations · Admin',
  description: 'Set or clear how Mimic’s voice callouts say any character’s name.',
};

export const dynamic = 'force-dynamic';

export default async function AdminPronunciationsPage() {
  // Gate first: the /admin layout does not stop a page from loading its data on its own.
  await requireOfficer();

  const [entries, roster] = await Promise.all([allPronunciations(supabaseAdmin()), loadRoster()]);
  const names = roster.map(c => c.name).filter(n => /^[A-Za-z]{2,32}$/.test(n));

  return (
    <div className="space-y-4">
      <NewPageTag note="Set how any character's name is spoken by Mimic." />
      <section className="rounded-lg border border-border bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl text-gold">
              <span aria-hidden>🔊</span>
              <span>Name pronunciations</span>
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-dim">
              How Mimic&apos;s voice callouts say each character&apos;s name. Members set their own on
              {' '}<Link href="/me/voice" className="text-blue hover:underline">Say your name</Link>; as an officer you can set
              or clear anyone&apos;s here. Hear uses your browser&apos;s voice, and Mimic picks up a change within about
              10 minutes.
            </p>
          </div>
          <Link href="/admin" className="whitespace-nowrap text-sm text-blue hover:underline">← Officer tools</Link>
        </div>
      </section>
      <PronunciationList initial={entries} names={names} />
    </div>
  );
}
