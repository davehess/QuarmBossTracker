'use server';

// Join a guild with an invite code (the guild lead, 2026-10-31, DECISIONS §492). The rules (shape, expired, used up,
// suspended, already in, the race for the last use) are web/lib/hubRegistry.ts redeemInviteCode; this wires them to the
// session and to the hub_* tables, the way web/app/pop/raid/me/popflagsActions.ts wires its rules.
// The player is the SIGNED-IN one, taken from the session, never from an argument. Eight attempts in ten minutes per
// player, per server instance: a code is six characters of a 32-letter alphabet, and this is what keeps it unguessable.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { makeLimiter } from '@/lib/popRecitalSave';
import { profileOf, redeemInviteCode, type InviteDb } from '@/lib/hubRegistry';

export type JoinResult = { ok: boolean; message: string };

const attemptAllowed = makeLimiter(8, 10 * 60_000);

export async function redeemInvite(code: string): Promise<JoinResult> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  if (!user || !discordId) return { ok: false, message: 'Sign in first.' };
  if (!attemptAllowed(discordId)) return { ok: false, message: 'Too many tries. Wait a few minutes and try again.' };

  const admin = supabaseAdmin();

  // A player who signed in on wolfpack.quest has no hub_players row yet; one is made here. Only the columns this
  // sets are written, so an existing row's deleted_at and created_at are never touched.
  const { displayName, avatarUrl } = profileOf(user);
  const { data: player, error: playerError } = await admin.from('hub_players')
    .upsert({ discord_id: discordId, display_name: displayName, avatar_url: avatarUrl, last_seen_at: new Date().toISOString() }, { onConflict: 'discord_id' })
    .select('player_id')
    .single();
  if (playerError || !player) return { ok: false, message: 'The guild registry is not open yet.' };

  const db: InviteDb = {
    async getInvite(c) {
      const { data, error } = await admin.from('hub_invites').select('code, guild_id, expires_at, max_uses, uses').eq('code', c).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async getGuild(guildId) {
      const { data, error } = await admin.from('hub_guilds').select('guild_id, display_name, suspended_at').eq('guild_id', guildId).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async getMembership(guildId, playerId) {
      const { data, error } = await admin.from('hub_memberships').select('role, left_at').eq('guild_id', guildId).eq('player_id', playerId).maybeSingle();
      if (error) throw new Error(error.message);
      return data;
    },
    async claimUse(c, expectedUses) {
      const { data, error } = await admin.from('hub_invites').update({ uses: expectedUses + 1 }).eq('code', c).eq('uses', expectedUses).select('code');
      if (error) throw new Error(error.message);
      return (data ?? []).length === 1;
    },
    async addMember(guildId, playerId) {
      const { error } = await admin.from('hub_memberships')
        .upsert({ guild_id: guildId, player_id: playerId, role: 'member', left_at: null, joined_at: new Date().toISOString() }, { onConflict: 'guild_id,player_id' });
      return error ? error.message : null;
    },
  };

  const res = await redeemInviteCode(db, { playerId: player.player_id, rawCode: code });
  if (!res.ok) return { ok: false, message: res.message };
  revalidatePath('/guilds');
  return { ok: true, message: `You joined ${res.guildName}.` };
}
