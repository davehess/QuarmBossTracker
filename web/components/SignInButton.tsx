'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';
import { signInScopes } from '@/lib/hubRegistry';

// `flow` is only for raidmimic.com's "Find my guilds" (DECISIONS §492): a second consent that adds the `guilds`
// scope, carried to the callback as ?flow=guilds. The scopes follow the host (web/lib/hubRegistry.ts signInScopes):
// wolfpack.quest asks for exactly what it always has.
export default function SignInButton({ next, flow, label = 'Continue with Discord' }: { next: string; flow?: string; label?: string }) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    const supabase = supabaseBrowser();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}${flow ? `&flow=${encodeURIComponent(flow)}` : ''}`,
        scopes: signInScopes(window.location.host, flow),
      },
    });
    if (error) {
      setLoading(false);
      window.location.href = `/auth/signin?error=${encodeURIComponent(error.message)}`;
    }
  }

  return (
    <button
      onClick={go}
      disabled={loading}
      className="inline-flex items-center gap-2 px-4 py-2 rounded bg-[#5865F2] hover:bg-[#4752c4] text-white text-sm font-medium disabled:opacity-50 transition-colors"
    >
      <span aria-hidden>🎮</span>
      {loading ? 'Redirecting…' : label}
    </button>
  );
}
