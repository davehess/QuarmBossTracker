// "Your Raid Mimic": the panel for a signed-in visitor, shown INSTEAD of the video at the top of the landing
// (the guild lead, 2026-11-09). Their own loaded characters (the shared lib/hubMine read), a link to /characters to load more,
// and the coordination ideas as placeholders. Those are labelled coming and are not links or buttons: nothing here claims
// they work. Everything player-supplied (a character name) renders as plain text.
import type { CharacterView } from '@/lib/hubCharactersView';
import { HOME_WORDS as H } from '@/lib/raidmimicHome';
import { RAIDMIMIC_CHARACTERS_PATH } from '@/lib/raidmimicHost';

const MAX_SHOWN = 6;

export default function HomePanel({ mine }: { mine: CharacterView[] }) {
  return (
    <section id="your-raidmimic" aria-label={H.panelTitle} data-home-panel className="mx-auto max-w-5xl px-1 py-4">
      <h2 className="text-2xl text-gold">{H.panelTitle}</h2>
      {mine.length === 0 && <p className="mt-2 text-sm text-dim">{H.empty}</p>}
      <ul className="mt-3 grid list-none gap-3 p-0 sm:grid-cols-2">
        {mine.slice(0, MAX_SHOWN).map(c => {
          const top = c.next.top[0];
          return (
            <li key={c.name} className="rounded-lg border border-border bg-panel p-4">
              <div className="flex flex-wrap items-baseline gap-x-3">
                <span className="text-lg text-text">{c.name}</span>
                <span className="text-xs text-dim">{c.flagCount} flag{c.flagCount === 1 ? '' : 's'}</span>
              </div>
              {top && <p className="mb-0 mt-2 text-sm"><span className="text-dim">Needs next, {top.label}:</span> {top.step.title}</p>}
            </li>
          );
        })}
      </ul>
      <p className="mt-3 text-sm"><a href={RAIDMIMIC_CHARACTERS_PATH} className="inline-flex min-h-11 items-center">{mine.length > MAX_SHOWN ? `All ${mine.length} characters, and load more` : H.loadMore} →</a></p>

      <h3 className="mt-6 text-xs uppercase tracking-wider text-dim">{H.comingTitle}</h3>
      <ul className="mt-2 grid list-none gap-2 p-0 sm:grid-cols-2">
        {H.coming.map(t => (
          <li key={t} data-coming className="rounded-lg border border-dashed border-border p-3 text-sm text-dim">
            <span className="mr-2 rounded border border-border px-1.5 text-xs uppercase tracking-wider">coming</span>{t}
          </li>
        ))}
      </ul>
    </section>
  );
}
