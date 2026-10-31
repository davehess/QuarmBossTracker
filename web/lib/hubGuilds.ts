// Starting a guild and inviting people to it: the rules half (the guild lead, 2026-10-31, DECISIONS §492 and
// docs/DESIGN-raidmimic-hosted.md §4 wizard steps 2 and 3). Tables: hub_guilds, hub_memberships, hub_invites
// (supabase/migrations/20261023160000_open_hub_registry.sql and 20261031150000_hub_registry_discord_guild.sql).
//
// Pure: no database, no framework, nothing from the `@/` alias and no node-only import, so the form (a browser
// component) derives its slug with the same function the server checks it with, and a test runs every rule directly.
// The callers that touch the database are web/app/guilds/new/actions.ts and web/app/guilds/[slug]/actions.ts.
import { GUILD_SLUG_RX } from './hubRegistry';
import { GUILD_TAG } from './guild';

// ── The guild's name and slug ───────────────────────────────────────────────────────────────────────────────
export const NAME_MIN = 3;
export const NAME_MAX = 40;
export const SLUG_MIN = 3;
export const SLUG_MAX = 24;

// The slug is the registry's primary key and the address /guilds/<slug>. 'wolfpack' is Wolf Pack's own tag (the table's
// check constraint refuses it); 'new' would be shadowed by the /guilds/new page, so a guild of that name could never be opened.
// Wolf Pack's tag is read from the guild module (GUILD_TAG, whose default is that word) so no second copy of it is spelled out here.
export const RESERVED_SLUGS: readonly string[] = [GUILD_TAG, 'new'];

// The Discord server id is a snowflake: the registry's check constraint is five to twenty-five digits.
export const DISCORD_GUILD_ID_RX = /^[0-9]{5,25}$/;

/** A slug offered from a display name: lower case, runs of anything else become one dash, trimmed to the registry's length. */
export function slugFromName(name: unknown): string {
  return String(name ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')   // "Café" -> "Cafe"
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, SLUG_MAX)
    .replace(/-+$/g, '');
}

/** A display name as stored: one line, single spaces. */
export function cleanDisplayName(raw: unknown): string {
  // eslint-disable-next-line no-control-regex
  return String(raw ?? '').replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
}

export type GuildInput = { displayName?: unknown; slug?: unknown; discordGuildId?: unknown; openJoin?: unknown };
export type GuildFields = 'displayName' | 'slug' | 'discordGuildId';
export type GuildValues = { displayName: string; slug: string; discordGuildId: string | null; openJoin: boolean };
export type GuildCheck = { ok: true; values: GuildValues } | { ok: false; errors: Partial<Record<GuildFields, string>> };

export const GUILD_MESSAGES = {
  nameLength: `A guild name is ${NAME_MIN} to ${NAME_MAX} characters.`,
  slugShape: `The address is ${SLUG_MIN} to ${SLUG_MAX} letters, numbers and dashes, and starts and ends with a letter or number.`,
  slugReserved: 'That address is reserved. Pick another.',
  slugTaken: 'That address is already taken. Pick another.',
  discordShape: 'A Discord server id is 5 to 25 digits. Leave it empty to add it later.',
  discordTaken: 'That Discord server already belongs to another guild here.',
} as const;

/** Shape rules only; whether the slug is free is the database's answer (createGuild). */
export function validateGuildInput(input: GuildInput): GuildCheck {
  const errors: Partial<Record<GuildFields, string>> = {};
  const displayName = cleanDisplayName(input.displayName);
  if (displayName.length < NAME_MIN || displayName.length > NAME_MAX) errors.displayName = GUILD_MESSAGES.nameLength;

  const slug = String(input.slug ?? '').trim().toLowerCase();
  if (!GUILD_SLUG_RX.test(slug)) errors.slug = GUILD_MESSAGES.slugShape;
  else if (RESERVED_SLUGS.includes(slug)) errors.slug = GUILD_MESSAGES.slugReserved;

  const rawDiscord = String(input.discordGuildId ?? '').trim();
  const discordGuildId = rawDiscord === '' ? null : rawDiscord;
  if (discordGuildId !== null && !DISCORD_GUILD_ID_RX.test(discordGuildId)) errors.discordGuildId = GUILD_MESSAGES.discordShape;

  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, values: { displayName, slug, discordGuildId, openJoin: input.openJoin === true } };
}

