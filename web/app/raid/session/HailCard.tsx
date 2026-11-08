// Who hailed each flag NPC during the window (the guild lead, 2026-11-03). Shared by the members' page and the share page
// through SessionReview. A hail is the stand-in for "flagged": the server flags whoever hails while in the raid and visible.
// Renders nothing when the window has no hails. Names arrive already scrubbed (an opted-out character is their label).
import type { HailEvent } from '@/lib/raidHails';
import { etMin } from './nightStyle';

const SHOWN = 12;

export default function HailCard({ events }: { events: HailEvent[] | undefined }) {
  if (!events?.length) return null;
  return (
    <section className="mt-4 rounded-md border border-border bg-panel p-3" aria-label="Who hailed the flag NPCs">
      <h2 className="text-sm text-gold">Flag hails</h2>
      <p className="mt-0.5 text-xs text-dim">
        A hail is the nearest thing we can see to a flag: the server flags whoever hails while in the raid and visible, so this shows who hailed, not who was flagged.
      </p>
      <ul className="mt-2 space-y-3">
        {events.map(e => (
          <li key={`${e.npc}|${e.zone ?? ''}|${e.fromMs}`}>
            <div className="text-sm text-text">
              {e.npc}
              {e.zoneName && <span className="text-dim"> · {e.zoneName}</span>}
              <span className="text-dim"> · {etMin.format(e.fromMs)}</span>
              <span className="text-dim"> — {e.names.length} hailed</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {e.names.slice(0, SHOWN).map(n => <Name key={n} n={n} />)}
            </div>
            {e.names.length > SHOWN && (
              <details className="mt-1">
                <summary className="cursor-pointer text-xs text-dim">+{e.names.length - SHOWN} more</summary>
                <div className="mt-1 flex flex-wrap gap-1">
                  {e.names.slice(SHOWN).map(n => <Name key={n} n={n} />)}
                </div>
              </details>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

const Name = ({ n }: { n: string }) => (
  <span className="rounded border border-border px-1.5 py-0.5 text-xs text-text">{n}</span>
);
