'use server';

// Tick or untick one PoP guide item for one of YOUR characters (the guild lead, 2026-09-28:
// "Make this a checkbox type of thing"). Owner-only: the character must be in the signed-in
// member's household + family (ownedCharacters, the same walk /me and /pop use). The item key
// must be one the guide defines, so the table can never fill with junk. Items ticked by a
// recorded PoP flag are never written here.

import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { GUIDE_KEYS } from '@/lib/popGuide';

export async function setGuideTick(character: string, itemKey: string, ticked: boolean): Promise<{ ok: boolean; error?: string }> {
  if (typeof character !== 'string' || typeof itemKey !== 'string' || typeof ticked !== 'boolean') {
    return { ok: false, error: 'bad request' };
  }
  if (!GUIDE_KEYS.has(itemKey)) return { ok: false, error: 'unknown item' };

  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const owned = (await ownedCharacters(user.id)).find(c => c.name.toLowerCase() === character.toLowerCase());
  if (!owned) return { ok: false, error: 'not your character' };

  const admin = supabaseAdmin();
  if (ticked) {
    const { data: me } = await admin.from('wolfpack_members').select('discord_id').eq('user_id', user.id).maybeSingle();
    const { error } = await admin.from('pop_guide_ticks').upsert(
      { guild_id: 'wolfpack', character_name: owned.name, item_key: itemKey,
        ticked_at: new Date().toISOString(), ticked_by: me?.discord_id ?? null },
      { onConflict: 'guild_id,character_name,item_key' },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from('pop_guide_ticks').delete()
      .eq('guild_id', 'wolfpack').eq('character_name', owned.name).eq('item_key', itemKey);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
