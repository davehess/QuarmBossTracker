'use server';
// Officer-approved GUEST Mimic links (the guild lead, 2026-10-30: "where can i give someone a temp key to contribute
// to shared parses as a raider from another guild").
//
// Same shape as the member link in mimic-link-actions.ts: the guest opens Mimic -> Sign in, reads the short code to
// an officer, the officer stamps it here. The difference is WHO the session is for: no member row, no Discord id. The
// officer types a label ("<character> of <guild>") and picks an expiry; the bot's poll handler mints a session with
// scope 'guest' (utils/mimicLink.js), which the bot lets upload parses and nothing else, and refuses once it expires.
//
// TRUST MODEL: the officer vouches for the guest, and every approval and revoke is written to audit_log.
// Every action starts with requireOfficer(): a server action is a public POST endpoint, the page gate is not enough.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';
import { guestExpiry, cleanGuestLabel, extendedGuestExpiry, canExtendGuest, GUEST_EXTEND_HOURS } from '@/lib/guestLink';

const PAGE = '/admin/links';

// The acting officer's own member row, from their auth user id (for the audit fields).
async function actorOf(userId: string) {
  const { data } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('user_id', userId)
    .maybeSingle();
  return data
    ? { discordId: String(data.discord_id), name: data.nickname?.trim() || data.global_name?.trim() || String(data.discord_id) }
    : null;
}

export async function authorizeMimicForGuest(formData: FormData) {
  const userId = await requireOfficer();
  const actor = await actorOf(userId);
  if (!actor) redirect(`${PAGE}?gerr=no_actor`);

  const userCode = String(formData.get('user_code') || '').trim().toUpperCase().replace(/[\s\-_]/g, '');
  const label = cleanGuestLabel(formData.get('guest_label'));
  const expiresAt = guestExpiry(String(formData.get('expiry') || ''));
  if (!userCode || userCode.length < 4) redirect(`${PAGE}?gerr=invalid_code`);
  if (!label) redirect(`${PAGE}?gerr=need_label`);
  if (!expiresAt) redirect(`${PAGE}?gerr=pick_expiry`);

  const admin = supabaseAdmin();

  // Same validation ladder as the member link (mimic-link-actions.ts) and the member-side page.
  const { data: rows } = await admin
    .from('mimic_link_codes')
    .select('user_code, expires_at, authorized_at')
    .eq('user_code', userCode)
    .limit(1);
  const row = Array.isArray(rows) ? rows[0] : null;
  if (!row) redirect(`${PAGE}?gerr=unknown_code`);
  if (new Date(row!.expires_at).getTime() < Date.now()) redirect(`${PAGE}?gerr=expired`);
  if (row!.authorized_at) redirect(`${PAGE}?gok=already`);

  // authorized_at IS NULL in the filter: two officers stamping the same code cannot both win.
  const { data: stamped, error: updErr } = await admin
    .from('mimic_link_codes')
    .update({
      authorized_at:            new Date().toISOString(),
      authorized_user_id:       null,     // a guest has no auth.users row ...
      authorized_discord_id:    null,     // ... and no Discord id: the bot mints `guest:<session id>`
      authorized_via:           'guest',
      authorized_by_discord_id: actor!.discordId,
      guest_label:              label,
      guest_expires_at:         expiresAt,
    })
    .eq('user_code', userCode)
    .is('authorized_at', null)
    .select('user_code');
  if (updErr) redirect(`${PAGE}?gerr=update_failed`);
  if (!stamped || stamped.length === 0) redirect(`${PAGE}?gok=already`);

  await admin.from('audit_log').insert({
    action:           'guest_link_approved',
    actor_discord_id: actor!.discordId,
    actor_name:       actor!.name,
    payload:          { guest_label: label, expires_at: expiresAt },
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?gok=1`);
}

export async function revokeGuestSession(formData: FormData) {
  const userId = await requireOfficer();
  const actor = await actorOf(userId);
  if (!actor) redirect(`${PAGE}?gerr=no_actor`);

  const sessionId = String(formData.get('session_id') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) redirect(`${PAGE}?gerr=bad_session`);

  // scope = 'guest' in the filter: this action can never revoke a member's session.
  const { data: revoked, error } = await supabaseAdmin()
    .from('mimic_sessions')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', sessionId)
    .eq('scope', 'guest')
    .is('revoked_at', null)
    .select('guest_label');
  if (error) redirect(`${PAGE}?gerr=update_failed`);

  await supabaseAdmin().from('audit_log').insert({
    action:           'guest_link_revoked',
    actor_discord_id: actor!.discordId,
    actor_name:       actor!.name,
    payload:          { session_id: sessionId, guest_label: revoked?.[0]?.guest_label ?? null },
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?gok=revoked`);
}

// +1h / +3h on a guest link (the guild lead, 2026-10-30). The same rule the Command Center's button applies in the bot
// (utils/guestLinks.js): max(now, current expiry) + hours, a lapse of up to 12 hours can be revived, a revoked link never.
// The bot trusts a guest identity from cache for at most 60 s, so the new expiry reaches a guest who was cut off
// within a minute without anyone telling the bot.
export async function extendGuestSession(formData: FormData) {
  const userId = await requireOfficer();
  const actor = await actorOf(userId);
  if (!actor) redirect(`${PAGE}?gerr=no_actor`);

  const sessionId = String(formData.get('session_id') || '').trim();
  if (!/^[0-9a-f-]{36}$/i.test(sessionId)) redirect(`${PAGE}?gerr=bad_session`);
  const hours = Number(formData.get('hours'));
  if (!GUEST_EXTEND_HOURS.includes(hours as 1 | 3)) redirect(`${PAGE}?gerr=bad_hours`);

  const admin = supabaseAdmin();
  const { data: rows, error: readErr } = await admin
    .from('mimic_sessions')
    .select('guest_label, expires_at, revoked_at')
    .eq('id', sessionId)
    .eq('scope', 'guest')
    .limit(1);
  if (readErr) redirect(`${PAGE}?gerr=update_failed`);
  const row = rows?.[0];
  if (!row) redirect(`${PAGE}?gerr=bad_session`);
  if (row!.revoked_at) redirect(`${PAGE}?gerr=revoked`);
  if (!canExtendGuest(row!.expires_at)) redirect(`${PAGE}?gerr=too_old`);

  const expiresAt = extendedGuestExpiry(row!.expires_at, hours)!;
  // revoked_at IS NULL in the filter: a Revoke landing between the read and this write wins.
  const { data: updated, error } = await admin
    .from('mimic_sessions')
    .update({ expires_at: expiresAt })
    .eq('id', sessionId)
    .eq('scope', 'guest')
    .is('revoked_at', null)
    .select('id');
  if (error) redirect(`${PAGE}?gerr=update_failed`);
  if (!updated || updated.length === 0) redirect(`${PAGE}?gerr=revoked`);

  await admin.from('audit_log').insert({
    action:           'guest_link_extended',
    actor_discord_id: actor!.discordId,
    actor_name:       actor!.name,
    payload:          { session_id: sessionId, guest_label: row!.guest_label ?? null, hours, from: row!.expires_at, to: expiresAt, via: 'admin_links' },
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?gok=extended`);
}
