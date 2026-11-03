'use client';

// Officer-only "Set class" control beside the Class line. Prominent when the class is unknown, a quiet "change"
// link when it is known. The server action re-checks the officer role.

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { setCharacterClass } from './actions';
import { EQ_CLASSES, EQ_RACES } from '@/lib/characterClass';

export default function ClassSetter(
  { character, currentClass, currentRace, unknown, suggestion }: {
    character: string; currentClass: string | null; currentRace: string | null; unknown: boolean;
    suggestion: { cls: string; count: number } | null;
  },
) {
  const router = useRouter();
  const [open, setOpen] = useState(unknown);
  const [cls, setCls] = useState(suggestion?.cls ?? (unknown ? '' : currentClass ?? ''));
  const [race, setRace] = useState('');
  const [pending, start] = useTransition();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[11px] text-blue hover:underline">change</button>
    );
  }

  function save() {
    setMsg(null);
    start(async () => {
      const res = await setCharacterClass(character, cls, race);
      if (res.ok) { setMsg({ ok: true, text: res.message ?? 'Saved.' }); router.refresh(); }
      else setMsg({ ok: false, text: res.error ?? 'failed' });
    });
  }

  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <select value={cls} onChange={e => setCls(e.target.value)} disabled={pending}
        aria-label="Class" className="bg-bg border border-border rounded px-1 py-0.5 text-xs text-text">
        <option value="">Set class…</option>
        {EQ_CLASSES.map(c => <option key={c} value={c}>{c}</option>)}
      </select>
      <select value={race} onChange={e => setRace(e.target.value)} disabled={pending}
        aria-label="Race" className="bg-bg border border-border rounded px-1 py-0.5 text-xs text-text">
        <option value="">Race unchanged{currentRace ? ` (${currentRace})` : ''}</option>
        {EQ_RACES.map(r => <option key={r} value={r}>{r}</option>)}
      </select>
      <button type="button" onClick={save} disabled={pending || !cls}
        className="text-xs px-2 py-0.5 rounded border border-border text-text hover:border-blue disabled:opacity-50">
        {pending ? 'Saving…' : 'Save'}
      </button>
      {suggestion && (
        <span className="text-[11px] text-dim">
          /who has seen this character as {suggestion.cls} {suggestion.count} {suggestion.count === 1 ? 'time' : 'times'}
        </span>
      )}
      {msg && <span className={`text-[11px] ${msg.ok ? 'text-green' : 'text-red'}`}>{msg.text}</span>}
    </span>
  );
}
