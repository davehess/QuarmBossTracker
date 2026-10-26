// One character's step list on /pop/raid/me: numbered, done ones green with a tick, the ones still needed in
// orange with where to stand (/loc) and what to say, each copyable. Colour is never the only signal: the tick
// and a screen-reader word say the same thing. The steps come from lib/raidMe.ts stepsFor.
import CopyChip from '@/components/CopyChip';
import type { MeStep } from '@/lib/raidMe';

export default function MeSteps({ steps }: { steps: MeStep[] }) {
  if (steps.length === 0) return <p className="mt-2 text-xs text-dim">No steps to show.</p>;
  return (
    <ol className="mt-2 space-y-2.5 text-sm">
      {steps.map((s, i) => (
        <li key={s.key} className="flex gap-2">
          <span className={`w-5 shrink-0 text-right ${s.done ? 'text-green' : 'text-orange'}`}>{i + 1}.</span>
          <div className="min-w-0">
            <div className={s.done ? 'text-green' : 'text-orange'}>
              <span aria-hidden="true">{s.done ? '✓ ' : ''}</span>
              <span className="sr-only">{s.done ? 'Done: ' : 'Still needed: '}</span>
              {s.label}
              {s.target && <span className="text-dim"> · {s.target}</span>}
            </div>
            {!s.done && (s.loc || s.say.length > 0 || s.note) && (
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-dim">
                {s.note && <span>{s.note}</span>}
                {s.loc && <CopyChip text={s.loc} />}
                {s.say.length > 0 && (
                  <>
                    <span>Say:</span>
                    {s.say.map(w => <CopyChip key={w} text={`/say ${w}`} />)}
                  </>
                )}
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
