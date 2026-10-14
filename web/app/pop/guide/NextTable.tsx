// Variant B of the "next steps for flags" panel (?nx=b; the guild lead, 2026-10-10: "put at the top of the
// guide next steps for flags in a consolidated place"): every listed character at once, one row each, one
// column per progression line. A cell is that character's next step on the line, ✓ done, or ⛔ what the line
// waits on. Each cell is a plain link to ?c=<name>#<step>, a full page load on purpose: the checklist keeps
// its picked character in client state, and a soft navigation to another ?c= would leave it on the old one.
// The table scrolls inside its own box so the page itself never scrolls sideways.
//
// A server component: no state, nothing for the browser to load.

import type { LineNext } from '@/lib/popNextSteps';

export type NextTableRow = { name: string; cls: string | null; isMain: boolean; lines: LineNext[] };

const WHO_ICON = { solo: '🧍', group: '👥', raid: '⚔' } as const;
const WHO_WORD = { solo: 'solo', group: 'group', raid: 'raid' } as const;

function Cell({ l, href }: { l: LineNext; href: string }) {
  if (l.state === 'done') return <span className="text-green">✓ done</span>;
  const step = l.steps[0];
  if (l.state === 'blocked') {
    const on = l.blockedOn.map(b => b.lineShort ?? b.label).join(', ');
    return (
      <a href={href} className="block text-orange hover:underline"
         title={`${step.title}. Needs: ${l.blockedOn.map(b => b.label).join('; ')}`}>
        ⛔ needs {on}
      </a>
    );
  }
  return (
    <a href={href} className="block text-text hover:text-blue" title={step.title}>
      <span className="line-clamp-2 break-words">{step.title}</span>
      <span className="text-[10px] text-dim">
        <span aria-label={WHO_WORD[step.who]}>{WHO_ICON[step.who]}</span>
        {step.must && <span className="text-gold"> ★</span>}
        {l.steps.length > 1 && ` +${l.steps.length - 1} more`}
      </span>
    </a>
  );
}

export default function NextTable({ rows, hrefFor, singleHref }: {
  rows: NextTableRow[];
  hrefFor: (name: string, stepKey?: string) => string;
  singleHref: string;
}) {
  const heads = rows[0]?.lines ?? [];
  return (
    <section aria-labelledby="nx-b-title" className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="nx-b-title" className="text-sm text-gold font-semibold">Who needs what next</h2>
        <span className="text-[11px] text-dim">each cell is that character&apos;s next step on the line</span>
        <a href={singleHref} className="ml-auto text-xs text-blue hover:underline">one character →</a>
      </div>
      {rows.length === 0 ? (
        <p className="text-sm text-dim">No characters to show yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-3 px-3 pb-1">
          <table className="border-collapse text-[11px] min-w-max">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal text-dim pr-3 pb-1 align-bottom">Character</th>
                {heads.map(h => (
                  <th key={h.line} scope="col" className="text-left font-normal text-dim px-2 pb-1 align-bottom min-w-[8.5rem] max-w-[10rem]" title={h.label}>
                    {h.short}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const finished = r.lines.filter(l => l.state === 'done').length;
                return (
                  <tr key={r.name} className="border-t border-border">
                    <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-normal pr-3 py-1.5 align-top whitespace-nowrap">
                      <a href={hrefFor(r.name)} className="text-text hover:text-blue hover:underline">{r.name}</a>
                      {!r.isMain && <span className="text-dim"> (alt)</span>}
                      <span className="block text-[10px] text-dim">{r.cls ? `${r.cls} · ` : ''}{finished}/{r.lines.length} lines</span>
                    </th>
                    {r.lines.map(l => (
                      <td key={l.line} className="px-2 py-1.5 align-top min-w-[8.5rem] max-w-[10rem]">
                        <Cell l={l} href={hrefFor(r.name, l.steps[0]?.key)} />
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-dim">
        <span className="text-green">✓ done</span> the line is finished. <span className="text-orange">⛔ needs</span> the line
        it waits on. 🧍 solo · 👥 group · ⚔ raid · <span className="text-gold">★</span> must-have. From Mimic, /who, loot and
        ticks as the page loaded.
      </p>
    </section>
  );
}
