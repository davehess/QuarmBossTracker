// The guilds a signed-in player is in, shared by the /guilds page and the raidmimic landing's signed-in home previews so the
// two never read it two ways. Keyed on the Discord id taken from the session, never from a request. Every read fails soft to
// "none": the hub_* tables may not exist on a database the registry has not been applied to.
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_NAME, GUILD_TAG } from '@/lib/guild';
import { builtinGuildSite, cleanSiteUrl } from '@/lib/guildSites';
import { toHomeGuilds, type HomeGuild } from '@/lib/raidmimicHome';

export type HubCard = { guild_id: string; name: string; role: string; joined_at: string | null; site: string | null; redirect: boolean };
export type WolfCard = { name: string; characters: number };

export async function loadWolfPack(discordId: string): Promise<WolfCard | null> {
  try {
    const admin = supabaseAdmin();
    const { data: member } = await admin.from('wolfpack_members').select('discord_id, is_member').eq('discord_id', discordId).maybeSingle();
    if (!member?.is_member) return null;
    const { count } = await admin.from('characters').select('name', { count: 'exact', head: true })
      .eq('guild_id', GUILD_TAG).eq('discord_id', discordId);
    return { name: GUILD_NAME, characters: count ?? 0 };
  } catch {
    return null;
  }
}

export async function loadHubGuilds(discordId: string): Promise<HubCard[]> {
  try {
    const admin = supabaseAdmin();
    const { data: player } = await admin.from('hub_players').select('player_id').eq('discord_id', discordId).is('deleted_at', null).maybeSingle();
    if (!player) return [];
    const { data: mine, error } = await admin.from('hub_memberships').select('guild_id, role, joined_at').eq('player_id', player.player_id).is('left_at', null);
    if (error || !mine?.length) return [];
    const { data: guilds } = await admin.from('hub_guilds').select('guild_id, display_name, website_url, redirect_members').in('guild_id', mine.map(m => m.guild_id)).is('suspended_at', null);
    const byId = new Map((guilds ?? []).map(g => [g.guild_id as string, g]));
    return mine
      .filter(m => byId.has(m.guild_id))
      .map(m => {
        const g = byId.get(m.guild_id)!;
        // The site was validated on the way in; cleaning it again keeps a hand-edited row from becoming a redirect.
        return { guild_id: m.guild_id, name: g.display_name as string, role: m.role, joined_at: m.joined_at ?? null,
          site: cleanSiteUrl(g.website_url), redirect: g.redirect_members !== false };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
  } catch {
    return [];
  }
}

/** The home previews' guild list: the same two reads the /guilds page makes. */
export async function loadHomeGuilds(discordId: string): Promise<HomeGuild[]> {
  const [wolf, hub] = await Promise.all([loadWolfPack(discordId), loadHubGuilds(discordId)]);
  return toHomeGuilds(wolf ? { key: GUILD_TAG, name: wolf.name } : null, hub, builtinGuildSite().url);
}
