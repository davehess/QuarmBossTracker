// Server-side: may this signed-in user mark an LD on /fun as a /quit? The page
// uses it to decide whether to draw the button; the server action calls it again
// before it writes, so the button being hidden is never the only gate.
//
// Officer status is the same check every /admin page uses (isOfficer).
// Ownership is characters.discord_id on the card's character. Any failure reads as
// "no": a lookup error must never grant the override.

import { supabaseAdmin } from './supabase';
import { isOfficer } from './officer';
import { mayMarkQuit, viewerDiscordId } from './funLd';

export async function viewerMayMarkQuit(
  user: { id: string; app_metadata?: unknown; user_metadata?: unknown } | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  try {
    if (await isOfficer(user.id)) return true;
    const discordId = viewerDiscordId(user);
    if (!discordId) return false;
    const { data } = await supabaseAdmin()
      .from('characters')
      .select('discord_id')
      .eq('guild_id', 'wolfpack')
      .ilike('name', 'Peopleslayer');
    return mayMarkQuit({
      discordId,
      ownerDiscordIds: ((data ?? []) as { discord_id: string | null }[]).map(r => r.discord_id),
      officer: false,
    });
  } catch {
    return false;
  }
}
