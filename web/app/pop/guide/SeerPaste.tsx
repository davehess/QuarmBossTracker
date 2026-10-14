'use client';

// "Paste what the Seer says" at the top of the PoP checklist (the guild lead, 2026-10-14: "reverse engineer this so
// that peoples flags can just copy what the seer says and fix their flags and get next steps"; then: put it at the
// top of the guide, collapsed, and let the next steps tick or highlight the guide's own steps).
//
// The paste is read in the browser (web/lib/popRecital.ts), so nothing leaves the page until Save, and Save sends
// only the sentences that matched, to saveSeerRecital (actions.ts), which reads them again and checks the
// character is yours. The result goes up to the checklist (onResult): the steps the recital proves tick there
// with their own badge, and the next step of each open plane is ringed. Switching character clears it.

import { useEffect, useMemo, useState, useTransition } from 'react';
import { GUIDE_ITEMS, mapCommand } from '@/lib/popGuide';
import { TIER_LABELS } from '@/lib/popFlags';
import { heldClosure, parseRecital, zoneViews, type Parsed } from '@/lib/popRecital';
import { guideStepFor, guideStepsProven } from '@/lib/popGuideSeer';
import CopyChip from '@/components/CopyChip';
import { saveSeerRecital } from './actions';

export type SeerResult = { proven: ReadonlySet<string>; next: ReadonlySet<string> };
export const FOCUS_EVENT = 'wp-guide-focus';

/** The checklist side of "show in checklist": scroll to the step's row (`before` first opens whatever hides it). */
export function useFocusStep(idPrefix: string, before?: (key: string) => void) {
  useEffect(() => {
    const on = (e: Event) => {
      const key = String((e as CustomEvent).detail ?? '');
      before?.(key);
      requestAnimationFrame(() => requestAnimationFrame(() => {
        document.getElementById(idPrefix + key)?.closest('li')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      }));
    };
    window.addEventListener(FOCUS_EVENT, on);
    return () => window.removeEventListener(FOCUS_EVENT, on);
  }, [idPrefix, before]);
}

const SEER = GUIDE_ITEMS.find(i => i.key === 'start_flag_fixers')?.where?.find(l => l.npc.startsWith('Seer'));

