// Discord API helper — narrow surface area, only the bits we need for the
// guild-membership check on OAuth callback.
//
// Uses the user's own OAuth access token (provider_token from Supabase
// session) rather than the bot token, so we don't need to share the bot
// token with Vercel. Requires the user to have granted the
// `guilds.members.read` scope at sign-in (configured in SignInButton).

const GUILD_ID = process.env.DISCORD_GUILD_ID || '1168893924329402420';

export interface GuildMember {
  nick: string | null;        // server nickname, or null if they haven't set one
  user: { id: string; username: string; global_name: string | null; avatar: string | null };
  roles: string[];            // role IDs (not names — name resolution would need bot token)
  joined_at: string;          // ISO timestamp
  avatar: string | null;      // server-specific avatar hash (overrides global)
}

export async function fetchGuildMember(accessToken: string): Promise<GuildMember | null> {
  const res = await fetch(
    `https://discord.com/api/v10/users/@me/guilds/${GUILD_ID}/member`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );

  if (res.status === 404) return null;       // user is not in the guild
  if (res.status === 401) return null;       // token expired / scope missing
  if (!res.ok) throw new Error(`Discord API error ${res.status}: ${await res.text()}`);

  return (await res.json()) as GuildMember;
}

// The ids of every Discord server the token's owner is in (raidmimic.com "Find my guilds", DECISIONS §492). Needs the
// `guilds` scope, which only that optional second sign-in asks for. IDS ONLY: the names, icons and permissions Discord
// sends back are dropped here, so nothing past this call can store or show more than the id. Discord returns up to 200
// servers a page; five pages is 1,000, far past what Discord lets an account join.
// null = the token was refused (expired, or the scope was not granted).
export async function fetchUserGuilds(accessToken: string): Promise<string[] | null> {
  const rows = await fetchGuildRows(accessToken);
  return rows ? rows.map(r => r.id) : null;
}

// The ids of the Discord servers the token's owner can MANAGE: owner, or the MANAGE_GUILD permission bit (0x20). This is
// what proves a person may register a server as a guild (web/lib/hubManage.ts). Ids only, like fetchUserGuilds.
export async function fetchManagedGuildIds(accessToken: string): Promise<string[] | null> {
  const rows = await fetchGuildRows(accessToken);
  return rows ? rows.filter(r => managesServer(r)).map(r => r.id) : null;
}

const MANAGE_GUILD_BIT = BigInt(0x20);

/** Owner, or MANAGE_GUILD in the `permissions` string Discord returns (a decimal bitfield, too large for a number). */
export function managesServer(g: { owner?: unknown; permissions?: unknown }): boolean {
  if (g.owner === true) return true;
  if (typeof g.permissions !== 'string' || !/^\d{1,20}$/.test(g.permissions)) return false;
  return (BigInt(g.permissions) & MANAGE_GUILD_BIT) !== BigInt(0);
}

type GuildRow = { id: string; owner?: unknown; permissions?: unknown };

async function fetchGuildRows(accessToken: string): Promise<GuildRow[] | null> {
  const out: GuildRow[] = [];
  let after = '';
  for (let page = 0; page < 5; page++) {
    const res = await fetch(
      `https://discord.com/api/v10/users/@me/guilds?limit=200${after ? `&after=${after}` : ''}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (res.status === 401 || res.status === 403) return null;
    if (!res.ok) throw new Error(`Discord API error ${res.status}`);
    const rows = (await res.json()) as { id?: unknown; owner?: unknown; permissions?: unknown }[];
    for (const r of rows) if (typeof r?.id === 'string') out.push({ id: r.id, owner: r.owner, permissions: r.permissions });
    if (rows.length < 200) break;
    after = String(rows[rows.length - 1]?.id ?? '');
    if (!after) break;
  }
  return out;
}

// Build a usable avatar URL from a member object — preferring the
// guild-specific avatar over the global one.
export function memberAvatarUrl(member: GuildMember): string | null {
  if (member.avatar) {
    return `https://cdn.discordapp.com/guilds/${GUILD_ID}/users/${member.user.id}/avatars/${member.avatar}.png?size=64`;
  }
  if (member.user.avatar) {
    return `https://cdn.discordapp.com/avatars/${member.user.id}/${member.user.avatar}.png?size=64`;
  }
  return null;
}

// Server nickname → global name → username, in order of preference.
export function memberDisplayName(member: GuildMember): string {
  return member.nick || member.user.global_name || member.user.username;
}
