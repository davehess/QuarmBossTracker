'use client';
// The "Join a guild" card's form: one box for the six-character invite code. The rules and the rate limit are on the
// server (actions.ts); this only sends the code and shows the answer.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { redeemInvite, type JoinResult } from './actions';

export default function JoinForm() {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<JoinResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();

  function submit(e: React.FormEvent) {
    e.preventDefault();
    start(async () => {
      const r = await redeemInvite(code);
      setResult(r);
      if (r.ok) { setCode(''); router.refresh(); }
    });
  }

  return (
    <form onSubmit={submit} className="mt-3 space-y-2">
      <label htmlFor="invite-code" className="block text-xs text-dim">Invite code</label>
      <div className="flex gap-2">
        <input
          id="invite-code"
          value={code}
          onChange={e => setCode(e.target.value.toUpperCase())}
          maxLength={9}
          autoComplete="off"
          spellCheck={false}
          placeholder="K7M2QP"
          className="min-h-11 w-32 rounded border border-border bg-bg px-3 font-mono text-sm uppercase tracking-widest text-text"
        />
        <button
          type="submit"
          disabled={pending || code.trim() === ''}
          className="min-h-11 rounded border border-gold/70 px-4 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
        >
          {pending ? 'Joining…' : 'Join'}
        </button>
      </div>
      {result && <p role="status" className={`text-xs ${result.ok ? 'text-green' : 'text-red'}`}>{result.message}</p>}
    </form>
  );
}
