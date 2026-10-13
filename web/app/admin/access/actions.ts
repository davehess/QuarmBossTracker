'use server';
// Officer actions for /admin/access: lock a member out of OUR tools (the website, Mimic, the bot's commands)
// whatever Discord roles they hold, and lift it again (the guild lead, 2026-10-13; DECISIONS-2026-09-21.md §252).
// The row is the whole switch: the bot re-reads member_lockouts every 20 s and the site's middleware reads it
// through web/lib/lockout.ts. Locking also revokes the member's Mimic sessions so a running install stops at once.
// Every action starts at requireOfficer() (the page gate is not enough: an action is a public POST endpoint).

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { requireOfficer } from '@/lib/officer';

const PAGE = '/admin/access';
const REASON_MAX = 200;

function nameOf(m: { nickname?: string | null; global_name?: string | null; discord_id?: string } | null): string {
  return m?.nickname?.trim() || m?.global_name?.trim() || m?.discord_id || 'unknown';
}

// The officer's own member row, from their auth user id.
async function actorOf(userId: string) {
  const { data } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('user_id', userId)
    .maybeSingle();
  return data ? { discordId: String(data.discord_id), name: nameOf(data) } : null;
}

// "Until <date>" runs to the end of that day, US Eastern (the guild's clock). The offset is looked up for that
// date so daylight saving does not shift it. Returns null for a bad or already-past date.
function endOfDayEastern(date: string): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const probe = new Date(`${date}T23:00:00Z`);
  if (Number.isNaN(probe.getTime())) return null;
  const tz = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'longOffset' })
    .formatToParts(probe).find(p => p.type === 'timeZoneName')?.value || '';
  const off = tz.match(/GMT([+-]\d{2}:\d{2})/)?.[1] ?? '-05:00';
  const end = new Date(`${date}T23:59:59${off}`);
  if (Number.isNaN(end.getTime()) || end.getTime() <= Date.now()) return null;
  return end.toISOString();
}

export async function lockMember(formData: FormData) {
  const userId = await requireOfficer();
  const actor = await actorOf(userId);
  if (!actor) redirect(`${PAGE}?err=no_actor`);

  const discordId = String(formData.get('discord_id') || '').trim();
  const reason = String(formData.get('reason') || '').trim();
  const untilRaw = String(formData.get('until') || '').trim();
  if (!/^\d{5,25}$/.test(discordId)) redirect(`${PAGE}?err=pick_member`);
  if (!reason) redirect(`${PAGE}?err=reason_required`);
  if (reason.length > REASON_MAX) redirect(`${PAGE}?err=reason_long`);
  // An officer who locks themselves out would also lose the page that unlocks them.
  if (discordId === actor!.discordId) redirect(`${PAGE}?err=self`);
  let until: string | null = null;
  if (untilRaw) {
    until = endOfDayEastern(untilRaw);
    if (!until) redirect(`${PAGE}?err=bad_date`);
  }

  const admin = supabaseAdmin();
  const { data: target } = await admin
    .from('wolfpack_members')
    .select('discord_id, user_id, nickname, global_name')
    .eq('discord_id', discordId)
    .eq('is_member', true)
    .maybeSingle();
  if (!target) redirect(`${PAGE}?err=not_member`);

  const now = new Date().toISOString();
  const { error: lockErr } = await admin.from('member_lockouts').upsert({
    discord_id:           discordId,
    user_id:              target!.user_id ?? null,
    reason,
    locked_by_discord_id: actor!.discordId,
    locked_at:            now,
    until,
  }, { onConflict: 'discord_id' });
  if (lockErr) redirect(`${PAGE}?err=lock_failed`);

  // Housekeeping: an expired row is inert but should not pile up.
  await admin.from('member_lockouts').delete().not('until', 'is', null).lt('until', now);

  // Stop a running Mimic now: every live session of this member is revoked (the bot also refuses them while the
  // lock stands, but a revoked session is dead even if the lock is later lifted).
  const { data: revoked, error: revokeErr } = await admin
    .from('mimic_sessions')
    .update({ revoked_at: now })
    .eq('discord_id', discordId)
    .is('revoked_at', null)
    .select('id');
  const sessionsRevoked = revokeErr ? null : (revoked?.length ?? 0);

  await admin.from('audit_log').insert({
    action:           'member_lockout',
    actor_discord_id: actor!.discordId,
    actor_name:       actor!.name,
    payload:          { discord_id: discordId, reason, until, sessions_revoked: sessionsRevoked },
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=locked&who=${encodeURIComponent(nameOf(target))}${revokeErr ? '&warn=revoke_failed' : `&n=${sessionsRevoked}`}`);
}

export async function unlockMember(formData: FormData) {
  const userId = await requireOfficer();
  const actor = await actorOf(userId);
  if (!actor) redirect(`${PAGE}?err=no_actor`);

  const discordId = String(formData.get('discord_id') || '').trim();
  if (!/^\d{5,25}$/.test(discordId)) redirect(`${PAGE}?err=pick_member`);

  const admin = supabaseAdmin();
  const { data: member } = await admin
    .from('wolfpack_members')
    .select('discord_id, nickname, global_name')
    .eq('discord_id', discordId)
    .maybeSingle();

  const { error } = await admin.from('member_lockouts').delete().eq('discord_id', discordId);
  if (error) redirect(`${PAGE}?err=unlock_failed`);

  await admin.from('audit_log').insert({
    action:           'member_unlock',
    actor_discord_id: actor!.discordId,
    actor_name:       actor!.name,
    payload:          { discord_id: discordId },
  });

  revalidatePath(PAGE);
  redirect(`${PAGE}?ok=unlocked&who=${encodeURIComponent(nameOf(member ?? { discord_id: discordId }))}`);
}