// One guild creation per player per day (counted from hub_guilds.created_by, so it holds across server instances).
export const CREATE_WINDOW_MS = 24 * 60 * 60_000;
export const CREATE_LIMIT = 1;

// ── Roles ───────────────────────────────────────────────────────────────────────────────────────────────────
export const ROLE_LABEL: Record<string, string> = { owner: 'Owner', officer: 'Officer', member: 'Member', guest: 'Guest' };

/** Owners and officers run a guild's invites; members and guests do not see them. */
export function canManageInvites(role: string | null | undefined): boolean {
  return role === 'owner' || role === 'officer';
}

// ── Who may open /guilds/<slug> ─────────────────────────────────────────────────────────────────────────────
export type GuildPageGuild = { display_name: string; open_join: boolean | null; suspended_at: string | null };
export type GuildPageMembership = { role: string; left_at: string | null };
export type GuildAccess =
  | { kind: 'member'; role: string }
  | { kind: 'visitor' }            // not a member of an open_join guild: its display name and nothing else
  | { kind: 'hidden' };            // no such guild, a suspended one, or a closed one the player is not in: a 404

/**
 * A suspended or missing guild is a 404 to everyone. A closed guild is a 404 to anyone who is not in it, so the page
 * never confirms it exists; an open_join guild is not secret (anyone signed in may join it), so a non-member sees its name.
 * `open_join` must be strictly true to count, like the Find-my-guilds split.
 */
export function guildAccess(guild: GuildPageGuild | null | undefined, membership: GuildPageMembership | null | undefined): GuildAccess {
  if (!guild || guild.suspended_at) return { kind: 'hidden' };
  if (membership && !membership.left_at) return { kind: 'member', role: membership.role };
  return guild.open_join === true ? { kind: 'visitor' } : { kind: 'hidden' };
}

// ── Invite codes ────────────────────────────────────────────────────────────────────────────────────────────
// The hub_invites check constraint is ^[A-HJKMNP-Z2-9]{6}$: no 0 O 1 I L. 8 + 1 + 1 + 1 + 1 + 11 + 8 = 31 characters.
export const INVITE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const INVITE_LENGTH = 6;
export const INVITE_MAX_USES = 25;
export const INVITE_TTL_MS = 7 * 24 * 60 * 60_000;
// A guild keeps this many live codes at once, so the table cannot be filled by a button held down.
export const INVITE_ACTIVE_CAP = 10;

/** `fill` is crypto.getRandomValues by default; a test hands in a fixed one. Bytes past the last whole multiple of 31 are skipped, so no letter is likelier. */
export function generateInviteCode(fill: (bytes: Uint8Array) => Uint8Array = (b) => globalThis.crypto.getRandomValues(b)): string {
  const limit = 256 - (256 % INVITE_ALPHABET.length);
  let out = '';
  while (out.length < INVITE_LENGTH) {
    for (const byte of fill(new Uint8Array(16))) {
      if (byte < limit && out.length < INVITE_LENGTH) out += INVITE_ALPHABET[byte % INVITE_ALPHABET.length];
    }
  }
  return out;
}

export type NewInvite = { code: string; guild_id: string; created_by: string; expires_at: string; max_uses: number };

/** The row for a fresh code: 25 uses, seven days. */
export function newInviteRow(guildId: string, playerId: string, now: Date = new Date(), code: string = generateInviteCode()): NewInvite {
  return { code, guild_id: guildId, created_by: playerId, expires_at: new Date(now.getTime() + INVITE_TTL_MS).toISOString(), max_uses: INVITE_MAX_USES };
}

export type InviteListRow = { code: string; uses: number; max_uses: number; expires_at: string };

/** A code that can still be redeemed: not expired (the instant of expiry is expired) and with a use left. Revoking sets expires_at to now, so it drops out here. */
export function inviteIsActive(inv: Pick<InviteListRow, 'uses' | 'max_uses' | 'expires_at'>, now: Date = new Date()): boolean {
  const expires = Date.parse(inv.expires_at);
  return Number.isFinite(expires) && expires > now.getTime() && inv.uses < inv.max_uses;
}

/** The codes the Invites section lists: active ones, the one that expires last first. */
export function activeInvites<T extends InviteListRow>(rows: readonly T[], now: Date = new Date()): T[] {
  return rows.filter(r => inviteIsActive(r, now)).sort((a, b) => Date.parse(b.expires_at) - Date.parse(a.expires_at));
}
