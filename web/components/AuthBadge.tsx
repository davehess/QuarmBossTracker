// Server component — reads the current Supabase session, joins to the
// wolfpack_members row (server nickname + avatar override), and renders
// either a Sign In link or a small avatar + Sign Out form.
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

  // Pull the server nickname + avatar from wolfpack_members. We try two
  // joins because user_id ISN'T reliably populated on the bot's member-
  // sync output — about 94% of rows have user_id NULL (the 6h member
  // sync upserts by discord_id, not by Supabase Auth user_id, so unless
  // a member has actively signed in to wolfpack.quest AND a separate
  // sync pass has stamped their auth user_id, the column is blank).
  // Uilnayar 2026-06-21 ("back to seeing my Discord profile in the top
  // corner instead of my Wolf Pack server profile") — every member
  // whose user_id link hadn't been written was falling through to the
  // Discord global name. Look up by Discord ID from the OAuth identity
  // as a fallback so the server nickname renders for everyone.
  let nickname: string | null = null;
  let avatarUrl: string | null = null;
  {
    const { data } = await supabase
      .from('wolfpack_members')
      .select('nickname, avatar_url')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      nickname  = data.nickname ?? null;
      avatarUrl = data.avatar_url ?? null;
    }
  }
  if (!nickname) {
    // Discord OAuth puts the user's Discord ID in identity.identity_data
    // (provider_id / sub) — and Supabase mirrors it into
    // user_metadata.provider_id for convenience. Fall back to that.
    const meta = (user.user_metadata || {}) as { provider_id?: string; sub?: string };
    const did = meta.provider_id || meta.sub || null;
    if (did) {
      const { data } = await supabase
        .from('wolfpack_members')
        .select('nickname, avatar_url')
        .eq('discord_id', did)
        .maybeSingle();
      if (data) {
        nickname  = data.nickname  ?? null;
        avatarUrl = data.avatar_url ?? null;
      }
    }
  }

  const meta = (user.user_metadata || {}) as { full_name?: string; name?: string; avatar_url?: string };
  const name = nickname || meta.full_name || meta.name || user.email || 'Wolf';
  const avatar = avatarUrl || meta.avatar_url;

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
