'use client';
import { useState } from 'react';
import { supabaseBrowser } from '@/lib/supabase-browser';

export default function SignInButton({ next }: { next: string }) {
  const [loading, setLoading] = useState(false);

  async function go() {
    setLoading(true);
    const supabase = supabaseBrowser();
    const origin = window.location.origin;
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'discord',
      options: {
        redirectTo: `${origin}/auth/callback?next=${encodeURIComponent(next)}`,
        scopes: 'identify',
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
      {loading ? 'Redirecting…' : 'Continue with Discord'}
    </button>
  );
}
