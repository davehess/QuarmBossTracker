'use client';

// Tiny officer-only inline control to set a missing spell's scribe level (seed
// table). Appears next to spells whose level is still unknown. Optimistic:
// hides itself on success so the officer sees the row will regroup on next load.

import { useState, useTransition } from 'react';
import { setSpellLevel } from './actions';

export default function SpellLevelEditor(
  { spellId, character }: { spellId: number; character: string },
) {
  const [val, setVal] = useState('');
  const [pending, start] = useTransition();
  const [done, setDone] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  if (done) return <span className="text-green text-[10px]">✓ set — reload to regroup</span>;

  function save() {
    const lvl = parseInt(val, 10);
    if (!Number.isFinite(lvl)) { setErr('1–75'); return; }
    setErr(null);
    start(async () => {
      const res = await setSpellLevel(spellId, lvl, character);
      if (res.ok) setDone(true);
      else setErr(res.error ?? 'failed');
    });
  }

  return (
    <span className="inline-flex items-center gap-1">
      <input
        type="number" min={1} max={75} value={val}
        onChange={e => setVal(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); }}
        placeholder="lvl"
        disabled={pending}
        className="w-10 bg-bg border border-border rounded px-1 py-0 text-[10px] text-text"
        title="Officer: set this spell's scribe level (applies to everyone)"
      />
      <button type="button" onClick={save} disabled={pending || !val}
        className="text-[10px] text-blue hover:underline disabled:opacity-40">set</button>
      {err && <span className="text-[10px] text-red">{err}</span>}
    </span>
  );
}
