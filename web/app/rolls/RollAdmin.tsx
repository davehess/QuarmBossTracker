'use client';

// Per-row officer controls on /rolls. Follows the /admin/triggers pattern from
// CLAUDE.md: optimistic useState + useTransition, server actions in actions.ts,
// and NO router.refresh() — revalidatePath keeps other sessions fresh without
// re-rendering (and visually flashing) the whole night's table.

import { useState, useTransition } from 'react';
import { setRollItem, setRollHidden } from './actions';

type Props = {
  from: number;
  to: number;
  startedAt: string;
  item: string | null;
  hidden: boolean;
};

export default function RollAdmin({ from, to, startedAt, item, hidden }: Props) {
  const key = { from, to, startedAt };
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item ?? '');
  const [isHidden, setHidden] = useState(hidden);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();

  function save() {
    const next = draft.trim();
    setEditing(false);
    start(async () => {
      const r = await setRollItem(key, next);
      if (!r.ok) setErr(r.error);
    });
  }

  function toggleHidden() {
    const next = !isHidden;
    setHidden(next);                       // optimistic
    start(async () => {
      const r = await setRollHidden(key, next);
      if (!r.ok) { setHidden(!next); setErr(r.error); }   // roll back on failure
    });
  }

  return (
    <span className="ml-2 inline-flex items-center gap-1.5 align-middle">
      {editing ? (
        <>
          <input
            autoFocus
            value={draft}
            onChange={e => setDraft(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') save();
              if (e.key === 'Escape') { setDraft(item ?? ''); setEditing(false); }
            }}
            placeholder="item name"
            className="bg-bg border border-border rounded px-1.5 py-0.5 text-xs w-48 text-text"
          />
          <button onClick={save} className="text-[11px] text-accent hover:underline">save</button>
          <button
            onClick={() => { setDraft(item ?? ''); setEditing(false); }}
            className="text-[11px] text-dim hover:underline"
          >cancel</button>
        </>
      ) : (
        <>
          <button
            onClick={() => setEditing(true)}
            disabled={pending}
            className="text-[11px] text-dim hover:text-accent hover:underline disabled:opacity-50"
            title="Name or rename this roll"
          >edit</button>
          <button
            onClick={toggleHidden}
            disabled={pending}
            className="text-[11px] text-dim hover:text-accent hover:underline disabled:opacity-50"
            title={isHidden ? 'Show this roll to everyone again' : 'Hide this roll — misfires, test rolls'}
          >{isHidden ? 'unhide' : 'hide'}</button>
        </>
      )}
      {err && <span className="text-[11px] text-red-400" title={err}>failed</span>}
    </span>
  );
}
