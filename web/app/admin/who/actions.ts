'use server';

// Server actions for the /admin/who directory: officer-set class + Zek flag
// overrides, written to who_overrides (service role). Both verify the caller is
// an officer before touching the DB — the /admin layout already gates the page,
// but actions can be invoked directly so we re-check here.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { BASE_CLASSES } from './classes';

async function officerIdentity(): Promise<{ id: string; name: string } | null> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  // Best-effort display name from the member cache.
  let name = user.email || user.id;
  try {
    const admin = supabaseAdmin();
    const { data } = await admin
      .from('wolfpack_members')
      .select('nickname, discord_id')
      .eq('user_id', user.id)
      .maybeSingle();
    if (data?.nickname) name = data.nickname;
  } catch { /* fall back to email/id */ }
  return { id: user.id, name };
}

// Upsert a single override row, merging the requested field over whatever's
// already stored. Returns the effective row state for optimistic UI.
async function upsertOverride(
  character: string,
  patch: { class?: string | null; is_zek?: boolean | null },
): Promise<{ ok: boolean; error?: string }> {
  const who = await officerIdentity();
  if (!who) return { ok: false, error: 'officer access required' };
  const name = String(character || '').trim();
  if (!name) return { ok: false, error: 'character required' };

  const admin = supabaseAdmin();
  // Read existing so we only overwrite the field(s) in the patch.
  const { data: existing } = await admin
    .from('who_overrides')
    .select('class, is_zek, note')
    .eq('guild_id', 'wolfpack')
    .eq('character', name)
    .maybeSingle();

  const row = {
    guild_id: 'wolfpack',
    character: name,
    class: 'class' in patch ? patch.class : (existing?.class ?? null),
    is_zek: 'is_zek' in patch ? patch.is_zek : (existing?.is_zek ?? null),
    note: existing?.note ?? null,
    set_by: who.id,
    set_by_name: who.name,
    updated_at: new Date().toISOString(),
  };

  const { error } = await admin
    .from('who_overrides')
    .upsert(row, { onConflict: 'guild_id,character' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/admin/who');
  return { ok: true };
}

export async function setWhoClass(
  character: string,
  klass: string | null,
): Promise<{ ok: boolean; error?: string }> {
  // null/'' clears the override (falls back to observed class).
  const clean = klass && (BASE_CLASSES as readonly string[]).includes(klass) ? klass : null;
  if (klass && !clean) return { ok: false, error: 'unknown class' };
  return upsertOverride(character, { class: clean });
}

export async function setWhoZek(
  character: string,
  isZek: boolean | null,
): Promise<{ ok: boolean; error?: string }> {
  // true = flag Zek, false = explicitly not-Zek, null = unset (auto from guild).
  return upsertOverride(character, { is_zek: isZek });
}
