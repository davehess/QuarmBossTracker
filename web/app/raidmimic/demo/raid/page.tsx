// raidmimic.com/demo/raid: tonight's raid plan. The raiders who signed, against every flag the night's pull needs, so a
// leader sees who to fix before they pull. Same icons and gate rules as the flags page. Static, like the rest of the demo.
import type { Metadata } from 'next';
import { CHARS, EVENTS, TONIGHT, reportFor, tonightRows } from '@/lib/demoGuild';
import PieceMatrix from '../_parts/PieceMatrix';
import DemoShell, { PANEL } from '../_parts/DemoShell';

export const metadata: Metadata = {
  title: { absolute: '[beta] Demo guild · Tonight’s raid' },
  description: 'A demo raid night: who signed and which flags each raider still needs before the pull, so the leader can fix it first. Invented guild.',
  robots: { index: false, follow: false },
};

export default function DemoRaidPage() {
  const ev = EVENTS.find(e => e.id === TONIGHT.eventId)!;
  const rows = tonightRows();
  const heads = rows[0].pieces;
  // One header group per gate, as wide as the gate's pieces.
  const sample = CHARS[0];
  const groups = TONIGHT.gates.map(g => {
    const r = reportFor(sample, g, 'planning');
    return { label: r.name, span: r.pieces.length };
  });
  const ready = rows.filter(r => r.ready).length;
  const fix = rows.filter(r => r.fix.length > 0).length;
  const unsure = rows.filter(r => r.fix.length === 0 && r.unsure).length;
  const order = (r: (typeof rows)[number]) => (r.fix.length > 0 ? 0 : r.unsure ? 1 : 2);
  const sorted = [...rows].sort((a, b) => order(a) - order(b));

  return (
    <DemoShell active="raid" title={`Tonight: ${TONIGHT.title}`}
      lead={`${ev.day} ${ev.time}, posted by ${ev.by}. Everyone who signed, against the flags the pull needs. Fix the red ones first.`}>
      <div className="flex flex-col gap-4">
        <div className="grid gap-2 sm:grid-cols-3">
          <div className={PANEL}><p className="m-0 text-2xl text-green">{ready}</p><p className="m-0 text-xs text-dim">of {rows.length} ready to pull</p></div>
          <div className={PANEL}><p className="m-0 text-2xl text-red">{fix}</p><p className="m-0 text-xs text-dim">missing a flag: fix before the pull</p></div>
          <div className={PANEL}><p className="m-0 text-2xl text-dim">{unsure}</p><p className="m-0 text-xs text-dim">not recorded: ask for the Seer&apos;s recital</p></div>
        </div>

        <section aria-labelledby="plan-title" className={`${PANEL} flex flex-col gap-2`}>
          <h2 id="plan-title" className="text-sm text-gold font-semibold">Who is ready, who needs fixing</h2>
          <PieceMatrix
            heads={heads}
            groups={groups}
            lastHead="Before the pull"
            rows={sorted.map(r => ({
              name: r.name, sub: r.cls,
              cells: r.pieces.map(piece => ({ piece })),
              last: r.fix.length > 0 ? `Fix: ${r.fix.join(', ')}` : r.unsure ? 'Not recorded: ask them to paste the Seer’s recital' : 'Ready',
              lastCls: r.fix.length > 0 ? 'text-red' : r.unsure ? 'text-dim' : 'text-green',
            }))}
          />
          <p className="text-[11px] text-dim">
            ✅ done · ❌ missing (they have had a full read) · ❓ not recorded. Flags a raid leader recorded for someone else count
            as done; the owner confirms them later.
          </p>
        </section>
      </div>
    </DemoShell>
  );
}
