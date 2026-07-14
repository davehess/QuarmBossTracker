// Server component — reads the current Supabase session, joins to the
// wolfpack_members row (server nickname + avatar override), and renders
// either a Sign In link or a small avatar + Sign Out form.
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

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
  //
  // These reads MUST use the service-role client, not the user's session.
  // wolfpack_members RLS is a single self-read policy (auth.uid() = user_id),
  // so under the user's JWT a row whose user_id is NULL (or not yet stamped)
  // is INVISIBLE — which silently killed the discord_id fallback for the 94%
  // of un-stamped rows and re-broke the "vaporjesus instead of Hitya" case
  // (2026-07-14). We only ever query the logged-in user's OWN row (by their
  // user.id / their own OAuth discord_id), so service-role is safe here.
  const admin = supabaseAdmin();
  let nickname: string | null = null;
  let avatarUrl: string | null = null;
  {
    const { data } = await admin
      .from('wolfpack_members')
      .select('nickname, global_name, avatar_url')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data) {
      // Server nickname if set, else the member's guild display name — both
      // beat the raw Discord OAuth name for "our server's profile".
      nickname  = data.nickname ?? data.global_name ?? null;
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
      const { data } = await admin
        .from('wolfpack_members')
        .select('nickname, global_name, avatar_url')
        .eq('discord_id', did)
        .maybeSingle();
      if (data) {
        nickname  = data.nickname ?? data.global_name ?? null;
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
