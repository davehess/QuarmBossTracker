// /auth/mimic-link — the human side of the Mimic device-code flow.
//
// Mimic shows a 6-character code and opens this page in the user's browser.
// We require a signed-in Discord account (the existing OAuth flow) and ask the
// user to confirm the code. On confirm, we stamp the matching row in
// mimic_link_codes with the user's auth.uid() + discord_id; Mimic polls the
// bot and exchanges that for a long-lived session_token.
//
// Why server actions: keeps the secret (service_role) on the server, no client
// JS needed, and ties the action to the signed-in user via supabaseServer().

import { redirect } from 'next/navigation';
import Link from 'next/link';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';

export const dynamic = 'force-dynamic';

async function authorizeCode(formData: FormData) {
  'use server';
  const codeRaw = String(formData.get('user_code') || '').trim().toUpperCase();
  // Normalize: strip spaces / dashes the user may have added.
  const userCode = codeRaw.replace(/[\s\-_]/g, '');
  if (!userCode || userCode.length < 4) {
    redirect('/auth/mimic-link?error=invalid_code');
  }

  // Caller must be signed in via Discord OAuth.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) {
    redirect(`/auth/signin?next=${encodeURIComponent('/auth/mimic-link?code=' + userCode)}`);
  }

  const admin = supabaseAdmin();
  // Look up the discord_id from wolfpack_members (cached at sign-in by the
  // auth callback). user.user_metadata.provider_id is the same value but
  // wolfpack_members is the canonical store.
  const { data: member } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user!.id)
    .maybeSingle();
  const discordId = member?.discord_id || (user!.user_metadata as Record<string, string> | null)?.provider_id || null;
  if (!discordId) {
    redirect('/auth/mimic-link?error=no_discord_id');
  }

  // Look up the link code — must exist, not be expired, and not already
  // authorized (idempotent enough; a duplicate Confirm is a no-op).
  const { data: rows } = await admin
    .from('mimic_link_codes')
    .select('user_code,expires_at,authorized_at')
    .eq('user_code', userCode)
    .limit(1);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) {
    redirect('/auth/mimic-link?error=unknown_code');
  }
  if (new Date(row!.expires_at).getTime() < Date.now()) {
    redirect('/auth/mimic-link?error=expired');
  }
  if (row!.authorized_at) {
    // Already linked — friendly success page, idempotent.
    redirect('/auth/mimic-link?ok=already');
  }

  const { error: updErr } = await admin
    .from('mimic_link_codes')
    .update({
      authorized_at:         new Date().toISOString(),
      authorized_user_id:    user!.id,
      authorized_discord_id: discordId,
    })
    .eq('user_code', userCode);
  if (updErr) {
    redirect('/auth/mimic-link?error=update_failed');
  }
  redirect('/auth/mimic-link?ok=1');
}

// Friendly labels for the redirect status codes the server action sets.
const ERROR_LABELS: Record<string, string> = {
  invalid_code:   'That code doesn\'t look right — paste the 6 characters Mimic is showing.',
  unknown_code:   'No matching code. Did it already expire (10 minute window) or get mistyped?',
  expired:        'That code expired. In Mimic, click "Sign in to Wolf Pack" again to get a fresh one.',
  update_failed:  'Couldn\'t save the link (database error). Try again in a moment.',
  no_discord_id:  'Your Wolf Pack member record is missing a Discord ID — sign out and back in, then retry.',
};
const OK_LABELS: Record<string, string> = {
  '1':       '✓ Linked. Return to Mimic — it\'ll pick up the link within a couple of seconds.',
  'already': '✓ Already linked. Return to Mimic — it should already be signed in.',
};

export default async function MimicLinkPage({
  searchParams,
}: {
  searchParams: { code?: string; error?: string; ok?: string };
}) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) {
    const next = '/auth/mimic-link' + (searchParams.code ? `?code=${encodeURIComponent(searchParams.code)}` : '');
    redirect(`/auth/signin?next=${encodeURIComponent(next)}`);
  }

  const prefilled = String(searchParams.code || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
  const errorMsg  = searchParams.error ? (ERROR_LABELS[searchParams.error] || `Error: ${searchParams.error}`) : null;
  const okMsg     = searchParams.ok    ? (OK_LABELS[searchParams.ok]       || OK_LABELS['1'])              : null;

  return (
    <div className="max-w-lg mx-auto mt-10 space-y-6">
      <section className="bg-panel border border-border rounded-lg p-6">
        <h2 className="text-xl text-gold mb-2">Link Mimic to your Discord account</h2>
        <p className="text-sm text-dim mb-5">
          Paste the 6-character code from Mimic (Settings → Sign in to Wolf Pack)
          to link this install to your Discord account. The link persists across
          Mimic upgrades and unlocks cross-machine sync + officer tools.
        </p>

        {okMsg && (
          <div className="bg-[#1a4731] border border-green text-green text-sm rounded p-3 mb-4">
            {okMsg}
          </div>
        )}
        {errorMsg && (
          <div className="bg-[#3a1a1a] border border-red text-red text-sm rounded p-3 mb-4">
            {errorMsg}
          </div>
        )}

        {!okMsg && (
          <form action={authorizeCode} className="space-y-4">
            <label className="block">
              <span className="block text-xs uppercase tracking-widest text-dim mb-1">Code from Mimic</span>
              <input
                type="text"
                name="user_code"
                defaultValue={prefilled}
                placeholder="ABCD23"
                maxLength={12}
                autoComplete="off"
                autoCapitalize="characters"
                autoFocus={!prefilled}
                className="w-full bg-bg border border-border rounded px-3 py-2 text-text font-mono text-2xl tracking-[0.3em] text-center uppercase focus:border-blue outline-none"
              />
            </label>
            <button
              type="submit"
              className="w-full bg-blue text-white border-0 rounded px-4 py-2 text-sm font-bold cursor-pointer hover:bg-blue/90"
            >
              Confirm — link this Mimic install
            </button>
            <p className="text-xs text-dim text-center">
              Signed in as <span className="text-text">{user!.email || user!.user_metadata?.full_name || 'your Discord account'}</span>.
              <br />
              Wrong account? <Link href="/auth/signout" className="text-blue hover:underline">Sign out</Link> first.
            </p>
          </form>
        )}
      </section>
    </div>
  );
}
