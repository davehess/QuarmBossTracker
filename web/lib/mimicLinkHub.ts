// Finishing a Mimic link on a guild's own site (the guild lead, 2026-10-31, DECISIONS §499): the rules half.
//
// A Mimic linked to a guild on Raid Mimic asks the bot for a code (POST /api/mimic-link/start with the guild's slug), and
// the bot answers a verification address on the hosted site. /auth/mimic-link there is the OPEN sign-in (no Wolf Pack
// role gate), so this module decides who may claim a code: a signed-in player who is an ACTIVE member of the code's guild.
// It only stamps the code. The bot's poll mints the session, re-checks the membership itself and writes the session's
// guild_id from the code, so a wrong stamp here can never put a player in a guild.
//
// Pure rules over a small db interface, plus the supabase-js implementation of it. Nothing from the `@/` alias, so a test
// can run the claim against a fake, like web/lib/hubRegistry.ts (whose slug shape it reuses).
import type { SupabaseClient } from '@supabase/supabase-js';
import { GUILD_SLUG_RX } from './hubRegistry';

/** What a person types or pastes, made into the six characters Mimic showed: upper case, no spaces, dashes or underscores. */
export function cleanLinkCode(raw: unknown): string {
  return String(raw ?? '').trim().toUpperCase().replace(/[\s\-_]/g, '');
}
export const LINK_CODE_RX = /^[A-Z0-9]{4,12}$/;

export type LinkCodeRow = { user_code: string; expires_at: string; authorized_at: string | null; hub: string | null };
export type LinkGuildRow = { guild_id: string; display_name: string; suspended_at: string | null };
export type LinkPlayerRow = { player_id: string; deleted_at: string | null };
export type LinkMembershipRow = { role: string; left_at: string | null };

export interface LinkHubDb {
  getCode(userCode: string): Promise<LinkCodeRow | null>;
  getGuild(guildId: string): Promise<LinkGuildRow | null>;
  getPlayer(discordId: string): Promise<LinkPlayerRow | null>;
  getMembership(guildId: string, playerId: string): Promise<LinkMembershipRow | null>;
  /** Stamp the code as claimed, only if nobody has yet. True when this call did it. */
  stampCode(userCode: string, stamp: { userId: string; discordId: string; at: string }): Promise<boolean>;
}

/** Why a code cannot be claimed here. `wolfpack_code`: a Wolf Pack code belongs on wolfpack.quest, behind its role gate. */
export type LinkRefusal = 'unknown_code' | 'expired' | 'wolfpack_code' | 'unknown_guild' | 'suspended' | 'join_first' | 'error';

export type HubLinkCheck =
  | { state: 'claimable'; guildId: string; guildName: string; role: string }
  | { state: 'already'; guildId: string; guildName: string }
  | { state: 'refused'; reason: LinkRefusal; guildId?: string; guildName?: string };

const NO = (reason: LinkRefusal, guild?: { guildId: string; guildName: string }): HubLinkCheck =>
  ({ state: 'refused', reason, ...(guild ?? {}) });

/**
 * What would happen if `discordId` claimed `userCode` on a hub site. Reads only; the page shows it before the button, and
 * the claim runs it again. Order: the code exists and is live, it names a guild (a Wolf Pack code does not), the guild is
 * real and not suspended, then whether the player is an active member of it.
 */
export async function checkHubLink(
  db: LinkHubDb,
  args: { userCode: string; discordId: string; now?: Date },
): Promise<HubLinkCheck> {
  const now = args.now ?? new Date();
  try {
    const code = await db.getCode(args.userCode);
    if (!code) return NO('unknown_code');
    const expires = Date.parse(code.expires_at);
    if (!Number.isFinite(expires) || expires < now.getTime()) return NO('expired');
    if (!code.hub) return NO('wolfpack_code');
    if (!GUILD_SLUG_RX.test(code.hub)) return NO('unknown_guild');

    const guild = await db.getGuild(code.hub);
    if (!guild) return NO('unknown_guild');
    const named = { guildId: guild.guild_id, guildName: guild.display_name };
    if (guild.suspended_at) return NO('suspended', named);
    if (code.authorized_at) return { state: 'already', ...named };

    const player = await db.getPlayer(args.discordId);
    if (!player || player.deleted_at) return NO('join_first', named);
    const mine = await db.getMembership(guild.guild_id, player.player_id);
    if (!mine || mine.left_at) return NO('join_first', named);
    return { state: 'claimable', ...named, role: mine.role };
  } catch {
    return NO('error');
  }
}

export type HubClaimResult =
  | { ok: true; already: boolean; guildId: string; guildName: string }
  | { ok: false; reason: LinkRefusal | 'update_failed'; guildId?: string; guildName?: string };

/** Claim the code for the signed-in player, or say why not. Nothing is written unless the check says claimable. */
export async function claimHubCode(
  db: LinkHubDb,
  args: { userCode: string; userId: string; discordId: string; now?: Date },
): Promise<HubClaimResult> {
  const now = args.now ?? new Date();
  const check = await checkHubLink(db, { userCode: args.userCode, discordId: args.discordId, now });
  if (check.state === 'refused') return { ok: false, reason: check.reason, guildId: check.guildId, guildName: check.guildName };
  if (check.state === 'already') return { ok: true, already: true, guildId: check.guildId, guildName: check.guildName };
  try {
    const stamped = await db.stampCode(args.userCode, { userId: args.userId, discordId: args.discordId, at: now.toISOString() });
    if (!stamped) return { ok: false, reason: 'update_failed', guildId: check.guildId, guildName: check.guildName };
  } catch {
    return { ok: false, reason: 'update_failed', guildId: check.guildId, guildName: check.guildName };
  }
  return { ok: true, already: false, guildId: check.guildId, guildName: check.guildName };
}

const first = <T>(data: unknown): T | null => (Array.isArray(data) && data[0] ? (data[0] as T) : null);

/** The supabase-js implementation. Reads and the one conditional update; a failed read throws so the rules answer 'error'. */
export function hubLinkDb(admin: SupabaseClient): LinkHubDb {
  return {
    async getCode(userCode) {
      const { data, error } = await admin.from('mimic_link_codes')
        .select('user_code, expires_at, authorized_at, hub')
        .eq('user_code', userCode)
        .limit(1);
      if (error) throw new Error(error.message);
      return first<LinkCodeRow>(data);
    },
    async getGuild(guildId) {
      const { data, error } = await admin.from('hub_guilds')
        .select('guild_id, display_name, suspended_at')
        .eq('guild_id', guildId)
        .limit(1);
      if (error) throw new Error(error.message);
      return first<LinkGuildRow>(data);
    },
    async getPlayer(discordId) {
      const { data, error } = await admin.from('hub_players')
        .select('player_id, deleted_at')
        .eq('discord_id', discordId)
        .limit(1);
      if (error) throw new Error(error.message);
      return first<LinkPlayerRow>(data);
    },
    async getMembership(guildId, playerId) {
      const { data, error } = await admin.from('hub_memberships')
        .select('role, left_at')
        .eq('guild_id', guildId)
        .eq('player_id', playerId)
        .limit(1);
      if (error) throw new Error(error.message);
      return first<LinkMembershipRow>(data);
    },
    async stampCode(userCode, stamp) {
      const { data, error } = await admin.from('mimic_link_codes')
        .update({ authorized_at: stamp.at, authorized_user_id: stamp.userId, authorized_discord_id: stamp.discordId })
        .eq('user_code', userCode)
        .is('authorized_at', null)
        .select('user_code');
      if (error) throw new Error(error.message);
      return Array.isArray(data) && data.length > 0;
    },
  };
}