export default function SeerPaste({ character, onResult }: { character: string | null; onResult: (r: SeerResult | null) => void }) {
  const [text, setText] = useState('');
  const [parsed, setParsed] = useState<Parsed | null>(null);
  const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saving, startSave] = useTransition();

  const held = useMemo(() => (parsed ? heldClosure(parsed.stages) : null), [parsed]);
  const views = useMemo(() => (held ? zoneViews(held) : []), [held]);
  const result = useMemo<SeerResult | null>(() => {
    if (!held || !parsed || parsed.stages.length === 0) return null;
    const proven = guideStepsProven(held);
    const next = new Set<string>();
    for (const v of views) {
      if (!v.open) continue;
      const first = v.todo.map(s => guideStepFor(s.key)).find((k): k is string => !!k && !proven.has(k));
      if (first) next.add(first);
    }
    return { proven, next };
  }, [held, parsed, views]);

  useEffect(() => { onResult(result); }, [result, onResult]);
  // A paste is for one character: pick another and it is cleared, so its ticks never land on the wrong one.
  useEffect(() => { setParsed(null); setStatus(null); }, [character]);

  function check() {
    setStatus(null);
    setParsed(parseRecital(text));
  }
  function save() {
    if (!character || !parsed) return;
    const sentences = parsed.matched.map(m => m.text);
    startSave(async () => {
      const res = await saveSeerRecital(character, sentences);
      if (!res.ok) { setStatus({ ok: false, msg: res.error }); return; }
      setStatus({
        ok: true,
        msg: res.written > 0
          ? `Saved ${res.written} flag${res.written === 1 ? '' : 's'} for ${character}${res.already ? ` (${res.already} were already saved)` : ''}.`
          : `Nothing new: all ${res.already} are already saved for ${character}.`,
      });
    });
  }
  function show(stageKey: string) {
    const key = guideStepFor(stageKey);
    if (key) window.dispatchEvent(new CustomEvent(FOCUS_EVENT, { detail: key }));
  }

  const open = views.filter(v => v.open && v.todo.length > 0);
  const waiting = views.filter(v => !v.open && v.todo.length > 0);
  const doneCount = views.reduce((n, v) => n + v.done.length, 0);

  return (
    <details className="bg-panel border border-border rounded-lg group">
      <summary className="cursor-pointer select-none p-3 text-sm text-text flex flex-wrap items-baseline gap-x-2">
        <span className="font-semibold">Paste what the Seer says</span>
        <span className="text-xs text-dim">Fix your flags and see what is next. Read here in your browser; nothing is kept unless you save.</span>
      </summary>
      <div className="p-3 pt-0 flex flex-col gap-3 text-sm">
        <ol className="text-xs text-dim list-decimal pl-5 space-y-1">
          <li>
            Find Seer Mal Nae`Shi in the Plane of Knowledge{SEER ? <> (next to the Plane of Tranquility book) </> : ' '}
            {SEER && <CopyChip text={mapCommand(SEER)} />}
          </li>
          <li>Sit and target her: <CopyChip text="/sit" /> then <CopyChip text="/target Seer" /></li>
          <li>Say <CopyChip text="/say guided meditation" />. She tells you one line for every flag you hold.</li>
          <li>Copy those lines from your chat window or your EQ log (with or without the time at the front) and paste them here.</li>
        </ol>
        <label className="flex flex-col gap-1">
          <span className="sr-only">What the Seer said</span>
          <textarea value={text} onChange={e => setText(e.target.value)} rows={6} maxLength={60000}
                    placeholder="[Tue Oct 14 20:11:02 2026] The evidence of Mavuin is the only thing that can save him now."
                    className="w-full bg-bg border border-border rounded p-2 text-text font-mono text-xs focus:outline focus:outline-2 focus:outline-blue" />
        </label>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={check} disabled={!text.trim()}
                  className="px-3 py-1.5 rounded border border-gold text-gold hover:bg-gold/10 disabled:opacity-40 disabled:cursor-default">
            Check my flags
          </button>
          {parsed && parsed.stages.length > 0 && (
            <>
              <button type="button" onClick={save} disabled={!character || saving}
                      className="px-3 py-1.5 rounded border border-green text-green hover:bg-green/10 disabled:opacity-40 disabled:cursor-default">
                {saving ? 'Saving…' : character ? `Save to ${character}` : 'Pick a character first'}
              </button>
              <span className="text-xs text-dim">Saves for the character picked below. Your own characters only.</span>
            </>
          )}
        </div>
        {status && <p role="status" className={`text-xs ${status.ok ? 'text-green' : 'text-red'}`}>{status.msg}</p>}

        {parsed && (
          <div className="flex flex-col gap-3" aria-live="polite">
            {parsed.stages.length === 0 ? (
              <p className="text-orange text-xs">
                No Seer sentence in that ({parsed.lines} line{parsed.lines === 1 ? '' : 's'} read). Make sure you sat down first, then say
                {' '}&ldquo;guided meditation&rdquo; and paste her lines. If she only said she recovers images from your childhood,
                there is nothing to read yet.
              </p>
            ) : (
              <p className="text-xs text-dim">
                Read {parsed.lines} line{parsed.lines === 1 ? '' : 's'}: <b className="text-text">{parsed.stages.length}</b> Seer
                sentence{parsed.stages.length === 1 ? '' : 's'}, <b className="text-text">{doneCount}</b> steps shown as done below. Steps she
                proves tick in the checklist; the next step of each open plane is ringed.
              </p>
            )}

            {open.length > 0 && (
              <section>
                <h3 className="text-xs uppercase tracking-wide text-dim mb-1">Next steps</h3>
                <ul className="flex flex-col gap-2">
                  {open.map(v => (
                    <li key={v.zone.key} className="rounded border border-border p-2">
                      <div className="text-xs">
                        <span className="text-text font-semibold">{v.zone.name}</span>
                        <span className="text-dim"> · {TIER_LABELS[v.zone.tier].name}</span>
                      </div>
                      <ol className="mt-1 space-y-1">
                        {v.todo.map((s, n) => (
                          <li key={s.key} className="text-xs flex flex-wrap items-baseline gap-x-2">
                            <span className={n === 0 ? 'text-gold' : 'text-dim'}>{n === 0 ? '▶' : '·'}</span>
                            <span className={n === 0 ? 'text-text' : 'text-dim'}>
                              {s.label}{s.where ? ` (${s.where})` : ''}
                            </span>
                            {s.note && <span className="text-dim">{s.note}</span>}
                            {guideStepFor(s.key) && (
                              <button type="button" onClick={() => show(s.key)} className="text-blue hover:underline">show in checklist</button>
                            )}
                          </li>
                        ))}
                      </ol>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {waiting.length > 0 && (
              <section>
                <h3 className="text-xs uppercase tracking-wide text-dim mb-1">Later: planes still closed to you</h3>
                <ul className="text-xs space-y-0.5">
                  {waiting.map(v => (
                    <li key={v.zone.key}>
                      <span className="text-text">{v.zone.name}</span>
                      <span className="text-dim"> needs {v.missing.join(', ')}</span>
                    </li>
                  ))}
                </ul>
              </section>
            )}

            {parsed.stages.length > 0 && open.length === 0 && waiting.length === 0 && (
              <p className="text-xs text-green">Everything the Seer can show is done.</p>
            )}

            {doneCount > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-dim">What the Seer says you have ({doneCount})</summary>
                <ul className="mt-1 space-y-1">
                  {views.filter(v => v.done.length > 0).map(v => (
                    <li key={v.zone.key}>
                      <span className="text-text">{v.zone.short}</span>
                      <span className="text-dim">: {v.done.map(s => s.label).join('; ')}</span>
                    </li>
                  ))}
                </ul>
              </details>
            )}

            {parsed.unknown.length > 0 && (
              <details className="text-xs">
                <summary className="cursor-pointer text-dim">Lines we did not recognise ({parsed.unknown.length})</summary>
                <p className="text-dim mt-1">
                  Lines from &ldquo;unlock memories&rdquo; are not read here; say &ldquo;guided meditation&rdquo; again afterwards and paste that.
                  Anything else might be a sentence we do not know yet:{' '}
                  <a href="/feedback" className="text-blue hover:underline">tell us on feedback</a> and paste it.
                </p>
                <ul className="mt-1 space-y-0.5 font-mono text-[11px] text-dim break-words">
                  {parsed.unknown.map(l => <li key={l}>{l}</li>)}
                </ul>
              </details>
            )}
          </div>
        )}
      </div>
    </details>
  );
}
