'use server';

// Server action to flip a character's exclude_from_stats / exclude_inventory
// flag from the owner's /me page. Owner = the signed-in user whose
// wolfpack_members.discord_id matches the target row's characters.discord_id.
// Service-role write is gated on that ownership check; we don't trust the
// client-supplied character name without verifying.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

type FlagKey = 'exclude_from_stats' | 'exclude_inventory' | 'tell_relay' | 'tell_dm';

export async function setCharacterExclusion(
  characterName: string,
  flag: FlagKey,
  value: boolean,
): Promise<{ ok: boolean; error?: string }> {
  // Auth — must be signed in.
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const admin = supabaseAdmin();

  // Resolve auth user -> linked discord_id.
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!pack?.discord_id) return { ok: false, error: 'no discord link' };

  // Verify the target character is actually owned by this discord_id.
  //
  // Ownership rule: the target row's discord_id matches yours, OR the target's
  // FAMILY ROOT (resolved via main_name) is yours. Alts very often have a NULL
  // or stale discord_id — the OpenDKP roster import only fills it reliably for
  // the main, and weekly roster syncs reset alt rows. Without the family-root
  // fallback, toggling Tells/Stats/Inventory on any alt silently fails (the UI
  // optimistically shows "ON" then never persists) while only the main works,
  // which is the exact symptom that left Canopy stuck OFF in production.
  const { data: target } = await admin
    .from('characters')
    .select('name, discord_id, main_name')
    .eq('guild_id', 'wolfpack')
    .ilike('name', characterName)
    .maybeSingle();
  if (!target) return { ok: false, error: 'unknown character' };
  let owned = target.discord_id === pack.discord_id;
  if (!owned && target.main_name && target.main_name !== target.name) {
    const { data: root } = await admin
      .from('characters')
      .select('discord_id')
      .eq('guild_id', 'wolfpack')
      .ilike('name', target.main_name)
      .maybeSingle();
    if (root?.discord_id === pack.discord_id) owned = true;
  }
  if (!owned) {
    return { ok: false, error: 'not your character' };
  }

  // Whitelist the column so a hostile caller can't drift the flag name.
  const allowed: FlagKey[] = ['exclude_from_stats', 'exclude_inventory', 'tell_relay', 'tell_dm'];
  if (!allowed.includes(flag)) return { ok: false, error: 'invalid flag' };

  const { error } = await admin
    .from('characters')
    .update({ [flag]: value })
    .eq('guild_id', 'wolfpack')
    .ilike('name', characterName);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/me');
  return { ok: true };
}
