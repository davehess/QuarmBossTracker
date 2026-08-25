// /auth/claim — accept a site-access invite: pick a username + password.
//
// The path for members Discord blocks from OAuth (the phone-verification /
// "verify your account" wall — Lacunanight, 2026-08-24). An officer issues a
// single-use, member-bound invite on /admin/links; this page turns it into a
// password-based auth.users account STAMPED onto the member's
// wolfpack_members.user_id — the same binding the Discord OAuth callback
// writes, which is why every downstream gate works unchanged.
//
// Three deliberate mirrors of the OAuth callback's behavior:
//   1. The ALLOWED_ROLE_NAMES gate runs HERE (the callback runs it at OAuth
//      time; password sign-in never passes through the callback, so claim
//      time is the equivalent moment). Roles come from the member row, which
//      the bot syncs from the guild every 6h.
//   2. No email is ever sent: the "email" is <username>@login.wolfpack.quest,
//      synthesized and created pre-confirmed via the admin API. Password
//      reset is an officer re-invite — the same page detects an existing
//      invited account and RESETS its password instead of creating a second.
//   3. The later-OAuth merge story: if the member ever completes Discord
//      OAuth, the callback re-stamps user_id with the OAuth account, and the
//      password account stops resolving to a member row (signed in, sees
//      nothing). Documented in DECISIONS-2026-08-24; an officer re-invite
//      would NOT fire the reset path then (user_id no longer wp_invited), and
//      refuses loudly instead of silently making a second identity.

import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

const LOGIN_DOMAIN = 'login.wolfpack.quest';
const USERNAME_RX = /^[a-zA-Z0-9._-]{3,32}$/;

async function loadInvite(token: string) {
  if (!/^[0-9a-f]{64}$/.test(token)) return { invite: null, reason: 'bad_token' as const };
  const admin = supabaseAdmin();
  const { data: invite } = await admin
    .from('site_access_invites')
    .select('token, member_discord_id, expires_at, used_at')
    .eq('token', token)
    .maybeSingle();
  if (!invite) return { invite: null, reason: 'unknown' as const };
  if (invite.used_at) return { invite: null, reason: 'used' as const };
  if (new Date(invite.expires_at).getTime() < Date.now()) return { invite: null, reason: 'expired' as const };
  return { invite, reason: null };
}

async function claimInvite(formData: FormData) {
  'use server';
  const token = String(formData.get('token') || '');
  const username = String(formData.get('username') || '').trim().toLowerCase();
  const password = String(formData.get('password') || '');
  const confirm  = String(formData.get('confirm') || '');
  const back = `/auth/claim?token=${encodeURIComponent(token)}`;

  const { invite } = await loadInvite(token);
  if (!invite) redirect(`${back}&error=invite_gone`);
  if (!USERNAME_RX.test(username)) redirect(`${back}&error=bad_username`);
  if (password.length < 10) redirect(`${back}&error=short_password`);
  if (password !== confirm) redirect(`${back}&error=mismatch`);

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('wolfpack_members')
    .select('discord_id, user_id, nickname, global_name, role_names')
    .eq('discord_id', invite!.member_discord_id)
    .eq('is_member', true)
    .maybeSingle();
  if (!member) redirect(`${back}&error=not_member`);

  // Mirror of the OAuth callback's ALLOWED_ROLE_NAMES gate — claim time is
  // this flow's sign-in time.
  const allowed = (process.env.ALLOWED_ROLE_NAMES || '')
    .split(',').map(s => s.trim()).filter(Boolean);
  const roleNames: string[] = Array.isArray(member!.role_names) ? member!.role_names : [];
  if (allowed.length > 0 && !roleNames.some(n => allowed.includes(n))) {
    redirect(`${back}&error=role_gate`);
  }

  const email = `${username}@${LOGIN_DOMAIN}`;

  if (member!.user_id) {
    // The member row is already bound to an auth account. If it's a
    // previously-invited password account, this invite is a RESET (the
    // officer-re-invite reset path — no SMTP anywhere). If it's a real OAuth
    // account, refuse loudly rather than mint a second identity.
    const { data: existing } = await admin.auth.admin.getUserById(member!.user_id);
    const meta = (existing?.user?.user_metadata ?? {}) as Record<string, unknown>;
    if (!existing?.user || meta.wp_invited !== true) {
      redirect(`${back}&error=has_oauth`);
    }
    const { error: updErr } = await admin.auth.admin.updateUserById(member!.user_id, {
      email,
      password,
      email_confirm: true,
    });
    if (updErr) redirect(`${back}&error=create_failed`);
  } else {
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { wp_invited: true, discord_id: member!.discord_id },
    });
    if (createErr || !created?.user) {
      // Most likely: username taken (email collision). Surface as that.
      redirect(`${back}&error=username_taken`);
    }
    const { error: stampErr } = await admin
      .from('wolfpack_members')
      .update({ user_id: created!.user.id })
      .eq('discord_id', member!.discord_id)
      .is('user_id', null);   // never clobber a concurrent OAuth binding
    if (stampErr) redirect(`${back}&error=create_failed`);
  }

  await admin
    .from('site_access_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('token', token);

  redirect(`/auth/signin?ok=claimed&u=${encodeURIComponent(username)}`);
}

