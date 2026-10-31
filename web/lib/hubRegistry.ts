// The open hub's registry, the rules half (the guild lead, 2026-10-31, DECISIONS §492; tables:
// supabase/migrations/20261023160000_open_hub_registry.sql and 20261031150000_hub_registry_discord_guild.sql).
//
// Pure: no database, no framework, and nothing from the `@/` alias, so a browser component can import the scopes and a
// test can run the invite rules against a fake. The callers that touch the database are web/lib/openSignIn.ts (the
// sign-in callback) and web/app/guilds/actions.ts (the invite form).
import { isRaidmimicHost } from './raidmimicHost';

// ── Discord scopes ──────────────────────────────────────────────────────────────────────────────────────────
// Wolf Pack's gate reads the member's roles in OUR server, so it needs guilds.members.read. A raidmimic host signs
// people in with identify alone (no server list, no email); "Find my guilds" is a second, optional consent that adds
// `guilds`, and it is the only thing that ever asks for the list.
export const SCOPES_WOLFPACK = 'identify guilds.members.read';
export const SCOPES_OPEN = 'identify';
export const SCOPES_FIND_GUILDS = 'identify guilds';
export const FLOW_GUILDS = 'guilds';

/** `host` is a Host header or window.location.host. `flow` is the `flow` the sign-in button was given. */
export function signInScopes(host: string | null | undefined, flow?: string | null): string {
  if (!isRaidmimicHost(host)) return SCOPES_WOLFPACK;
  return flow === FLOW_GUILDS ? SCOPES_FIND_GUILDS : SCOPES_OPEN;
}

/** Where the open path sends a player when the caller asked for no page in particular: their guilds, not the landing page. */
export const RAIDMIMIC_HOME = '/guilds';
export function openNext(next: string): string {
  return next === '/' ? RAIDMIMIC_HOME : next;
}

// ── Find my guilds ──────────────────────────────────────────────────────────────────────────────────────────
export type RegisteredGuild = { guild_id: string; discord_guild_id: string | null; open_join?: boolean | null };

/** The registered guilds whose Discord server is in the player's list. Ids only; nothing else of the list survives this call. */
export function matchRegisteredGuilds(discordGuildIds: readonly string[], registry: readonly RegisteredGuild[]): string[] {
  const mine = new Set(discordGuildIds.map(String));
  const out: string[] = [];
  for (const g of registry) if (g.discord_guild_id && mine.has(g.discord_guild_id) && !out.includes(g.guild_id)) out.push(g.guild_id);
  return out;
}

/**
 * The matches, split by the guild's own door. `open`: open_join is true, so the player is added. `closed`: it is not (or is
 * unknown), so the player is only TOLD, and asked to get an invite code. Anything not strictly true counts as closed.
 */
export function splitMatchesByOpenJoin(discordGuildIds: readonly string[], registry: readonly RegisteredGuild[]): { open: string[]; closed: string[] } {
  const matched = matchRegisteredGuilds(discordGuildIds, registry);
  const isOpen = (id: string) => registry.find(g => g.guild_id === id)?.open_join === true;
  return { open: matched.filter(isOpen), closed: matched.filter(id => !isOpen(id)) };
}

// A guild id as the page reads it back from the redirect: the registry's slug shape (utils/openHub.js validGuildSlug).
export const GUILD_SLUG_RX = /^[a-z0-9][a-z0-9-]{1,22}[a-z0-9]$/;

/**
 * The "Guilds you're in on Discord" list on /guilds: the slugs "Find my guilds" put in the redirect, made safe to show.
 * Each is shape-checked, one already in the player's own list is dropped, at most ten are looked up, and `read` (the page's
 * query) decides which of them are real, unsuspended and closed. Nothing here is stored.
 */
