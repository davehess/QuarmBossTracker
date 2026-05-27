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