const ERRORS: Record<string, string> = {
  invite_gone:    'This invite is no longer valid — ask an officer for a fresh one.',
  bad_username:   'Username: 3–32 characters, letters/numbers/dot/dash/underscore.',
  short_password: 'Password needs at least 10 characters.',
  mismatch:       'The two passwords don’t match.',
  not_member:     'The member this invite was issued for isn’t on the current roster.',
  role_gate:      'Your guild roles don’t include site access yet — ask an officer.',
  has_oauth:      'This member already signs in with Discord. Use "Continue with Discord", or ask an officer if that’s wrong.',
  username_taken: 'That username is taken — pick another.',
  create_failed:  'Couldn’t create the account (server error). Try again in a moment.',
};

export default async function ClaimPage({
  searchParams,
}: {
  searchParams: { token?: string; error?: string };
}) {
  const token = String(searchParams.token || '');
  const { invite, reason } = await loadInvite(token);

  if (!invite) {
    const label = reason === 'used'
      ? 'This invite was already used. If that wasn’t you, tell an officer NOW.'
      : reason === 'expired'
        ? 'This invite expired (7-day window). Ask an officer for a fresh one.'
        : 'This invite link isn’t valid. Check you copied the whole link, or ask an officer for a fresh one.';
    return (
      <div className="max-w-md mx-auto mt-12">
        <section className="bg-panel border border-border rounded-lg p-6 text-center">
          <h2 className="text-xl text-gold mb-2">Site access invite</h2>
          <p className="text-sm text-dim">{label}</p>
        </section>
      </div>
    );
  }

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('wolfpack_members')
    .select('nickname, global_name, user_id')
    .eq('discord_id', invite.member_discord_id)
    .maybeSingle();
  const displayName = member?.nickname || member?.global_name || 'you';
  const isReset = !!member?.user_id;
  const errorMsg = searchParams.error ? (ERRORS[searchParams.error] || `Error: ${searchParams.error}`) : null;

  return (
    <div className="max-w-md mx-auto mt-12 space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-2">
          {isReset ? 'Reset your sign-in' : 'Welcome to wolfpack.quest'}
        </h2>
        <p className="text-sm text-dim leading-6 mb-4">
          An officer issued this invite for <b className="text-text">{displayName}</b>.
          {isReset
            ? ' Pick a new password (and keep or change your username).'
            : ' Pick a username and password — no Discord sign-in needed, ever.'}
        </p>
        {errorMsg && <p className="text-red text-sm mb-4">{errorMsg}</p>}
        <form action={claimInvite} className="space-y-4">
          <input type="hidden" name="token" value={token} />
          <label className="block text-sm">
            <span className="block text-dim text-xs mb-1">Username</span>
            <input
              name="username" required autoComplete="username"
              pattern="[a-zA-Z0-9._\-]{3,32}"
              className="w-full bg-bg border border-border rounded px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-dim text-xs mb-1">Password (10+ characters)</span>
            <input
              name="password" type="password" required minLength={10}
              autoComplete="new-password"
              className="w-full bg-bg border border-border rounded px-3 py-2"
            />
          </label>
          <label className="block text-sm">
            <span className="block text-dim text-xs mb-1">Password again</span>
            <input
              name="confirm" type="password" required minLength={10}
              autoComplete="new-password"
              className="w-full bg-bg border border-border rounded px-3 py-2"
            />
          </label>
          <button type="submit" className="w-full bg-accent hover:bg-blue text-white text-sm rounded px-4 py-2">
            {isReset ? 'Set new password' : 'Create my account'}
          </button>
        </form>
      </section>
      <p className="text-xs text-dim text-center">
        Forgot your password later? Ask an officer for a fresh invite link — it doubles as the reset.
      </p>
    </div>
  );
}
