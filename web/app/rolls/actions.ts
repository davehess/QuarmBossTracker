'use server';

// Officer corrections for captured roll sets (Hitya, 2026-08-12): "the 22 roll
// was a misfire, and the Shield of the Immaculate roll wasn't the right format.
// The rolls on that page should be officer editable or deletable."
//
// Writes land in roll_set_overrides, never on roll_sets. Those rows are
// per-uploader and agents upsert them, so an edit written there would be undone
// by the next observer's upload of the same set.
//
// The officer gate is HERE rather than in an RLS policy: roll_set_overrides is
// service-role-write only, so there is no client-reachable path that skips this
// check.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

type Key = { from: number; to: number; startedAt: string };

async function guard() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false as const, error: 'Not signed in.' };
  if (!(await isOfficer(user.id))) return { ok: false as const, error: 'Officers only.' };
  const name =
    (user.user_metadata?.full_name as string | undefined) ||
    (user.user_metadata?.name as string | undefined) || null;
  return { ok: true as const, discordId: (user.user_metadata?.provider_id as string) ?? null, name };
}

function validKey(k: Key) {
  return Number.isFinite(k?.from) && Number.isFinite(k?.to)
      && typeof k?.startedAt === 'string' && !Number.isNaN(Date.parse(k.startedAt));
}

async function upsert(k: Key, patch: Record<string, unknown>) {
  const g = await guard();
  if (!g.ok) return g;
  if (!validKey(k)) return { ok: false as const, error: 'Bad roll set.' };

  const { error } = await supabaseAdmin()
    .from('roll_set_overrides')
    .upsert({
      guild_id: 'wolfpack',
      roll_from: k.from,
      roll_to: k.to,
      started_at: k.startedAt,
      edited_by_discord_id: g.discordId,
      edited_by_name: g.name,
      updated_at: new Date().toISOString(),
      ...patch,
    }, { onConflict: 'guild_id,roll_from,roll_to,started_at' });

  if (error) return { ok: false as const, error: error.message };
  revalidatePath('/rolls');
  return { ok: true as const };
}

/** Name an unlabeled set, or correct a wrong capture. '' clears it back to unlabeled. */
export async function setRollItem(k: Key, item: string) {
  return upsert(k, { item: String(item ?? '').slice(0, 120) });
}

/**
 * Hide a misfire. Not a delete: the underlying rows stay (every observer's copy
 * of what was actually rolled is evidence), and officers still see hidden sets
 * so a wrong hide is reversible by the person who notices, not only by whoever
 * made it.
 */
export async function setRollHidden(k: Key, hidden: boolean) {
  return upsert(k, { hidden: !!hidden });
}
