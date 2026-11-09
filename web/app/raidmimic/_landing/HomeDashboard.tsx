// "Dashboard": the signed-in top of raidmimic.com as one dense screen (the guild lead, 2026-11-09: "site looks barebones
// here"; picked option B on the Decision Desk the same day). Who you are, then three cards: your characters, your guilds,
// Mimic. The coordination ideas are one dim line at the bottom: labelled coming, never links or buttons. The site bar is
// drawn ABOVE this by the page (web/app/raidmimic/page.tsx), so the landing never carries two bars.
import type { CharacterView } from '@/lib/hubCharactersView';
import { GUILDS_STAY_PATH } from '@/lib/guildSites';
import { DASH_WORDS as W, comingLine, type HomeGuild } from '@/lib/raidmimicHome';
import { BTN, CARD, LINK, MAX_SHOWN, charactersHref } from './HomeParts';

export default function HomeDashboard({ name, avatarUrl, mine, guilds, downloadUrl }: {
  name: string | null; avatarUrl: string | null; mine: CharacterView[]; guilds: HomeGuild[]; downloadUrl: string;
}) {
  return (
    <section id="your-raidmimic" aria-label="Your Raid Mimic" data-home-panel className="mx-auto max-w-5xl px-1 pb-4">
      <div className="flex items-center gap-3">
        {avatarUrl
          ? <img src={avatarUrl} alt="" width={48} height={48} className="h-12 w-12 rounded-full border border-border" />
          : <span aria-hidden className="h-12 w-12 rounded-full border border-border bg-panel" />}
        <div>
          <p className="m-0 text-xs uppercase tracking-wider text-dim">{W.welcome}</p>
          <h1 className="m-0 text-2xl text-gold">{name ?? 'Player'}</h1>
        </div>
      </div>

      <div className="mt-5 grid gap-3 md:grid-cols-3">
        <div className={CARD} data-card="characters">
          <h2 className="m-0 text-base text-text">{W.characters}</h2>
          {mine.length === 0 ? (
            <>
              <p className="mt-2 text-sm text-dim">{W.charactersEmpty}</p>
              <p className="mt-3"><a href={charactersHref} className={BTN}>{W.charactersButton}</a></p>
            </>
          ) : (
            <>
              <ul className="m-0 mt-2 list-none p-0">
                {mine.slice(0, MAX_SHOWN).map(c => (
                  <li key={c.name} className="flex flex-wrap items-baseline justify-between gap-x-3 border-b border-border py-2 last:border-b-0">
                    <span className="text-text">{c.name}</span>
                    <span className="text-xs text-dim">{c.flagCount} flag{c.flagCount === 1 ? '' : 's'}</span>
                  </li>
                ))}
              </ul>
              <p className="m-0"><a href={charactersHref} className={LINK}>{W.charactersAll} →</a></p>
            </>
          )}
        </div>

        <div className={CARD} data-card="guilds">
          <h2 className="m-0 text-base text-text">{W.guilds}</h2>
          {guilds.length === 0 && <p className="mt-2 text-sm text-dim">{W.guildsEmpty}</p>}
          <ul className="m-0 mt-2 list-none p-0">
            {guilds.map(g => (
              <li key={g.key} className="border-b border-border py-2 last:border-b-0">
                <a href={GUILDS_STAY_PATH} className="text-text">{g.name}</a>
                {g.site && <p className="m-0"><a href={g.site} className={LINK}>Open {g.name}&rsquo;s site &rarr;</a></p>}
              </li>
            ))}
          </ul>
          <p className="m-0"><a href={GUILDS_STAY_PATH} className={LINK}>{W.guildsManage} →</a></p>
        </div>

        <div className={CARD} data-card="mimic">
          <h2 className="m-0 text-base text-text">{W.mimic}</h2>
          <p className="mt-2 text-sm text-dim">{W.mimicBlurb}</p>
          <p className="mt-3"><a href={downloadUrl} className={BTN}>{W.mimicButton}</a></p>
        </div>
      </div>

      <p data-coming className="mb-0 mt-5 text-xs text-dim">{comingLine()}</p>
    </section>
  );
}
