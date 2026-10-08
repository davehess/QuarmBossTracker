'use client';

// The "It was a /quit" / "Undo /quit" link on the /fun LD card. Rendered only for
// the character's player and officers; setLdQuit checks again on the server.

import { useState, useTransition } from 'react';
import { setLdQuit } from './actions';

export default function QuitButton({ ts, undo = false }: { ts: string; undo?: boolean }) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  return (
    <>
      <button
        type="button"
        disabled={pending}
        onClick={() => startTransition(async () => {
          const r = await setLdQuit(!undo, ts);
          setError(r.ok ? null : (r.error ?? 'Failed.'));
        })}
        className="inline-block py-1 text-purple underline hover:text-text disabled:opacity-50"
        title={undo
          ? 'Count that LD again.'
          : 'Logging out with /quit drops the connection like a crash. Mark it so it does not reset the counter.'}
      >
        {undo ? 'Undo /quit' : 'It was a /quit'}
      </button>
      {error && <span className="text-red"> {error}</span>}
    </>
  );
}
