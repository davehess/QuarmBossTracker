'use server';

// Server action to flip a character's exclude_from_stats / exclude_inventory
// flag from the owner's /me page. Owner = the signed-in user whose
// wolfpack_members.discord_id matches the target row's characters.discord_id.
// Service-role write is gated on that ownership check; we don't trust the
// client-supplied character name without verifying.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

type FlagKey = 'exclude_from_stats' | 'exclude_inventory';

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
  const { data: target } = await admin
    .from('characters')
    .select('name, discord_id')
    .eq('guild_id', 'wolfpack')
    .ilike('name', characterName)
    .maybeSingle();
  if (!target) return { ok: false, error: 'unknown character' };
  if (target.discord_id !== pack.discord_id) {
    return { ok: false, error: 'not your character' };
  }

  // Whitelist the column so a hostile caller can't drift the flag name.
  const allowed: FlagKey[] = ['exclude_from_stats', 'exclude_inventory'];
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
