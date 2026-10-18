// /me/voice: set and HEAR how your characters' names are spoken by Mimic's voice callouts (the guild lead,
// 2026-10-17, picked option A). Text-to-speech mangles fantasy names; you write the name the way it should
// sound and Mimic says it that way. New page, so it ships live with the [beta] tag (DECISIONS §135).
//
// PRIVATE to the signed-in person: the characters are exactly what ownedCharacters returns, never a name from
// the URL. The save and clear actions check that again on the server.
import { redirect } from 'next/navigation';
import Link from 'next/link';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { myPronunciations } from '@/lib/pronunciations';
import NewPageTag from '@/components/NewPageTag';
import PronunciationRow from '@/components/PronunciationRow';
import { saveMyPronunciation, clearMyPronunciation } from './actions';

export const metadata: Metadata = {
  title: '[beta] Say your name',
  description: 'Set how your characters’ names sound when Mimic reads them out loud, and hear it first.',
};

export const dynamic = 'force-dynamic';

export default async function VoicePage() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/me/voice');

  const owned = (await ownedCharacters(user.id)).map(c => ({ name: c.name }));
  const rows = await myPronunciations(supabaseAdmin(), owned);

  return (
    <div className="space-y-4">
      <NewPageTag note="Set how your characters' names sound when Mimic reads them out loud." />
      <section className="rounded-lg border border-border bg-panel p-6">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex items-center gap-3 text-2xl text-gold">
              <span aria-hidden>🔊</span>
              <span>Say your name</span>
            </h1>
            <p className="mt-1 max-w-3xl text-sm text-dim">
              Voice callouts often get fantasy names wrong. Write your character&apos;s name the way it sounds, with hyphens
              between the syllables and the stressed one in CAPITALS, like <span className="font-mono text-text">AL-den-mar</span>,
              then press Hear. Tap Suggestions for a few guesses to start from. Leave a name empty and it is said as spelled.
            </p>
            <p className="mt-2 max-w-3xl text-sm text-dim">
              This page uses your browser&apos;s voice. Mimic uses your Windows voice (or the voice it downloaded), so it will
              sound a little different. Mimic picks up a change within about 10 minutes.
            </p>
          </div>
          <Link href="/me" className="whitespace-nowrap text-sm text-blue hover:underline">← My stats</Link>
        </div>
      </section>

      {rows.length === 0 ? (
        <div className="rounded border border-orange/40 bg-panel p-4 text-sm text-orange">
          No characters are linked to your Discord account yet.
        </div>
      ) : (
        <ul className="space-y-2">
          {rows.map(r => (
            <PronunciationRow
              key={r.name}
              name={r.name}
              initialSay={r.say}
              save={saveMyPronunciation}
              clear={clearMyPronunciation}
            />
          ))}
        </ul>
      )}
    </div>
  );
}