export async function closedMatchesFor(
  raw: string | undefined,
  mineIds: readonly string[],
  read: (slugs: string[]) => Promise<{ guild_id: string; display_name: string }[]>,
): Promise<{ guild_id: string; name: string }[]> {
  const slugs = (raw ?? '').split(',').filter(s => GUILD_SLUG_RX.test(s) && !mineIds.includes(s)).slice(0, 10);
  if (!slugs.length) return [];
  try {
    const rows = await read(slugs);
    return rows.filter(g => slugs.includes(g.guild_id)).map(g => ({ guild_id: g.guild_id, name: g.display_name })).sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

// ── Invite codes ────────────────────────────────────────────────────────────────────────────────────────────
// Six characters, no 0 O 1 I L (the hub_invites check constraint).
export const INVITE_CODE_RX = /^[A-HJKMNP-Z2-9]{6}$/;

/** Upper-case, drop the spaces and dashes a person types around a code. */
export function normaliseInviteCode(raw: unknown): string {
  return String(raw ?? '').toUpperCase().replace(/[\s\-_]/g, '');
}

export type InviteRow = { code: string; guild_id: string; expires_at: string; max_uses: number; uses: number };
export type GuildRow = { guild_id: string; display_name: string; suspended_at: string | null };
export type MembershipRow = { role: string; left_at: string | null };

// Everything the redeem rules need from storage. The server action implements it over supabase-js.
export interface InviteDb {
  getInvite(code: string): Promise<InviteRow | null>;
  getGuild(guildId: string): Promise<GuildRow | null>;
  getMembership(guildId: string, playerId: string): Promise<MembershipRow | null>;
  /** Take one use if `uses` still equals `expectedUses` (so two people redeeming the last use cannot both win). */
  claimUse(code: string, expectedUses: number): Promise<boolean>;
  /** Insert the member row, or reopen one the player had left. Returns an error message, or null. */
  addMember(guildId: string, playerId: string): Promise<string | null>;
}

export type RedeemResult =
  | { ok: true; guildId: string; guildName: string }
  | { ok: false; reason: 'bad_code' | 'unknown' | 'expired' | 'used_up' | 'suspended' | 'already' | 'busy' | 'error'; message: string };

const NO = (reason: Extract<RedeemResult, { ok: false }>['reason'], message: string): RedeemResult => ({ ok: false, reason, message });

export const REDEEM_MESSAGES = {
  bad_code: 'An invite code is six letters and numbers, like K7M2QP.',
  unknown: 'No guild has that invite code. Check it with whoever sent it.',
  expired: 'That invite code has expired. Ask the guild for a new one.',
  used_up: 'That invite code has been used as many times as it allows. Ask the guild for a new one.',
  suspended: 'That guild is not taking new members right now.',
  already: 'You are already in that guild.',
  busy: 'Someone else used that code at the same moment. Try again.',
  error: 'Could not join just now. Try again in a minute.',
} as const;

const CLAIM_TRIES = 3;

/**
 * Join the guild an invite code belongs to. The rules, in the order they are checked: the shape of the code, that it
 * exists, that it has not expired and has a use left, that the guild is not suspended, that the player is not already in.
 * A use is taken only after all of those pass, and before the member row is written.
 */
export async function redeemInviteCode(
  db: InviteDb,
  args: { playerId: string; rawCode: unknown; now?: Date },
): Promise<RedeemResult> {
  const now = args.now ?? new Date();
  const code = normaliseInviteCode(args.rawCode);
  if (!INVITE_CODE_RX.test(code)) return NO('bad_code', REDEEM_MESSAGES.bad_code);

  try {
    for (let attempt = 0; attempt < CLAIM_TRIES; attempt++) {
      const invite = await db.getInvite(code);
      if (!invite) return NO('unknown', REDEEM_MESSAGES.unknown);
      const expires = Date.parse(invite.expires_at);
      if (!Number.isFinite(expires) || expires <= now.getTime()) return NO('expired', REDEEM_MESSAGES.expired);
      if (invite.uses >= invite.max_uses) return NO('used_up', REDEEM_MESSAGES.used_up);

      const guild = await db.getGuild(invite.guild_id);
      if (!guild) return NO('unknown', REDEEM_MESSAGES.unknown);
      if (guild.suspended_at) return NO('suspended', REDEEM_MESSAGES.suspended);

      const mine = await db.getMembership(invite.guild_id, args.playerId);
      if (mine && !mine.left_at) return NO('already', REDEEM_MESSAGES.already);

      if (!(await db.claimUse(code, invite.uses))) continue;   // lost a race for the use: read the row again
      const err = await db.addMember(invite.guild_id, args.playerId);
      if (err) return NO('error', REDEEM_MESSAGES.error);
      return { ok: true, guildId: invite.guild_id, guildName: guild.display_name };
    }
    return NO('busy', REDEEM_MESSAGES.busy);
  } catch {
    return NO('error', REDEEM_MESSAGES.error);
  }
}

// ── Who the player is, from what Discord's identify scope gave Supabase ────────────────────────────────────────
// Supabase stamps the Discord profile into user_metadata: full_name / name, avatar_url, custom_claims.global_name.
export function profileOf(user: { user_metadata?: unknown } | null | undefined): { displayName: string | null; avatarUrl: string | null } {
  const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
  const claims = (meta.custom_claims ?? {}) as Record<string, unknown>;
  const pick = (...v: unknown[]) => v.find((x): x is string => typeof x === 'string' && x.trim() !== '')?.trim().slice(0, 80) ?? null;
  const avatar = pick(meta.avatar_url, meta.picture);
  return { displayName: pick(claims.global_name, meta.full_name, meta.name, meta.user_name), avatarUrl: avatar && /^https:\/\//.test(avatar) ? avatar : null };
}
