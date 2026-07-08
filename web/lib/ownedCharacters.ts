// Resolve the character names belonging to a signed-in user's ACCOUNT
// (household + OpenDKP family), mirroring /me's loadOwnedCharacters so the
// account-wide inventory page scopes to exactly the same set. Owner-private:
// only ever called for the signed-in user's own userId.

import { supabaseAdmin } from '@/lib/supabase';

export type OwnedChar = { name: string; main_name: string | null; class: string | null; active: boolean };

export async function ownedCharacters(userId: string): Promise<OwnedChar[]> {
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, merged_into_discord_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!pack?.discord_id) return [];

  const root = pack.merged_into_discord_id || pack.discord_id;
  const { data: aliases } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .or(`discord_id.eq.${root},merged_into_discord_id.eq.${root}`);
  const household = new Set(((aliases ?? []) as { discord_id: string }[]).map(r => r.discord_id).filter(Boolean));
  household.add(pack.discord_id);
  household.add(root);

  const { data: allChars } = await admin
    .from('characters')
    .select('name, main_name, class, active, discord_id')
    .eq('guild_id', 'wolfpack');
  const all = (allChars ?? []) as (OwnedChar & { discord_id: string | null })[];

  const anchored = all.filter(c => c.discord_id && household.has(c.discord_id));
  const roots = new Set(anchored.map(c => (c.main_name || c.name).toLowerCase()));
  if (roots.size === 0) return [];
  return all
    .filter(c => roots.has((c.main_name || c.name).toLowerCase()))
    .map(({ name, main_name, class: cls, active }) => ({ name, main_name, class: cls, active }))
    .sort((a, b) => (a.active === b.active ? 0 : a.active ? -1 : 1) || a.name.localeCompare(b.name));
}
