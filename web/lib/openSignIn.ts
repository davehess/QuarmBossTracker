// The OPEN sign-in path (the guild lead, 2026-10-31, DECISIONS §492: raidmimic.com is a sign-in first, then "your
// guilds"). web/app/auth/callback/route.ts hands a request here when it arrived on a raidmimic host; on wolfpack.quest
// the route runs its own gated code and never reaches this file.
//
// What the open path does, and what it deliberately does not:
//   1. exchange the OAuth code for a session (the same call the gated path makes);
//   2. refuse a locked-out Discord id (the lockout is a guild-wide pause, it applies on every door);
//   3. upsert hub_players from what Discord's `identify` scope already put in the session: id, display name, avatar;
//   4. send the player to /guilds (or the page they asked for).
// NO guild-membership gate, NO role gate, and no call to Discord's API at all on a plain sign-in: identify is all that
// was asked for, and the profile is already in the session.
//
// "Find my guilds" (?flow=guilds) is the one place the Discord server list is read. The button asks Discord for the
// `guilds` scope as a SECOND consent; here the list is fetched once with the session's provider token, matched against
// hub_guilds.discord_guild_id, and a hub_memberships member row is written for each match whose guild is open_join. A
// matched guild that is not open_join is only reported back to the page (it needs an invite code). The list, the names,
// the closed matches and the token are never stored: this module has no write that carries any of them.
import { NextResponse, type NextRequest } from 'next/server';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchUserGuilds } from '@/lib/discord';
import { isLockedOut } from '@/lib/lockout';
import { FLOW_GUILDS, openNext, profileOf, splitMatchesByOpenJoin, type RegisteredGuild } from '@/lib/hubRegistry';

const fail = (origin: string, message: string) =>
  NextResponse.redirect(`${origin}/auth/signin?error=${encodeURIComponent(message)}`);

export async function openSignInCallback(req: NextRequest, origin: string, next: string): Promise<NextResponse> {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  if (!code) return fail(origin, 'missing_code');

  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) return fail(origin, error?.message || 'session_failed');

  const user = data.session.user;
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const discordId = String(meta.provider_id ?? meta.sub ?? '');
  if (!discordId) {
    await supabase.auth.signOut();
    return fail(origin, 'no_discord_id');
  }

  if (await isLockedOut({ id: user.id, user_metadata: { provider_id: discordId } })) {
    await supabase.auth.signOut();
    return NextResponse.redirect(`${origin}/auth/paused`);
  }

  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SR) {
    await supabase.auth.signOut();
    return fail(origin, 'SUPABASE_SERVICE_ROLE_KEY not set on the server — ask an admin to configure Vercel env vars.');
  }
  const admin = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, SR, { auth: { persistSession: false } });

  // Only the columns this path owns are written, so a player's deleted_at (set by "delete my account") is never touched.
  const { displayName, avatarUrl } = profileOf(user);
  const { data: player, error: playerError } = await admin.from('hub_players')
    .upsert({ discord_id: discordId, display_name: displayName, avatar_url: avatarUrl, last_seen_at: new Date().toISOString() }, { onConflict: 'discord_id' })
    .select('player_id')
    .single();
  if (playerError || !player) {
    await supabase.auth.signOut();
    return fail(origin, 'player_upsert: ' + (playerError?.message ?? 'no row'));
  }

  if (url.searchParams.get('flow') === FLOW_GUILDS) {
    return NextResponse.redirect(`${origin}/guilds?${await findMyGuilds(admin, player.player_id, data.session.provider_token)}`);
  }
  return NextResponse.redirect(`${origin}${openNext(next)}`);
}

// Fetch the player's Discord servers with the token, keep only the ones registered here, write one member row per
// match whose guild is open_join (never overwriting a row that already exists, whatever its role or left_at), and report
// as a query string, naming the matches that need an invite code instead.
// The token stays in this function's argument list: it is not logged, stored or returned.
async function findMyGuilds(admin: SupabaseClient, playerId: string, token: string | null | undefined): Promise<string> {
  if (!token) return 'find=no_token';
  let serverIds: string[] | null;
  try { serverIds = await fetchUserGuilds(token); } catch { return 'find=discord_error'; }
  if (!serverIds) return 'find=refused';

  const { data: registry, error: regError } = await admin.from('hub_guilds')
    .select('guild_id, discord_guild_id, open_join')
    .not('discord_guild_id', 'is', null)
    .is('suspended_at', null)
    .limit(1000);
  if (regError) return 'find=error';

  // A guild that is not open_join needs an invite code: its Discord match is SHOWN on /guilds this once (the slugs ride
  // the redirect) and never written. Only the open guilds get a member row.
  const { open, closed } = splitMatchesByOpenJoin(serverIds, (registry ?? []) as RegisteredGuild[]);
  if (open.length) {
    const { error: addError } = await admin.from('hub_memberships')
      .upsert(open.map(guild_id => ({ guild_id, player_id: playerId, role: 'member' })), { onConflict: 'guild_id,player_id', ignoreDuplicates: true });
    if (addError) return 'find=error';
  }
  return `find=ok&found=${open.length}${closed.length ? `&closed=${closed.join(',')}` : ''}`;
}
