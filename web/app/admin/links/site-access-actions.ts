'use server';
// Officer-issued site-access invites (Hitya 2026-08-24, from Lacunanight —
// Discord's phone-verification wall blocks OAuth consent, and he wants SITE
// access, not Mimic).
//
// The whole site gates on auth.uid() → wolfpack_members.user_id; Discord
// OAuth's only structural job is stamping that binding in /auth/callback. An
// invite lets an officer authorize the SAME binding for a password account
// instead: the officer picks the member, sends them the link, the member
// chooses a username + password on /auth/claim, and every existing gate —
// membership, officer, /me ownership — works untouched.
//
// Trust model mirrors the Mimic officer-assist card above it: the officer
// attests the identity; the target must be a current member row.

import { redirect } from 'next/navigation';
import crypto from 'crypto';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

const INVITE_TTL_DAYS = 7;

export async function createSiteAccessInvite(formData: FormData) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) redirect('/auth/signin?next=/admin/links');
  const ok = await isOfficer(user!.id);
  if (!ok) redirect('/?error=admin_required');

  const memberDiscordId = String(formData.get('member_discord_id') || '').trim();
  if (!/^\d{5,25}$/.test(memberDiscordId)) redirect('/admin/links?sierr=pick_member');

  const admin = supabaseAdmin();
  const { data: target } = await admin
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('discord_id', memberDiscordId)
    .eq('is_member', true)
    .maybeSingle();
  if (!target) redirect('/admin/links?sierr=not_member');

  const { data: officer } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user!.id)
    .maybeSingle();

  const token = crypto.randomBytes(32).toString('hex');
  const { error } = await admin.from('site_access_invites').insert({
    token,
    guild_id:              'wolfpack',
    member_discord_id:     target.discord_id,
    created_by_discord_id: officer?.discord_id ?? null,
    expires_at:            new Date(Date.now() + INVITE_TTL_DAYS * 86400000).toISOString(),
  });
  if (error) redirect('/admin/links?sierr=insert_failed');

  const name = target.nickname || target.global_name || target.discord_id;
  redirect(`/admin/links?sitok=${token}&sifor=${encodeURIComponent(name)}`);
}
