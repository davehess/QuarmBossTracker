'use server';
// Officer-assisted Mimic link authorization (Hitya 2026-08-24, from Gonner:
// Discord's unverified-account wall blocks OAuth consent, so the member-side
// /auth/mimic-link page can never work for him).
//
// TRUST MODEL, stated plainly: the member never proves control of the Discord
// account — the OFFICER attests it. That is the same trust we already extend
// to officers editing character↔member links on this very page, and it is the
// only possible model when the member cannot OAuth at all. Every use is
// audited: the code row records which officer authorized it, and the poll
// handler copies that onto the minted mimic_session before the code row is
// deleted. The target must be a current member row — an officer cannot stamp
// an arbitrary Discord id.
//
// The bot's poll handler has accepted this discord-only shape (no
// authorized_user_id) since 2026-07-31; this is the writer that never existed.

import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

export async function authorizeMimicForMember(formData: FormData) {
  // Defense in depth — the /admin layout already gates, but a server action
  // is directly invocable, so it re-checks.
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/admin/links');
  const ok = await isOfficer(user!.id);
  if (!ok) redirect('/?error=admin_required');

  const codeRaw = String(formData.get('user_code') || '').trim().toUpperCase();
  const userCode = codeRaw.replace(/[\s\-_]/g, '');
  const memberDiscordId = String(formData.get('member_discord_id') || '').trim();
  if (!userCode || userCode.length < 4) redirect('/admin/links?mlerr=invalid_code');
  if (!/^\d{5,25}$/.test(memberDiscordId)) redirect('/admin/links?mlerr=pick_member');

  const admin = supabaseAdmin();

  // The target must be a real, current member — never an arbitrary id.
  const { data: target } = await admin
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('discord_id', memberDiscordId)
    .eq('is_member', true)
    .maybeSingle();
  if (!target) redirect('/admin/links?mlerr=not_member');

  // The attesting officer's own discord_id, for the audit fields.
  const { data: officer } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user!.id)
    .maybeSingle();
  const officerDiscordId =
    officer?.discord_id ||
    ((user!.user_metadata as Record<string, string> | null)?.provider_id ?? null);

  // Same validation ladder as the member-side page (/auth/mimic-link).
  const { data: rows } = await admin
    .from('mimic_link_codes')
    .select('user_code, expires_at, authorized_at')
    .eq('user_code', userCode)
    .limit(1);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) redirect('/admin/links?mlerr=unknown_code');
  if (new Date(row!.expires_at).getTime() < Date.now()) redirect('/admin/links?mlerr=expired');
  if (row!.authorized_at) redirect('/admin/links?mlok=already');

  const { error: updErr } = await admin
    .from('mimic_link_codes')
    .update({
      authorized_at:            new Date().toISOString(),
      authorized_user_id:       null,               // no auth.users row — that's the point
      authorized_discord_id:    target.discord_id,
      authorized_via:           'officer',
      authorized_by_discord_id: officerDiscordId,
    })
    .eq('user_code', userCode);
  if (updErr) redirect('/admin/links?mlerr=update_failed');

  redirect('/admin/links?mlok=1');
}
