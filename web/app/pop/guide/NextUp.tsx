'use client';

// Variant A of the "next steps for flags" panel (?nx=a; the guild lead, 2026-10-10: "put at the top of the
// guide next steps for flags in a consolidated place"): a short card for ONE character — the 3 to 5 steps
// that can be done now, each a link down to its row in the checklist, and a line for each progression line
// that is waiting on something else. The character follows the checklist's own picker: pick() there puts
// ?c= in the URL, and useSearchParams hears it. The numbers are what the page knew when it loaded
// (web/lib/popNextSteps.ts); a tick made since shows on the next load.
//
// Imports only types from the lib, so the guide catalog does not ride into the browser a second time.

import { useSearchParams } from 'next/navigation';
import type { NextCard, NextStep } from '@/lib/popNextSteps';

export type NextUpChar = { name: string; cls: string | null; isMain: boolean; card: NextCard };

const WHO: Record<NextStep['who'], string> = { solo: '🧍 Solo', group: '👥 Group', raid: '⚔ Raid' };
const chip = 'px-1.5 rounded border border-border text-dim';

export default function NextUp({ chars, initial, anchorPrefix, compareHref }: {
  chars: NextUpChar[]; initial: string | null; anchorPrefix: string; compareHref: string;
}) {
  const wanted = useSearchParams()?.get('c')?.toLowerCase();
  const char = chars.find(c => c.name.toLowerCase() === wanted) ?? chars.find(c => c.name === initial) ?? chars[0] ?? null;

  if (!char) {
    return (
      <section className="bg-panel border border-border rounded-lg p-4 text-sm text-dim">
        No characters to show next steps for yet.
      </section>
    );
  }
  const { card } = char;
  return (
    <section aria-labelledby="nx-a-title" className="bg-panel border border-border rounded-lg p-4 flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="nx-a-title" className="text-sm text-gold font-semibold">Next up for {char.name}</h2>
        <span className="text-[11px] text-dim">
          {card.finished}/{card.lines} progression lines finished
        </span>
        <a href={compareHref} className="ml-auto text-xs text-blue hover:underline">every character →</a>
      </div>

      {card.top.length > 0 ? (
        <ul className="flex flex-col">
          {card.top.map(t => (
            <li key={t.step.key} className="flex flex-col gap-1 py-2 border-t border-border first:border-t-0 first:pt-0">
              <a href={`#${anchorPrefix}${t.step.key}`} className="text-sm text-blue hover:underline break-words">{t.step.title}</a>
              <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                <span className={chip}>{WHO[t.step.who]}</span>
                {t.step.zone && <span className={chip}>📍 {t.step.zone}</span>}
                {t.step.must && <span className="px-1.5 rounded border border-gold/60 text-gold">★ must</span>}
                {t.step.flagLabel && <span className="px-1.5 rounded border border-green/60 text-green" title="The flag this step earns">🚩 {t.step.flagLabel}</span>}
                {t.step.verify && <span className={chip} title="Classic detail, not yet confirmed on Quarm">verify at launch</span>}
                <span className="text-dim">{t.label}</span>
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-dim">
          {card.blocked.length > 0 ? 'Nothing can be done right now; see what each line is waiting on below.' : 'Every progression line is finished.'}
        </p>
      )}
      {card.more > 0 && (
        <p className="text-[11px] text-dim">
          {card.more} more {card.more === 1 ? 'line has' : 'lines have'} a step to do; finish these and they come up.
        </p>
      )}

      {card.blocked.length > 0 && (
        <details className="border-t border-border pt-2" open={card.top.length === 0}>
          <summary className="cursor-pointer text-[11px] text-dim uppercase tracking-wide">
            Waiting on something else · {card.blocked.length}
          </summary>
          <ul className="flex flex-col gap-1 text-xs mt-1">
            {card.blocked.map(b => (
              <li key={b.line} className="text-dim">
                <span className="text-orange">⛔ {b.label}</span>
                {': needs '}
                <span className="text-text">
                  {b.blockedOn.map(x => (x.lineShort ? `${x.label} (${x.lineShort})` : x.label)).join(', ')}
                </span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <p className="text-[11px] text-dim">
        Built from everything we know about {char.name}: Mimic&apos;s flag messages, /who sightings inside a plane, loot from a
        plane, and your own ticks.
        {card.skipped > 0 && ` ${card.skipped} earlier ${card.skipped === 1 ? 'step is' : 'steps are'} not ticked on lines you are already past.`}
      </p>
    </section>
  );
}
