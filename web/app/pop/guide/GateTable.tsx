// ?v=gate-b: one gate, every character in the family, one column per piece (the guild lead, 2026-11-01, shown
// exactly this table: "this format is needed for the pop guide"). A gate picker on top; a row per character; a
// cell per piece (✅ / ⏳ / ❌ / ❓); a last "What's left" column with the plain verdict. The table scrolls inside
// its own box, so the page never scrolls sideways on a phone. The first column stays put while it scrolls.
//
// A server component: no state. The picker is plain links (?gate=), a full page load like NextTable's cells.

import { STATE_UI, TONE_CLS } from './GateMissing';
import type { PieceStatus, Verdict } from '@/lib/popGateStatus';

export type GateTableRow = { name: string; cls: string | null; isMain: boolean; pieces: PieceStatus[]; verdict: Verdict };
export type GateChoice = { key: string; name: string; short: string };

const KIND_WORD = { kill: 'kill', task: 'task', handin: 'hand-in' } as const;

// A character's name opens their own piece-by-piece list (the guild lead, 2026-11-02: "the family view is great, and
// the individual view is good if we click on one of the character names from that list").
export default function GateTable({ gates, selected, rows, hrefFor, singleHref, charHref }: {
  gates: GateChoice[]; selected: string; rows: GateTableRow[];
  hrefFor: (gateKey: string) => string; singleHref: string; charHref?: (name: string) => string;
}) {
  const gate = gates.find(g => g.key === selected) ?? gates[0];
  const heads = rows[0]?.pieces ?? [];
  return (
    <section aria-labelledby="gate-b-title" className="bg-panel border border-border rounded-lg p-3 flex flex-col gap-2 min-w-0">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <h2 id="gate-b-title" className="text-sm text-gold font-semibold">What each character is missing for {gate.name}</h2>
        <a href={singleHref} className="ml-auto text-xs text-blue hover:underline">one character →</a>
      </div>

      <nav aria-label="Pick a gate" className="flex flex-wrap gap-1.5 text-[11px]">
        {gates.map(g => (
          <a key={g.key} href={hrefFor(g.key)} title={g.name}
             aria-current={g.key === gate.key ? 'page' : undefined}
             className={g.key === gate.key
               ? 'px-2 py-0.5 rounded border border-accent bg-accent/20 text-text'
               : 'px-2 py-0.5 rounded border border-border text-dim hover:text-text hover:border-blue'}>
            {g.short}
          </a>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="text-sm text-dim">No characters to show yet.</p>
      ) : (
        <div className="overflow-x-auto -mx-3 px-3 pb-1">
          <table className="border-collapse text-[11px] min-w-max">
            <thead>
              <tr>
                <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal text-dim pr-3 pb-1 align-bottom">Character</th>
                {heads.map(h => (
                  <th key={h.key} scope="col" className="text-left font-normal text-dim px-2 pb-1 align-bottom min-w-[6.5rem] max-w-[9rem]"
                      title={`${h.label} (${KIND_WORD[h.kind]})${h.verified ? '' : ', not confirmed'}`}>
                    {h.label}{!h.verified && ' ?'}
                    <span className="block text-[10px]">{KIND_WORD[h.kind]}</span>
                  </th>
                ))}
                <th scope="col" className="text-left font-normal text-dim px-2 pb-1 align-bottom min-w-[11rem]">What&apos;s left</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.name} className="border-t border-border">
                  <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-normal pr-3 py-1.5 align-top whitespace-nowrap">
                    {charHref
                      ? <a href={charHref(r.name)} className="text-text hover:text-blue hover:underline" title={`What ${r.name} is missing, piece by piece`}>{r.name}</a>
                      : <span className="text-text">{r.name}</span>}
                    {!r.isMain && <span className="text-dim"> (alt)</span>}
                    {r.cls && <span className="block text-[10px] text-dim">{r.cls}</span>}
                  </th>
                  {r.pieces.map(p => {
                    const ui = STATE_UI[p.state];
                    const why = p.state === 'missing' ? `needs ${p.needs}` : p.detail;
                    return (
                      <td key={p.key} className="px-2 py-1.5 align-top" title={`${ui.word}${why ? `: ${why}` : ''}`}>
                        <span aria-hidden className={ui.cls}>{ui.icon}</span>
                        <span className={`block text-[10px] ${ui.cls}`}>
                          {p.state === 'pending' ? 'Seer' : p.killOnly ? 'kill only' : ui.word}
                        </span>
                      </td>
                    );
                  })}
                  <td className={`px-2 py-1.5 align-top ${TONE_CLS[r.verdict.tone]}`}>{r.verdict.text}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="text-[11px] text-dim">
        ✅ done · ⏳ kill credited, the Seer is holding it · ❌ missing (they have had a full read: the Seer&apos;s recital or
        #popflags) · ❓ not recorded (no full read yet, or a kill is on record without the hail after it). A ? marks a piece
        that is our best reading. From Mimic, /who, loot and ticks as the page loaded.
      </p>
    </section>
  );
}
