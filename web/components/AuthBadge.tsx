// Server component — reads the current Supabase session and renders either
// a Sign In link or a small avatar + Sign Out form. Lives in the page
// header alongside Nav.
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';

export default async function AuthBadge() {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();

  if (!user) {
    return (
      <Link
        href="/auth/signin"
        className="px-3 py-1.5 rounded border border-border bg-panel text-sm hover:border-blue transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const meta = (user.user_metadata || {}) as { full_name?: string; name?: string; avatar_url?: string };
  const name = meta.full_name || meta.name || user.email || 'Wolf';
  const avatar = meta.avatar_url;

  return (
    <form action="/auth/signout" method="post" className="flex items-center gap-2">
      {avatar && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={avatar} alt="" className="w-6 h-6 rounded-full" />
      )}
      <span className="text-xs text-dim hidden sm:inline">{name}</span>
      <button
        type="submit"
        className="px-2 py-1 rounded border border-border bg-panel text-xs hover:border-red transition-colors"
        title="Sign out"
      >
        Sign out
      </button>
    </form>
  );
}
