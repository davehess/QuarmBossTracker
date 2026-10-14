'use server';

// Save (or clear) how a character's name should sound. The page only shows the editor to the owner, but the
// page's answer is not trusted: this re-checks the signed-in user against the character before the
// service-role write. The alternates are recomputed here from the name, never taken from the client.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { GUILD_TAG } from '@/lib/guild';
import { ownerOfCharacter } from '@/lib/namePronunciation';
import { suggestPronunciations, validSay } from '@/lib/pronounce';

export async function savePronunciation(
  characterName: string,
  say: string,
): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  if (!/^[A-Za-z]{2,}$/.test(characterName)) return { ok: false, error: 'invalid character' };

  const owner = await ownerOfCharacter(user.id, characterName);
  if (!owner.ok) return { ok: false, error: owner.error };

  const lc = owner.displayName.toLowerCase();
  const admin = supabaseAdmin();
  const text = String(say ?? '').trim().replace(/\s+/g, ' ');

  // An empty box clears it: the voice goes back to reading the name as spelled.
  if (text === '') {
    const { error } = await admin.from('name_pronunciations').delete().eq('guild_id', GUILD_TAG).eq('character_lc', lc);
    if (error) return { ok: false, error: error.message };
  } else {
    if (!validSay(text)) return { ok: false, error: 'Use 1 to 60 letters, spaces, hyphens or apostrophes.' };
    const alternates = suggestPronunciations(owner.displayName).filter(s => s.toLowerCase() !== text.toLowerCase()).slice(0, 4);
    const { error } = await admin.from('name_pronunciations').upsert({
      guild_id: GUILD_TAG,
      character_lc: lc,
      display_name: owner.displayName,
      say: text,
      alternates,
      set_by_discord_id: owner.discordId,
      updated_at: new Date().toISOString(),
    }, { onConflict: 'guild_id,character_lc' });
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath(`/character/${encodeURIComponent(owner.displayName)}`);
  return { ok: true };
}
