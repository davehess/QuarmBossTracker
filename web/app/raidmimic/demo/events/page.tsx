// raidmimic.com/demo/events: OPTION A of the event board, "Post an event, see who needs it" (the guild lead, 2026-11-02:
// "coordinating when events are and who needs them ... raid leaders post some of their events but we need to go
// one-by-one"). Calendar first: a leader posts the night, each event opens to the raiders it helps. The other option
// is /demo/events/needs (demand first). Static: the fixture is web/lib/demoGuild.ts, the "who needs it" answer is the
// real gate rules, and the buttons are styled boxes.
import type { Metadata } from 'next';
import { CHARS, EVENTS, TARGETS, needsFor, targetByKey, type DemoChar } from '@/lib/demoGuild';
import DemoShell, { DemoButton, PANEL, demoBase } from '../_parts/DemoShell';

export const metadata: Metadata = {
  title: { absolute: '[beta] Demo guild · Flag events' },
  description: 'Option A for coordinating flag events: a leader posts an event and sees which raiders still need it and who signed. Invented guild.',
  robots: { index: false, follow: false },
};

function Names({ chars, tone }: { chars: { name: string; cls?: string }[]; tone: string }) {
  if (chars.length === 0) return <p className="m-0 text-xs text-dim">Nobody.</p>;
  return (
    <ul className="m-0 flex list-none flex-wrap gap-1.5 p-0 text-xs">
      {chars.map(c => (
        <li key={c.name} className={`rounded border px-1.5 py-0.5 ${tone}`}>{c.name}{c.cls && <span className="text-[10px] text-dim"> {c.cls}</span>}</li>
      ))}
    </ul>
  );
}

export default function DemoEventsPage() {
  const BASE = demoBase();
  const byDay = ['Wed', 'Thu', 'Sun'];
  const sorted = [...EVENTS].sort((a, b) => byDay.indexOf(a.day) - byDay.indexOf(b.day));
  return (
    <DemoShell active="events" title="Flag events this week"
      lead="Option A · Post an event, see who needs it. Calendar first: the leader picks a target and a night, and each event lists the raiders it still helps.">
      <div className="flex flex-col gap-4">
        <section aria-labelledby="post-title" className={`${PANEL} flex flex-col gap-2`}>
          <h2 id="post-title" className="text-sm text-gold font-semibold">Post an event</h2>
          <div className="flex flex-wrap items-end gap-2 text-xs">
            <label className="flex flex-col gap-1 text-dim">Target
              <select defaultValue="saryrn" className="min-h-9 rounded border border-border bg-bg px-2 text-text">
                {TARGETS.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
              </select>
            </label>
            <label className="flex flex-col gap-1 text-dim">Night
              <select defaultValue="Thu" className="min-h-9 rounded border border-border bg-bg px-2 text-text">
                {['Wed', 'Thu', 'Sun'].map(d => <option key={d}>{d}</option>)}
              </select>
            </label>
            <DemoButton>Post event</DemoButton>
            <span className="pb-2 text-[11px] text-dim">demo: nothing is saved</span>
          </div>
          <p className="m-0 text-[11px] text-dim">The target comes from a list, so everyone says &quot;Tallon &amp; Vallon&quot; the same way and the page can tell who needs it.</p>
        </section>

        <section aria-label="Upcoming events" className="flex flex-col gap-2">
          {sorted.map((ev, i) => {
            const t = targetByKey(ev.target)!;
            const n = needsFor(t);
            const needNames = new Set(n.need.map(c => c.name));
            const signed = ev.signed.map(s => CHARS.find(c => c.name === s)).filter((c): c is DemoChar => !!c);
            const signedNeeding = signed.filter(c => needNames.has(c.name));
            const missing = n.need.filter(c => !ev.signed.includes(c.name));
            return (
              <details key={ev.id} open={i === 0} className={`${PANEL} group`}>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                  <span className="shrink-0 whitespace-nowrap rounded border border-border bg-bg px-2 py-1 text-center text-xs text-text">{ev.day} <span className="text-dim">{ev.time.replace(' ET', '')}</span></span>
                  <span className="min-w-0 flex-1 text-[#f2ede1]">{t.label}<span className="block text-[11px] text-dim">{t.blurb} · posted by {ev.by}</span></span>
                  <span className="text-xs text-orange">{n.need.length} need it</span>
                  <span className="text-xs text-dim">{ev.signed.length} signed</span>
                </summary>

                <div className="mt-3 grid gap-3 border-t border-border pt-3 sm:grid-cols-2">
                  <div className="flex flex-col gap-1.5">
                    <h3 className="m-0 text-[11px] uppercase tracking-wide text-dim">Still need it · {n.need.length}</h3>
                    <Names chars={n.need} tone="border-orange/50 text-text" />
                    {n.unsure.length > 0 && (
                      <>
                        <h3 className="m-0 mt-1 text-[11px] uppercase tracking-wide text-dim">Not recorded · {n.unsure.length}</h3>
                        <Names chars={n.unsure} tone="border-border text-dim" />
                        <p className="m-0 text-[11px] text-dim">No full read yet, so we do not guess. Ask them to paste the Seer&apos;s recital, or record it for them.</p>
                      </>
                    )}
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <h3 className="m-0 text-[11px] uppercase tracking-wide text-dim">Signed · {signed.length}</h3>
                    <Names chars={signed} tone="border-green/40 text-text" />
                    <p className="m-0 text-[11px] text-dim">
                      {signedNeeding.length} of them need it; {signed.length - signedNeeding.length} are coming to help.
                      {missing.length > 0 && <> {missing.length} who need it have not signed.</>}
                    </p>
                  </div>
                </div>

                {ev.note && <p className="mt-3 border-l-2 border-orange/60 pl-3 text-xs leading-5 text-dim">{ev.note}</p>}
                <div className="mt-3 flex flex-wrap items-center gap-3">
                  <DemoButton>Ping the {missing.length} who need it</DemoButton>
                  <span className="text-[11px] text-dim">demo: nothing is sent</span>
                </div>
              </details>
            );
          })}
        </section>

        <p className="text-xs text-dim">
          Prefer to start from what the guild is missing? That is <a href={`${BASE}/events/needs`}className="text-blue hover:underline">option B, the needs board</a>.
          Counts here include flags recorded for someone else, shown as reported on <a href={`${BASE}/flags#reported`}className="text-blue hover:underline">the flags page</a>.
        </p>
      </div>
    </DemoShell>
  );
}
