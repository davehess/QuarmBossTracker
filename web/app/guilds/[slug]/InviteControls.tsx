'use client';
// The two buttons of a guild's Invites section: "New invite code" and a "Revoke" beside each live code. The rules
// and the officer check are on the server (actions.ts); these only call it and show the answer.
import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { createInvite, revokeInvite, type InviteResult } from './actions';

export function NewInviteButton({ slug }: { slug: string }) {
  const [result, setResult] = useState<InviteResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <div>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await createInvite(slug); setResult(r); if (r.ok) router.refresh(); })}
        className="min-h-11 rounded border border-gold/70 px-4 text-sm text-gold hover:bg-gold/10 disabled:opacity-50"
      >
        {pending ? 'Making…' : 'New invite code'}
      </button>
      {result && <p role="status" className={`mt-2 text-xs ${result.ok ? 'text-green' : 'text-red'}`}>{result.message}</p>}
    </div>
  );
}

export function RevokeButton({ slug, code }: { slug: string; code: string }) {
  const [result, setResult] = useState<InviteResult | null>(null);
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <span>
      <button
        type="button"
        disabled={pending}
        onClick={() => start(async () => { const r = await revokeInvite(slug, code); setResult(r); if (r.ok) router.refresh(); })}
        className="min-h-11 rounded border border-border px-3 text-xs text-dim hover:border-red hover:text-red disabled:opacity-50"
      >
        {pending ? 'Revoking…' : 'Revoke'}
      </button>
      {result && !result.ok && <span role="status" className="ml-2 text-xs text-red">{result.message}</span>}
    </span>
  );
}
