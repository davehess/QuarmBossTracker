'use server';

// Officer-only spell-level seeding for the missing-spells page. Levels aren't
// in the eqemu mirror and PoP spells aren't scribable until the 2026-10-01
// unlock, so officers record the canonical scribe level here. Global per
// spell_id — set it once, every character's page picks it up. A real scribed
// level (from a guild spellbook upload) always overrides this seed.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

async function officerActor(): Promise<string | null> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user.email || user.id;
}

export async function setSpellLevel(
  spellId: number, level: number, characterForPath?: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await officerActor();
  if (!actor) return { ok: false, error: 'officers only' };
  const id = Number(spellId);
  const lvl = Math.round(Number(level));
  if (!Number.isFinite(id) || id <= 0) return { ok: false, error: 'bad spell id' };
  if (!Number.isFinite(lvl) || lvl < 1 || lvl > 75) return { ok: false, error: 'level must be 1–75' };

  const { error } = await supabaseAdmin()
    .from('spell_level_seed')
    .upsert({ spell_id: id, level: lvl, source: 'officer', updated_by: actor, updated_at: new Date().toISOString() },
      { onConflict: 'spell_id' });
  if (error) return { ok: false, error: error.message };
  if (characterForPath) revalidatePath(`/character/${encodeURIComponent(characterForPath)}/spells`);
  return { ok: true };
}

export async function clearSpellLevel(
  spellId: number, characterForPath?: string,
): Promise<{ ok: boolean; error?: string }> {
  const actor = await officerActor();
  if (!actor) return { ok: false, error: 'officers only' };
  const { error } = await supabaseAdmin().from('spell_level_seed').delete().eq('spell_id', Number(spellId));
  if (error) return { ok: false, error: error.message };
  if (characterForPath) revalidatePath(`/character/${encodeURIComponent(characterForPath)}/spells`);
  return { ok: true };
}
