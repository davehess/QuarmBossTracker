// ?v=gate-a: the sidebar card's "Waiting on something else" with every piece of each blocked gate spelled out
// (the guild lead, 2026-11-01: "the side bar where it says specifically what you're missing, not just the last
// thing mentioned"). One <details> per blocked progression line: its summary carries the verdict ("No, needs a Marr
// kill, then the Seer and Maelin"), its body is the checklist, each piece ✅ done / ⏳ the Seer is holding it /
// ❌ missing / ❓ not recorded. The first one starts open; the rest are one line each.
//
// No hooks and no catalog import (types only), so NextUp (a client component) and GateTable (a server one) can
// both take the look from here without the guide catalog riding into the browser.

import type { GateCardEntry, PieceState, PieceStatus, Verdict } from '@/lib/popGateStatus';

export const STATE_UI: Record<PieceState, { icon: string; word: string; cls: string }> = {
  done: { icon: '✅', word: 'done', cls: 'text-green' },
  pending: { icon: '⏳', word: 'Seer is holding it', cls: 'text-gold' },
  missing: { icon: '❌', word: 'missing', cls: 'text-red' },
  unknown: { icon: '❓', word: 'not recorded', cls: 'text-dim' },
};

export const TONE_CLS: Record<Verdict['tone'], string> = {
  done: 'text-green', handins: 'text-green', blocked: 'text-orange', unsure: 'text-dim',
};

const KIND_WORD: Record<PieceStatus['kind'], string> = { kill: 'kill', task: 'task', handin: 'hand-in' };

function PieceRow({ p }: { p: PieceStatus }) {
  const ui = STATE_UI[p.state];
  const why = p.state === 'missing' ? `needs ${p.needs}` : p.detail;
  return (
    <li className="flex items-start gap-2 py-1 border-t border-border first:border-t-0">
      <span aria-hidden className={ui.cls}>{ui.icon}</span>
      <span className="min-w-0 flex-1">
        <span className="text-text break-words">{p.label}</span>
        {!p.verified && <span className="text-dim" title="Not confirmed against the server's scripts"> ?</span>}
        <span className="text-[10px] text-dim"> · {KIND_WORD[p.kind]}</span>
        <span className={`block text-[11px] ${ui.cls}`}>
          {ui.word}{why ? `: ${why}` : ''}
        </span>
      </span>
    </li>
  );
}

export default function GateMissing({ entries }: { entries: GateCardEntry[] }) {
  return (
    <div className="border-t border-border pt-2 flex flex-col gap-2">
      <h3 className="text-[11px] text-dim uppercase tracking-wide">Waiting on something else · {entries.length}</h3>
      {entries.map((e, n) => (
        <details key={e.line} open={n === 0} className="bg-bg/40 border border-border/60 rounded min-w-0 max-w-full">
          <summary className="cursor-pointer px-2 py-1.5 text-xs">
            <span className="text-orange">⛔ {e.label}</span>
            {e.gate && <span className="text-dim"> · {e.gate}</span>}
            <span className={`block ${TONE_CLS[e.verdict.tone]}`}>{e.verdict.text}</span>
          </summary>
          <ul className="px-2 pb-1.5 text-xs">
            {e.pieces.map(p => <PieceRow key={p.key} p={p} />)}
          </ul>
        </details>
      ))}
      <p className="text-[11px] text-dim">
        ✅ done · ⏳ kill credited, the Seer is holding it (say &quot;unlock memories&quot;) · ❌ missing · ❓ not recorded
        yet. A ? after a name means that piece is our best reading, not confirmed.
      </p>
    </div>
  );
}
