// A character-by-piece table in the look of the real GateTable (app/pop/guide/GateTable.tsx), for the two demo tables
// that GateTable cannot draw without changing it: the "reported, waiting for the owner" table (a cell can carry a
// "reported" tag) and tonight's raid (pieces from two gates, with a column of what to fix). Same tokens, same icons
// (STATE_UI), the first column stays put while the table scrolls inside its own box.
import type { ReactNode } from 'react';
import { STATE_UI } from '@/app/pop/guide/GateMissing';
import type { PieceStatus } from '@/lib/popGateStatus';

export type MatrixCell = { piece: PieceStatus; reported?: boolean };
export type MatrixRow = { name: string; sub?: string; cells: MatrixCell[]; last: ReactNode; lastCls?: string };

const KIND_WORD = { kill: 'kill', task: 'task', handin: 'hand-in' } as const;

export default function PieceMatrix({ heads, groups, lastHead, rows }: {
  heads: PieceStatus[]; groups?: { label: string; span: number }[]; lastHead: string; rows: MatrixRow[];
}) {
  return (
    <div className="overflow-x-auto -mx-3 px-3 pb-1">
      <table className="border-collapse text-[11px] min-w-max">
        <thead>
          {groups && (
            <tr>
              <th className="sticky left-0 z-10 bg-panel" />
              {groups.map(g => (
                <th key={g.label} colSpan={g.span} scope="colgroup" className="text-left font-normal text-gold px-2 pb-0.5 border-b border-border">{g.label}</th>
              ))}
              <th />
            </tr>
          )}
          <tr>
            <th scope="col" className="sticky left-0 z-10 bg-panel text-left font-normal text-dim pr-3 pb-1 align-bottom">Character</th>
            {heads.map(h => (
              <th key={h.key} scope="col" className="text-left font-normal text-dim px-2 pb-1 align-bottom min-w-[6rem] max-w-[8rem]">
                {h.label}
                <span className="block text-[10px]">{KIND_WORD[h.kind]}</span>
              </th>
            ))}
            <th scope="col" className="text-left font-normal text-dim px-2 pb-1 align-bottom min-w-[11rem]">{lastHead}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.name} className="border-t border-border">
              <th scope="row" className="sticky left-0 z-10 bg-panel text-left font-normal pr-3 py-1.5 align-top whitespace-nowrap">
                <span className="text-text">{r.name}</span>
                {r.sub && <span className="block text-[10px] text-dim">{r.sub}</span>}
              </th>
              {r.cells.map(c => {
                const ui = STATE_UI[c.piece.state];
                return (
                  <td key={c.piece.key} className="px-2 py-1.5 align-top">
                    {c.reported ? (
                      <span className="inline-block rounded border border-gold/60 bg-gold/10 px-1.5 py-0.5" title="Reported by someone else. The owner has not confirmed it yet.">
                        <span aria-hidden className="text-green">{ui.icon}</span>
                        <span className="block text-[10px] text-gold">reported</span>
                      </span>
                    ) : (
                      <>
                        <span aria-hidden className={ui.cls}>{ui.icon}</span>
                        <span className={`block text-[10px] ${ui.cls}`}>{c.piece.state === 'pending' ? 'Seer' : ui.word}</span>
                      </>
                    )}
                  </td>
                );
              })}
              <td className={`px-2 py-1.5 align-top ${r.lastCls ?? 'text-text'}`}>{r.last}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
