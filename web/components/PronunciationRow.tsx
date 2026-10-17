'use client';

// One character's "how is this name said" row, shared by /me/voice (your own characters) and
// /admin/pronunciations (any character, for officers). The page hands in the save and clear server actions, so
// this file knows nothing about who is allowed: the action asks again on the server.
//
// ▶ speaks the typed text with the BROWSER's voice (speechSynthesis). Mimic uses the Windows voice or its
// downloaded one, so the preview is a close guide, not a recording of what raid night will sound like.
// Suggestions come from the same pure helpers the bot uses (web/lib/pronounce.ts), so a click fills the box.

import { useState, useTransition } from 'react';
import { coachingTips, speakText, suggestPronunciations } from '@/lib/pronounce';
import type { Result } from '@/lib/pronunciations';

// UTC so the server render and the browser agree on the day.
const fmtDay = (iso: string | null) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' }) : '';

export type RowProps = {
  name: string;
  initialSay: string | null;
  save: (character: string, say: string) => Promise<Result>;
  clear: (character: string) => Promise<Result>;
  /** Admin list only: who set it and when (shown under the name). */
  meta?: { setBy: string | null; updatedAt: string | null };
  /** Called after a good save (say) or clear (null), so a list can add or drop the row. */
  onChange?: (say: string | null, updatedAt: string | null) => void;
};

function speak(text: string): boolean {
  if (typeof window === 'undefined' || !('speechSynthesis' in window)) return false;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
  return true;
}

export default function PronunciationRow({ name, initialSay, save, clear, meta, onChange }: RowProps) {
  const [say, setSay] = useState<string | null>(initialSay);
  const [draft, setDraft] = useState(initialSay ?? '');
  const [info, setInfo] = useState(meta ?? null);
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const dirty = draft.trim().replace(/\s+/g, ' ') !== (say ?? '');

  const hear = () => {
    // Nothing typed yet: say the name as it is spelled, which is what Mimic does today.
    if (!speak(speakText(draft.trim() || name))) setMsg('This browser cannot speak out loud.');
  };

  const doSave = () => startTransition(async () => {
    const r = await save(name, draft);
    if (r.ok) {
      const next = r.say ?? null;
      setSay(next); setDraft(next ?? ''); setMsg('Saved.');
      if (info) setInfo({ setBy: 'you', updatedAt: r.updatedAt ?? null });
      onChange?.(next, r.updatedAt ?? null);
    } else setMsg(r.error ?? 'could not save');
  });

  const doClear = () => startTransition(async () => {
    const r = await clear(name);
    if (r.ok) {
      setSay(null); setDraft(''); setMsg('Cleared. It is said as spelled again.');
      if (info) setInfo({ setBy: null, updatedAt: null });
      onChange?.(null, null);
    } else setMsg(r.error ?? 'could not clear');
  });

  const btn = 'rounded border border-border bg-panel px-2.5 py-1 text-xs text-text hover:border-blue disabled:opacity-40 disabled:hover:border-border';

  return (
    <li className="rounded border border-border bg-bg p-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <div className="w-40 shrink-0">
          <div className="text-text">{name}</div>
          <div className="text-xs text-dim">{say ? <>said as <span className="text-gold">{say}</span></> : 'said as spelled'}</div>
        </div>
        <input
          value={draft}
          onChange={e => { setDraft(e.target.value); setMsg(null); }}
          onKeyDown={e => { if (e.key === 'Enter' && dirty && draft.trim()) doSave(); }}
          maxLength={60}
          placeholder="how it sounds, like AL-den-mar"
          aria-label={`How ${name} is said`}
          className="min-w-[10rem] flex-1 rounded border border-border bg-panel px-2 py-1 text-sm text-text placeholder:text-dim"
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={hear} className={btn} aria-label={`Hear ${name}`} title="Hear it">▶ Hear</button>
          <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open} className={btn}>Suggestions</button>
          <button type="button" onClick={doSave} disabled={pending || !dirty || !draft.trim()} className={`${btn} border-blue text-blue`}>Save</button>
          <button type="button" onClick={doClear} disabled={pending || !say} className={btn}>Clear</button>
        </div>
      </div>
      {info && (
        <div className="mt-1 text-xs text-dim">
          {say ? <>set by {info.setBy ?? 'someone'}{info.updatedAt ? <> on {fmtDay(info.updatedAt)}</> : null}</> : 'nothing saved yet'}
        </div>
      )}
      {open && (
        <div className="mt-2 space-y-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-dim">Try one:</span>
            {suggestPronunciations(name).map(s => (
              <button key={s} type="button" onClick={() => { setDraft(s); setMsg(null); }} className={`${btn} font-mono`}>{s}</button>
            ))}
          </div>
          <ul className="list-disc space-y-0.5 pl-5 text-dim">
            {coachingTips(name).map(t => <li key={t}>{t}</li>)}
          </ul>
        </div>
      )}
      <div role="status" aria-live="polite" className="mt-1 min-h-[1rem] text-xs text-orange">{msg}</div>
    </li>
  );
}
