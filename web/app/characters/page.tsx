// /characters: "My characters" on raidmimic.com (the guild lead, 2026-11-09, DECISIONS §545: Raid Mimic takes in the
// Zeal `<Name>-PoPFlags.txt` export so anyone can load their characters). A player uploads one or more of those files
// and sees each character's PoP flag progress and what it needs next.
//
// New page, so it goes live with the [beta] tag. Signed-in players only, and ONLY the signed-in player's own
// characters are read or shown: every read below is keyed on the player id taken from the session. Nothing on this page
// is shown to anyone else in this step. Everything player-supplied (names) renders as plain text.
// The hub_* tables may not exist on a database the registry has not been applied to; the read fails soft to "none yet".
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { supabaseServer } from '@/lib/supabase-server';
import { discordIdOf } from '@/lib/lockout';
import { isRaidmimicHost } from '@/lib/raidmimicHost';
import { EQMIMIC_ORIGIN } from '@/lib/raidmimicLanding';
import { loadMine } from '@/lib/hubMine';
import { MAX_CHARACTERS_PER_PLAYER } from '@/lib/hubImport';
import NewPageTag from '@/components/NewPageTag';
import SignInButton from '@/components/SignInButton';
import HostFrame from '@/components/RaidmimicFrame';
import UploadForm from './UploadForm';

export const metadata: Metadata = {
  title: '[beta] My characters',
  description: 'Load your characters on Raid Mimic from the PoPFlags file Zeal saves when you camp, and see each one’s Planes of Power flag progress and what it needs next.',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const CARD = 'rounded-lg border border-border bg-panel p-4';

export default async function CharactersPage() {
  const onHost = isRaidmimicHost(headers().get('host'));
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  const note = <NewPageTag note="New page: load your characters from the PoPFlags file Zeal saves." href={onHost ? `${EQMIMIC_ORIGIN}/feedback` : '/feedback'} />;

  if (!user || !discordId) {
    return (
      <HostFrame onHost={onHost}>
        <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
          {note}
          <h1 className="text-2xl text-gold">My characters</h1>
          <p className="mt-2 text-sm text-dim">Sign in with Discord to load your characters and see what each one needs next for the Planes of Power. Discord only tells us who you are.</p>
          <div className="mt-4"><SignInButton next="/characters" /></div>
        </div>
      </HostFrame>
    );
  }

  const mine = await loadMine(discordId);
  return (
    <HostFrame onHost={onHost}>
      <div className="mx-auto max-w-3xl px-1 py-2 pb-12">
        {note}
        <h1 className="text-2xl text-gold">My characters</h1>
        <p className="mt-1 text-sm text-dim">Signed in with Discord. Only you can see this page.</p>

        <section aria-label="Load characters" className="mt-4">
          <UploadForm max={MAX_CHARACTERS_PER_PLAYER} held={mine.length} />
        </section>

        <section aria-label="Your characters" className="mt-6 space-y-3">
          {mine.length === 0 && <p className="text-sm text-dim">No characters loaded yet. Choose your PoPFlags files above.</p>}
          {mine.map(c => (
            <article key={c.name} className={CARD}>
              <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                <h2 className="text-lg text-text">{c.name}</h2>
                <span className="text-xs text-dim">{c.flagCount} flag{c.flagCount === 1 ? '' : 's'}{c.lastExport ? ` · export of ${c.lastExport.slice(0, 10)}` : ''}</span>
                {c.proof === 'contested' && <span className="rounded border border-orange/50 px-2 text-xs text-orange">name claimed by another player too</span>}
              </div>

              {c.next.top.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs uppercase tracking-wider text-dim">Needs next</h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {c.next.top.map(t => (
                      <li key={t.line + t.step.key}><span className="text-dim">{t.label}:</span> {t.step.title}</li>
                    ))}
                  </ul>
                  {c.next.more > 0 && <p className="mt-1 text-xs text-dim">and {c.next.more} more line{c.next.more === 1 ? '' : 's'} with something to do.</p>}
                </div>
              )}
              {c.next.blocked.length > 0 && (
                <div className="mt-3">
                  <h3 className="text-xs uppercase tracking-wider text-dim">Waiting on a flag</h3>
                  <ul className="mt-1 space-y-1 text-sm">
                    {c.next.blocked.map(b => (
                      <li key={b.line}><span className="text-dim">{b.label}:</span> needs {b.blockedOn.map(x => x.label).join(', ')}</li>
                    ))}
                  </ul>
                </div>
              )}
              {c.next.top.length === 0 && c.next.blocked.length === 0 && (
                <p className="mt-3 text-sm text-dim">{c.flagCount === 0 ? 'No flags read from this export yet.' : 'Nothing left on the lines we track.'}</p>
              )}

              {c.groups.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-sm text-blue">Flags it has</summary>
                  <dl className="mt-2 space-y-2 text-sm">
                    {c.groups.map(g => (
                      <div key={g.zone}>
                        <dt className="text-xs uppercase tracking-wider text-dim">{g.zone}</dt>
                        <dd>{g.labels.join(' · ')}</dd>
                      </div>
                    ))}
                  </dl>
                </details>
              )}
            </article>
          ))}
        </section>
      </div>
    </HostFrame>
  );
}
