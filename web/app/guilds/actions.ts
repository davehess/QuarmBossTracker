'use server';

// Join a guild with an invite code (the guild lead, 2026-10-31, DECISIONS §492). The rules (shape, expired, used up,
// suspended, already in, the race for the last use) are web/lib/hubRegistry.ts redeemInviteCode; this wires them to the
// session and to the hub_* tables, the way web/app/pop/raid/me/popflagsActions.ts wires its rules.
// The player is the SIGNED-IN one, taken from the session, never from an argument. Guessing is capped twice: an
// in-memory speed bump per server instance, then failed attempts counted in hub_invite_attempts (8 per player, 20 per
// address, per ten minutes). A new code is eight characters of a 31-letter alphabet.

import { createHmac } from 'node:crypto';
import { headers } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { makeLimiter } from '@/lib/popRecitalSave';
import {
  profileOf, redeemInviteCode, countsAsFailedAttempt, INVITE_ATTEMPT_WINDOW_MS, INVITE_ATTEMPTS_PER_PLAYER, INVITE_ATTEMPTS_PER_IP,
  type InviteDb,
} from '@/lib/hubRegistry';

export type JoinResult = { ok: boolean; message: string };

const attemptAllowed = makeLimiter(INVITE_ATTEMPTS_PER_PLAYER, INVITE_ATTEMPT_WINDOW_MS);

// HMAC-SHA256 of the caller's address, keyed like the feedback forms (web/app/eqmimic/feedback/actions.ts). No salt: the
// per-player count still applies, and the address layer is skipped rather than locking every join out.
function ipHash(): string | null {
  const salt = process.env.ANON_FEEDBACK_SALT || process.env.DEMO_OBFUSCATE_SALT;
  if (!salt) return null;
  const h = headers();
  const ip = (h.get('x-forwarded-for') || '').split(',')[0].trim() || h.get('x-real-ip') || 'unknown';
  return createHmac('sha256', salt).update(ip).digest('hex');
}

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

  // The durable layer: failed guesses in the last ten minutes, by player and by network address, counted in the database so
  // the cap holds across serverless instances. A count that cannot be read refuses (fail closed): this is the guess limiter.
  const hash = ipHash();
  const since = new Date(Date.now() - INVITE_ATTEMPT_WINDOW_MS).toISOString();
  const byPlayer = await admin.from('hub_invite_attempts').select('player_id', { count: 'exact', head: true }).eq('player_id', player.player_id).gte('at', since);
  const byIp = hash ? await admin.from('hub_invite_attempts').select('ip_hash', { count: 'exact', head: true }).eq('ip_hash', hash).gte('at', since) : null;
  if (byPlayer.error || byIp?.error) return { ok: false, message: 'Could not join just now. Try again in a minute.' };
  if ((byPlayer.count ?? 0) >= INVITE_ATTEMPTS_PER_PLAYER || (byIp?.count ?? 0) >= INVITE_ATTEMPTS_PER_IP) {
    return { ok: false, message: 'Too many tries. Wait a few minutes and try again.' };
  }

  const res = await redeemInviteCode(db, { playerId: player.player_id, rawCode: code });
  if (!res.ok) {
    // Only misses are written. Best effort: a failed write never changes the answer the player sees.
    if (countsAsFailedAttempt(res.reason)) {
      try { await admin.from('hub_invite_attempts').insert({ player_id: player.player_id, ip_hash: hash }); } catch { /* counted next time */ }
    }
    return { ok: false, message: res.message };
  }
  revalidatePath('/guilds');
  return { ok: true, message: `You joined ${res.guildName}.` };
}
