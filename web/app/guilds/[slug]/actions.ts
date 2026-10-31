'use server';

// A guild's invite codes (the guild lead, 2026-10-31, DECISIONS §492; docs/DESIGN-raidmimic-hosted.md §4 wizard step 3).
// Only an owner or officer of the guild may mint or revoke one, and the role is read from hub_memberships for the
// SIGNED-IN player on every call: a server action is its own public POST endpoint, so the page hiding the buttons from a
// member is a courtesy, not the check. Redeeming a code is web/app/guilds/actions.ts.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { GUILD_SLUG_RX, INVITE_CODE_RX, normaliseInviteCode } from '@/lib/hubRegistry';
import { activeInvites, canManageInvites, newInviteRow, INVITE_ACTIVE_CAP } from '@/lib/hubGuilds';

export type InviteResult = { ok: boolean; message: string; code?: string };

const NO = (message: string): InviteResult => ({ ok: false, message });
const NOT_ALLOWED = 'Only the guild’s owner or an officer can do that.';

// The signed-in player's player id in this guild, when they are an active owner or officer of it and it is not suspended.
async function officerOf(slug: string): Promise<{ playerId: string } | { error: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  if (!user || !discordId) return { error: 'Sign in first.' };
  if (!GUILD_SLUG_RX.test(slug)) return { error: NOT_ALLOWED };

  const admin = supabaseAdmin();
  const { data: player, error: playerError } = await admin.from('hub_players').select('player_id').eq('discord_id', discordId).is('deleted_at', null).maybeSingle();
  if (playerError) return { error: 'The guild registry is not open yet.' };
  if (!player) return { error: NOT_ALLOWED };
  const { data: mine, error: mineError } = await admin.from('hub_memberships').select('role, left_at').eq('guild_id', slug).eq('player_id', player.player_id).maybeSingle();
  if (mineError) return { error: 'The guild registry is not open yet.' };
  if (!mine || mine.left_at || !canManageInvites(mine.role)) return { error: NOT_ALLOWED };
  const { data: guild } = await admin.from('hub_guilds').select('guild_id').eq('guild_id', slug).is('suspended_at', null).maybeSingle();
  if (!guild) return { error: NOT_ALLOWED };
  return { playerId: player.player_id };
}

const CODE_TRIES = 5;

export async function createInvite(slug: string): Promise<InviteResult> {
  const who = await officerOf(String(slug));
  if ('error' in who) return NO(who.error);
  const admin = supabaseAdmin();

  const { data: rows, error: listError } = await admin.from('hub_invites').select('code, uses, max_uses, expires_at').eq('guild_id', slug);
  if (listError) return NO('Could not make a code just now. Try again in a minute.');
  if (activeInvites(rows ?? []).length >= INVITE_ACTIVE_CAP) {
    return NO(`This guild already has ${INVITE_ACTIVE_CAP} live codes. Revoke one first.`);
  }

  for (let attempt = 0; attempt < CODE_TRIES; attempt++) {
    const row = newInviteRow(slug, who.playerId);
    const { error } = await admin.from('hub_invites').insert(row);
    if (!error) {
      revalidatePath(`/guilds/${slug}`);
      return { ok: true, message: `New invite code ${row.code}.`, code: row.code };
    }
    if (error.code !== '23505') return NO('Could not make a code just now. Try again in a minute.');   // 23505: that code exists; draw another
  }
  return NO('Could not make a code just now. Try again in a minute.');
}

export async function revokeInvite(slug: string, rawCode: string): Promise<InviteResult> {
  const who = await officerOf(String(slug));
  if ('error' in who) return NO(who.error);
  const code = normaliseInviteCode(rawCode);
  if (!INVITE_CODE_RX.test(code)) return NO('That is not an invite code.');

  // Both keys: an officer of one guild cannot revoke another guild's code by sending its letters.
  const { data, error } = await supabaseAdmin().from('hub_invites')
    .update({ expires_at: new Date().toISOString() })
    .eq('code', code)
    .eq('guild_id', slug)
    .select('code');
  if (error) return NO('Could not revoke that code just now. Try again in a minute.');
  if (!(data ?? []).length) return NO('That code is not one of this guild’s.');
  revalidatePath(`/guilds/${slug}`);
  return { ok: true, message: `Revoked ${code}.`, code };
}
