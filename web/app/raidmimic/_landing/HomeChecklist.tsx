// `?v=c` "Get started": the signed-in top of raidmimic.com as a guided list (the guild lead, 2026-11-09: "site looks barebones
// here"). The site bar first, then five numbered steps, each a large card with its status. The coordination step is
// labelled coming and is not a link. Under the steps, once characters are loaded, their cards.
import type { CharacterView } from '@/lib/hubCharactersView';
import { GUILDS_STAY_PATH } from '@/lib/guildSites';
import { STEPS_WORDS as W, checklistSteps, type StepStatus, type HomeGuild } from '@/lib/raidmimicHome';
import { HostBar } from '@/components/RaidmimicFrame';
import { BTN, CARD, CharacterCards, charactersHref } from './HomeParts';

const BADGE: Record<StepStatus, string> = {
  done: 'border-border text-green',
  todo: 'border-border text-gold',
  coming: 'border-dashed border-border text-dim',
};

export default function HomeChecklist({ mine, guilds, downloadUrl }: { mine: CharacterView[]; guilds: HomeGuild[]; downloadUrl: string }) {
  const steps = checklistSteps(mine.length, guilds.length);
  return (
    <section id="your-raidmimic" aria-label={W.title} data-home-variant="c" className="mx-auto max-w-3xl px-1">
      <HostBar />
      <h1 className="m-0 text-2xl text-gold">{W.title}</h1>
      <ol className="m-0 mt-4 list-none space-y-3 p-0">
        {steps.map(s => {
          const words = W[s.key];
          return (
            <li key={s.key} data-step={s.key} data-status={s.status} className={`${CARD} ${s.status === 'coming' ? 'border-dashed' : ''}`}>
              <div className="flex flex-wrap items-center gap-3">
                <span className="text-xl text-dim">{s.n}</span>
                <h2 className="m-0 text-lg text-text">{words.title}</h2>
                <span className={`ml-auto rounded border px-2 py-0.5 text-xs uppercase tracking-wider ${BADGE[s.status]}`}>{W[s.status]}</span>
              </div>
              <p className={`mb-0 mt-2 text-sm ${s.status === 'coming' ? 'text-dim' : ''}`}>
                {words.body}{s.key === 'characters' && mine.length > 0 ? ` ${mine.length} loaded.` : ''}
              </p>
              {s.key === 'mimic' && <p className="mb-0 mt-3"><a href={downloadUrl} className={BTN}>{W.mimic.button}</a></p>}
              {s.key === 'characters' && s.status === 'todo' && <p className="mb-0 mt-3"><a href={charactersHref} className={BTN}>{W.characters.button}</a></p>}
              {s.key === 'guild' && (
                <p className="mb-0 mt-3 flex flex-wrap gap-3">
                  <a href={GUILDS_STAY_PATH} className={BTN}>{W.guild.join}</a>
                  <a href="/guilds/new" className={BTN}>{W.guild.start}</a>
                </p>
              )}
            </li>
          );
        })}
      </ol>
      {mine.length > 0 && (
        <>
          <h2 className="mb-3 mt-6 text-xs uppercase tracking-wider text-dim">{W.yourCharacters}</h2>
          <CharacterCards mine={mine} />
        </>
      )}
    </section>
  );
}
