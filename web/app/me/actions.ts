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

// Bulk-flip a single flag across every character the signed-in user owns
// (direct discord_id match OR family-root match). Built for /me/tells so a
// 50+-character user can opt every alt in/out in one click instead of toggling
// each one on /me. Returns the count of rows that actually changed so the UI
// can render a precise "Enabled tells on N characters" confirmation.
export async function bulkSetCharacterFlag(
  flag: 'exclude_from_stats' | 'exclude_inventory' | 'tell_relay' | 'tell_dm',
  value: boolean,
): Promise<{ ok: boolean; changed?: number; total?: number; error?: string }> {
  const supabase = supabaseServer();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!pack?.discord_id) return { ok: false, error: 'no discord link' };

  // Whitelist the column name before we interpolate it into a select string,
  // so a hostile caller can't drift the flag through the type system. The
  // `Flag` type already enforces this at compile time; the runtime check is
  // belt-and-suspenders for the dynamic select string.
  const allowed = ['exclude_from_stats', 'exclude_inventory', 'tell_relay', 'tell_dm'] as const;
  if (!allowed.includes(flag)) return { ok: false, error: 'invalid flag' };
  const selectCols = `name, main_name, ${flag}`;

  // Resolve every character the user can own: rows whose discord_id is theirs,
  // PLUS rows whose main_name is one of their direct chars (covers the unlinked
  // alts the family-root fallback would also accept).
  const { data: direct } = await admin
    .from('characters')
    .select(selectCols)
    .eq('guild_id', 'wolfpack')
    .eq('discord_id', pack.discord_id);
  const directRows = (direct ?? []) as unknown as Record<string, unknown>[];
  const myMainNames = new Set(directRows.map(r => r.name as string));
  const { data: alts } = myMainNames.size > 0
    ? await admin
        .from('characters')
        .select(selectCols)
        .eq('guild_id', 'wolfpack')
        .in('main_name', [...myMainNames])
    : { data: [] as Record<string, unknown>[] };

  const byName = new Map<string, { name: string; current: boolean }>();
  for (const r of directRows) {
    const name = r.name as string;
    byName.set(name.toLowerCase(), { name, current: !!r[flag] });
  }
  for (const r of (alts ?? []) as unknown as Record<string, unknown>[]) {
    const name = r.name as string;
    if (!byName.has(name.toLowerCase())) byName.set(name.toLowerCase(), { name, current: !!r[flag] });
  }
  const targets = [...byName.values()].filter(c => c.current !== value).map(c => c.name);
  const total   = byName.size;
  if (targets.length === 0) {
    revalidatePath('/me');
    revalidatePath('/me/tells');
    return { ok: true, changed: 0, total };
  }

  // Bulk update — PostgREST in() is case-sensitive but we have canonical names.
  const inList = '(' + targets.map(n => `"${n.replace(/"/g, '')}"`).join(',') + ')';
  const { error } = await admin
    .from('characters')
    .update({ [flag]: value })
    .eq('guild_id', 'wolfpack')
    .filter('name', 'in', inList);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/me');
  revalidatePath('/me/tells');
  return { ok: true, changed: targets.length, total };
}
