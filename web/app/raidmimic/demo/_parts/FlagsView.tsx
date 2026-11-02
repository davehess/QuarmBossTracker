// The demo's flags page for one gate: the REAL GateTable (app/pop/guide/GateTable.tsx, unchanged) fed with the invented
// guild, and under it a sibling table for the new feature: flags a raid leader recorded for someone else's character,
// shown ✅ "reported" until the owner confirms. GateTable draws what owners confirmed; the reports sit beside it so the
// rule is visible: a report can add a ✅, it never makes a ❌ (a character with no full read of their own stays ❓).
import GateTable from '@/app/pop/guide/GateTable';
import { TONE_CLS } from '@/app/pop/guide/GateMissing';
import { DEMO_DEFAULT_GATE, GATE_CHOICES, gateRows, reportedRows } from '@/lib/demoGuild';
import PieceMatrix from './PieceMatrix';
import DemoShell, { PANEL, demoBase } from './DemoShell';

export default function FlagsView({ gateKey }: { gateKey: string }) {
  const BASE = demoBase();
  const flagsHref = (key: string) => (key === DEMO_DEFAULT_GATE ? `${BASE}/flags` : `${BASE}/flags/${key}`);
  const rows = gateRows(gateKey, 'confirmed');
  const reported = reportedRows(gateKey);
  const gate = GATE_CHOICES.find(g => g.key === gateKey) ?? GATE_CHOICES[0];
  return (
    <DemoShell active="flags" title="Planes of Power progress, the whole guild"
      lead="Every raider against one gate, piece by piece. Pick a gate to see who is missing what, so a leader schedules the right night.">
      <div className="flex flex-col gap-4">
        <GateTable gates={GATE_CHOICES} selected={gateKey} rows={rows} hrefFor={flagsHref} singleHref={`${BASE}/capture`} />

        <section id="reported" aria-labelledby="reported-title" className={`${PANEL} flex flex-col gap-2`}>
          <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
            <h2 id="reported-title" className="text-sm text-gold font-semibold">Reported by someone else, waiting for the owner · {gate.short}</h2>
            <a href={`${BASE}/capture`} className="ml-auto text-xs text-blue hover:underline">how a leader records these →</a>
          </div>
          <p className="text-xs leading-5 text-dim">
            A raid leader can record flags for a character that is not theirs. Those show here as <span className="text-green">✅</span>{' '}
            <span className="text-gold">reported</span>, and they count when a leader plans a night. They never show a{' '}
            <span className="text-red">❌</span>: only the owner&apos;s own read can say a flag is missing. The owner signs in with
            Discord, then confirms the report or corrects it.
          </p>
          {reported.length === 0 ? (
            <p className="text-sm text-dim">Nothing is waiting for an owner.</p>
          ) : (
            <PieceMatrix
              heads={reported[0].cells.map(c => c.piece)}
              lastHead="Reported by"
              rows={reported.map(r => ({
                name: r.name, sub: r.cls, cells: r.cells,
                last: <>{r.by}<span className="block text-[10px] text-dim">{r.when}</span><span className={`block ${TONE_CLS[r.verdict.tone]}`}>{r.verdict.text}</span></>,
              }))}
            />
          )}
        </section>
      </div>
    </DemoShell>
  );
}
