// raidmimic.com/demo/capture: "record flags for someone else", as a walk-through. The canned paste is read by
// the real Seer-recital reader (web/lib/popRecital.ts parseRecital, pure), so the list under it is what the product would
// find. The buttons are styled boxes: nothing in the demo saves, sends or signs anyone in.
import type { Metadata } from 'next';
import { CAPTURE, charByName } from '@/lib/demoGuild';
import { POP_STEPS } from '@/lib/popSteps';
import { POP_FLAGS } from '@/lib/popFlags';
import { parseRecital } from '@/lib/popRecital';
import DemoShell, { DemoButton, PANEL, demoBase } from '../_parts/DemoShell';

export const metadata: Metadata = {
  title: { absolute: '[beta] Demo guild · Record flags for someone else' },
  description: 'How a raid leader records flags for a character that is not theirs, and how the owner signs in to confirm or correct them. Invented guild.',
  robots: { index: false, follow: false },
};

const STEP_LABEL: Record<string, string> = Object.fromEntries(Object.values(POP_STEPS).flat().map(s => [s.key, s.label]));
const labelOf = (stage: string) => STEP_LABEL[stage] ?? POP_FLAGS[stage]?.label ?? stage;

export default function DemoCapturePage() {
  const BASE = demoBase();
  const found = parseRecital(CAPTURE.paste).matched;
  const subject = charByName(CAPTURE.subject);
  return (
    <DemoShell active="capture" title="Record flags for someone else"
      lead="A leader who has watched a raider's flags can record them in a minute, instead of waiting for that raider to paste their own. The raider confirms later.">
      <div className="flex flex-col gap-4">
        <section aria-labelledby="leader-title" className={`${PANEL} flex flex-col gap-3`}>
          <h2 id="leader-title" className="text-sm text-gold font-semibold">1 · The raid leader ({CAPTURE.leader}) records flags for {CAPTURE.subject}</h2>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span className="text-dim">Character</span>
            <span className="rounded border border-border bg-bg px-2 py-1 text-text">{CAPTURE.subject} <span className="text-dim">· {subject?.cls}</span></span>
            <span className="text-dim">not yours: this will be a report</span>
          </div>
          <div>
            <p className="mb-1 text-[11px] text-dim">Paste the Seer&apos;s recital or a #popflags read</p>
            <pre className="m-0 overflow-x-auto rounded border border-border bg-bg p-2 text-[11px] leading-5 text-text">{CAPTURE.paste}</pre>
          </div>

          <div>
            <p className="mb-1 text-[11px] text-dim">What we read · {found.length} flags</p>
            <ul className="m-0 list-none divide-y divide-border rounded border border-border bg-bg p-0 text-xs">
              {found.map(m => (
                <li key={m.stage} className="flex items-start gap-2 px-2 py-1.5">
                  <span aria-hidden className="text-green">✅</span>
                  <span className="min-w-0 flex-1 text-text">{labelOf(m.stage)}</span>
                  <span className="shrink-0 rounded border border-gold/60 px-1 text-[10px] text-gold">will be reported</span>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <DemoButton>Save as reported for {CAPTURE.subject}</DemoButton>
            <span className="text-[11px] text-dim">demo: nothing is saved</span>
          </div>
          <p className="border-l-2 border-orange/60 pl-3 text-xs leading-5 text-dim">
            A report can add a flag. It never removes one and never marks anything missing: only {CAPTURE.subject}&apos;s own read
            can say that. Until then the flags show as <span className="text-green">✅</span> <span className="text-gold">reported</span> and
            count when you plan a night.
          </p>
        </section>

        <section aria-labelledby="owner-title" className={`${PANEL} flex flex-col gap-3`}>
          <h2 id="owner-title" className="text-sm text-gold font-semibold">2 · The owner ({CAPTURE.subject}) signs in with Discord and sees</h2>
          <div className="rounded-md border border-gold/70 bg-bg p-3">
            <p className="m-0 text-sm text-[#f2ede1]">
              {found.length} flags were reported for your character <b>{CAPTURE.subject}</b> by <b>{CAPTURE.leader}</b>
            </p>
            <ul className="m-0 mt-2 list-none space-y-1 p-0 text-xs text-text">
              {found.map(m => (
                <li key={m.stage} className="flex gap-2"><span aria-hidden className="text-green">✅</span><span>{labelOf(m.stage)}</span></li>
              ))}
            </ul>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <DemoButton>Confirm</DemoButton>
              <DemoButton quiet>Correct</DemoButton>
              <span className="text-[11px] text-dim">demo: nothing is saved</span>
            </div>
          </div>
          <ul className="m-0 list-disc space-y-1 pl-5 text-xs leading-5 text-dim marker:text-dim">
            <li><b className="text-text">Confirm</b> turns every reported flag into the owner&apos;s own, and the tag goes away.</li>
            <li><b className="text-text">Correct</b> lets the owner paste their own recital; what it says wins, and the report is dropped.</li>
            <li>Only the owner can change their own flags. A leader cannot overwrite what a character confirmed.</li>
          </ul>
        </section>

        <p className="text-xs text-dim">
          See the result in <a href={`${BASE}/flags#reported`} className="text-blue hover:underline">the guild&apos;s flags table</a> and
          in <a href={`${BASE}/events`} className="text-blue hover:underline">the event boards</a>.
        </p>
      </div>
    </DemoShell>
  );
}
