// Server-side reads for a character's saved name pronunciation (table name_pronunciations, one row per
// guild + lower-cased character) and the ownership check that gates editing it. Used by the character page
// (to show the line and decide whether to hand over the editor) and by its save action (which asks again:
// the page's answer is never trusted). The pure helpers live in web/lib/pronounce.ts.

import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';

export type SavedPronunciation = { say: string; alternates: string[] };

/** The saved respelling for a character, or null (never throws: a missing table must not take the page down). */
export async function loadPronunciation(name: string): Promise<SavedPronunciation | null> {
  try {
    const { data } = await supabaseAdmin()
      .from('name_pronunciations')
      .select('say, alternates')
      .eq('guild_id', GUILD_TAG)
      .eq('character_lc', name.toLowerCase())
      .maybeSingle();
    if (!data?.say) return null;
    const alternates = Array.isArray(data.alternates) ? (data.alternates as unknown[]).filter((x): x is string => typeof x === 'string') : [];
    return { say: data.say as string, alternates };
  } catch {
    return null;
  }
}

/**
 * Does this signed-in user own the character? Same rule as the /me toggles: the character row's discord_id is
 * theirs, or its family root's is (alts often carry no discord_id of their own). Returns the owner's discord id
 * and the character's canonical spelling so the caller can write without a second lookup.
 */
export async function ownerOfCharacter(
  userId: string,
  name: string,
): Promise<{ ok: true; discordId: string; displayName: string } | { ok: false; error: string }> {
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!pack?.discord_id) return { ok: false, error: 'no discord link' };

  const { data: target } = await admin
    .from('characters')
    .select('name, discord_id, main_name')
    .eq('guild_id', GUILD_TAG)
    .ilike('name', name)
    .maybeSingle();
  if (!target) return { ok: false, error: 'unknown character' };

  let owned = target.discord_id === pack.discord_id;
  if (!owned && target.main_name && target.main_name !== target.name) {
    const { data: root } = await admin
      .from('characters')
      .select('discord_id')
      .eq('guild_id', GUILD_TAG)
      .ilike('name', target.main_name)
      .maybeSingle();
    owned = root?.discord_id === pack.discord_id;
  }
  if (!owned) return { ok: false, error: 'not your character' };
  return { ok: true, discordId: pack.discord_id as string, displayName: target.name as string };
}
