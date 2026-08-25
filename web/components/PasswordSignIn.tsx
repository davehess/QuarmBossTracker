'use client';
// The alternative below "Continue with Discord" (Hitya 2026-08-24, from
// Lacunanight — Discord's phone-verification wall blocks OAuth consent).
//
// Only members with an officer-issued invite (/auth/claim) have one of these
// accounts; the username maps to <username>@login.wolfpack.quest, the
// synthesized address the claim page created. Client-side because the SSR
// browser client owns the cookie handshake, same as SignInButton.
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabaseBrowser } from '@/lib/supabase-browser';

const LOGIN_DOMAIN = 'login.wolfpack.quest';

export default function PasswordSignIn({ next, prefill }: { next: string; prefill?: string }) {
  const router = useRouter();
  const [username, setUsername] = useState(prefill || '');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const u = username.trim().toLowerCase();
    const email = u.includes('@') ? u : `${u}@${LOGIN_DOMAIN}`;
    const { error: err } = await supabaseBrowser().auth.signInWithPassword({ email, password });
    if (err) {
      setBusy(false);
      // Only a credential failure gets the friendly line. Everything else
      // surfaces verbatim — flattening all errors into "wrong password" cost
      // a diagnosis round on the very first live use (2026-08-24: the server
      // showed a SUCCESSFUL sign-in while the user believed the password was
      // wrong; had it been a config error instead, this message would have
      // sent everyone down the wrong road entirely).
      setError(/invalid login credentials/i.test(err.message)
        ? 'Wrong username or password. Forgot it? Ask an officer for a fresh invite link — it doubles as the reset.'
        : `Sign-in error: ${err.message}`);
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      <label className="block text-sm">
        <span className="block text-dim text-xs mb-1">Username</span>
        <input
          value={username}
          onChange={e => setUsername(e.target.value)}
          required
          autoComplete="username"
          className="w-full bg-bg border border-border rounded px-3 py-2"
        />
      </label>
      <label className="block text-sm">
        <span className="block text-dim text-xs mb-1">Password</span>
        <input
          value={password}
          onChange={e => setPassword(e.target.value)}
          type="password"
          required
          autoComplete="current-password"
          className="w-full bg-bg border border-border rounded px-3 py-2"
        />
      </label>
      {error && <p className="text-red text-xs">{error}</p>}
      <button
        type="submit"
        disabled={busy}
        className="w-full bg-panel border border-border hover:border-blue text-text text-sm rounded px-4 py-2 disabled:opacity-50"
      >
        {busy ? 'Signing in…' : 'Sign in with username'}
      </button>
    </form>
  );
}
