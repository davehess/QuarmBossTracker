// One-click "Enable Tells on every character I own" / "Disable on all" control.
// Calls the bulkSetCharacterFlag server action. Shows the live opted-in/total
// count so a user with 51 alts can flip them all in a single click instead of
// toggling each one on /me.
'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { bulkSetCharacterFlag } from '../actions';

export default function BulkTellsToggle({ optedIn, total }: { optedIn: number; total: number }) {
  const [pending, startTransition] = useTransition();
  const [msg, setMsg]   = useState<string | null>(null);
  const [err, setErr]   = useState<string | null>(null);
  const router          = useRouter();
  const allOn   = total > 0 && optedIn === total;
  const noneOn  = optedIn === 0;

  function run(value: boolean) {
    setMsg(null); setErr(null);
    startTransition(async () => {
      const r = await bulkSetCharacterFlag('tell_relay', value);
      if (!r.ok) { setErr(r.error || 'failed'); return; }
      setMsg(r.changed === 0
        ? `Already ${value ? 'on' : 'off'} for all ${r.total ?? total} characters.`
        : `${value ? 'Enabled' : 'Disabled'} on ${r.changed} character${r.changed === 1 ? '' : 's'}.`);
      router.refresh();
    });
  }

  return (
    <div className="flex items-center gap-2 flex-wrap text-xs">
      <span className="text-dim">
        Opted in: <span className="text-text">{optedIn}</span> of <span className="text-text">{total}</span>
      </span>
      {!allOn && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(true)}
          className="border border-green/40 text-green rounded px-3 py-1 hover:bg-green/10 disabled:opacity-50"
        >
          {pending ? 'Enabling…' : `Enable on all ${total} character${total === 1 ? '' : 's'}`}
        </button>
      )}
      {!noneOn && (
        <button
          type="button"
          disabled={pending}
          onClick={() => run(false)}
          className="border border-border text-dim rounded px-3 py-1 hover:text-text disabled:opacity-50"
        >
          {pending ? 'Disabling…' : 'Disable on all'}
        </button>
      )}
      {msg && <span className="text-green">{msg}</span>}
      {err && <span className="text-red">Error: {err}</span>}
    </div>
  );
}
