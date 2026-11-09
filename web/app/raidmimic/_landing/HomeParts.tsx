// Pieces shared by the two signed-in home previews (HomeDashboard `?v=b`, HomeChecklist `?v=c`; the guild lead, 2026-11-09).
// Server components, no client JS. Everything player-supplied (a character or guild name) renders as plain text.
import type { CharacterView } from '@/lib/hubCharactersView';
import { RAIDMIMIC_CHARACTERS_PATH } from '@/lib/raidmimicHost';

export const CARD = 'rounded-lg border border-border bg-panel p-4';
export const BTN = 'inline-flex min-h-11 items-center justify-center rounded-lg border border-border bg-bg px-4 text-sm text-gold hover:no-underline';
export const LINK = 'inline-flex min-h-11 items-center text-sm';
export const MAX_SHOWN = 6;
export const charactersHref = RAIDMIMIC_CHARACTERS_PATH;

export function CharacterCards({ mine }: { mine: CharacterView[] }) {
  return (
    <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
      {mine.slice(0, MAX_SHOWN).map(c => {
        const top = c.next.top[0];
        return (
          <li key={c.name} className={CARD}>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="text-lg text-text">{c.name}</span>
              <span className="text-xs text-dim">{c.flagCount} flag{c.flagCount === 1 ? '' : 's'}</span>
            </div>
            {top && <p className="mb-0 mt-2 text-sm"><span className="text-dim">Needs next, {top.label}:</span> {top.step.title}</p>}
          </li>
        );
      })}
    </ul>
  );
}
