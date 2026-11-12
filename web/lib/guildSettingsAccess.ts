// Who may open and save a guild's settings (the guild lead, 2026-11-12). Server only.
//
// Two ways in, nothing else: the owner or an officer of the guild in the registry (hub_memberships, the same test the invite
// and website actions use), or, for the built-in guild only (slug === GUILD_TAG), a site officer, the same people the
// /admin pages let in. A page hiding the form is a courtesy; the server action calls this again, because it is its own
// public POST endpoint.
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { GUILD_SLUG_RX } from '@/lib/hubRegistry';
import { canManageInvites, guildAccess } from '@/lib/hubGuilds';

export type SettingsActor = { discordId: string; name: string; via: 'hub' | 'site' };

/** The signed-in person as a settings editor for `slug`, or null (not signed in, not allowed, no such guild, suspended). */
export async function settingsActor(slug: string): Promise<SettingsActor | null> {
  if (!GUILD_SLUG_RX.test(slug)) return null;
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  if (!user || !discordId) return null;
  const admin = supabaseAdmin();
  try {
    const { data: guild } = await admin.from('hub_guilds').select('display_name, open_join, suspended_at').eq('guild_id', slug).maybeSingle();
    if (!guild || guild.suspended_at) return null;

    const { data: player } = await admin.from('hub_players').select('player_id, display_name').eq('discord_id', discordId).is('deleted_at', null).maybeSingle();
    if (player) {
      const { data: m } = await admin.from('hub_memberships').select('role, left_at').eq('guild_id', slug).eq('player_id', player.player_id).maybeSingle();
      const access = guildAccess(guild, m ?? null);
      if (access.kind === 'member' && canManageInvites(access.role)) {
        return { discordId, name: String(player.display_name || discordId), via: 'hub' };
      }
    }
    if (slug === GUILD_TAG && (await isOfficer(user.id))) {
      const { data: wp } = await admin.from('wolfpack_members').select('nickname, global_name').eq('user_id', user.id).maybeSingle();
      const w = wp as { nickname?: string | null; global_name?: string | null } | null;
      return { discordId, name: w?.nickname?.trim() || w?.global_name?.trim() || discordId, via: 'site' };
    }
  } catch { /* the registry is not applied here: nobody edits settings */ }
  return null;
}
