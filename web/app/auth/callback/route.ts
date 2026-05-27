// OAuth callback — Supabase Auth sends Discord users here with a ?code=...
// query param after consent. Flow:
//   1. Exchange the code for a Supabase session (sets HTTP-only cookie)
//   2. Use the Discord provider_token from the session to hit
//      GET /users/@me/guilds/{guild_id}/member — confirms guild membership
//      and gives us the server nickname + roles
//   3. If not in our guild → sign out, redirect to /auth/signin with error
//   4. Else → upsert into wolfpack_members (server-side, service role key)
//      and redirect to the originally-requested page
import { NextResponse, type NextRequest } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { supabaseServer } from '@/lib/supabase-server';
import { fetchGuildMember, memberAvatarUrl, memberDisplayName } from '@/lib/discord';

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get('code');
  const next = url.searchParams.get('next') || '/';

  if (!code) {
    return NextResponse.redirect(`${url.origin}/auth/signin?error=missing_code`);
  }

  const supabase = supabaseServer();
  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    return NextResponse.redirect(
      `${url.origin}/auth/signin?error=${encodeURIComponent(error?.message || 'session_failed')}`,
    );
  }

  const providerToken = data.session.provider_token;
  if (!providerToken) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${url.origin}/auth/signin?error=no_provider_token`,
    );
  }

  let member;
  try {
    member = await fetchGuildMember(providerToken);
  } catch (e: any) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${url.origin}/auth/signin?error=${encodeURIComponent('discord_api: ' + e.message)}`,
    );
  }

  if (!member) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${url.origin}/auth/signin?error=${encodeURIComponent('Not a Wolf Pack EQ member — sign in with the Discord account you use in our server.')}`,
    );
  }

  // Upsert membership row. Uses the service role key so this row gets
  // written regardless of the user's own RLS scope. We treat both a
  // missing key and a failed upsert as hard sign-in errors — silently
  // skipping means AuthBadge falls back to the global Discord info,
  // which looks like the gating "didn't take".
  const SR = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!SR) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${url.origin}/auth/signin?error=${encodeURIComponent('SUPABASE_SERVICE_ROLE_KEY not set on the server — ask an admin to configure Vercel env vars.')}`,
    );
  }

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    SR,
    { auth: { persistSession: false } },
  );
  const { error: upsertError } = await admin.from('wolfpack_members').upsert({
    discord_id:   member.user.id,
    user_id:      data.session.user.id,
    nickname:     memberDisplayName(member),
    global_name:  member.user.global_name,
    avatar_url:   memberAvatarUrl(member),
    roles:        member.roles,
    is_member:    true,
    joined_at:    member.joined_at,
    refreshed_at: new Date().toISOString(),
  }, { onConflict: 'discord_id' });

  if (upsertError) {
    await supabase.auth.signOut();
    return NextResponse.redirect(
      `${url.origin}/auth/signin?error=${encodeURIComponent('member_upsert: ' + upsertError.message)}`,
    );
  }

  return NextResponse.redirect(`${url.origin}${next}`);
}
