'use server';

// Officer-only spell-level seeding for the missing-spells page. Levels aren't
// in the eqemu mirror, and few guild spellbooks held PoP spells before the
// 2026-10-01 unlock, so officers record the canonical scribe level here. Global per
// spell_id — set it once, every character's page picks it up. A real scribed
// level (from a guild spellbook upload) always overrides this seed.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { actorName } from '@/lib/actorName';
import { GUILD_TAG } from '@/lib/guild';
import { validateClassRace } from '@/lib/characterClass';

async function officerActor(): Promise<string | null> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return actorName(user);
}

// Officer correction of a character's class (and optionally race), for when OpenDKP has it as UNKNOWN (the guild
// lead, 2026-11-03). Writes our `characters` row only: the OpenDKP sync no longer overwrites a known value with
// an unknown one, but OpenDKP itself is not edited from here (no captured "edit character" request yet).
export async function setCharacterClass(
  characterName: string, rawClass: string, rawRace: string,
): Promise<{ ok: boolean; error?: string; message?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) return { ok: false, error: 'officers only' };
  const v = validateClassRace(rawClass, rawRace);
  if (!v.ok) return { ok: false, error: v.error };
  if (!/^[A-Za-z]{2,}$/.test(String(characterName))) return { ok: false, error: 'bad character name' };

  const admin = supabaseAdmin();
  const { data: row } = await admin.from('characters')
    .select('name, class, race, opendkp_id')
    .eq('guild_id', GUILD_TAG).ilike('name', characterName).limit(1).maybeSingle();
  if (!row) return { ok: false, error: 'character not found' };

  const patch: Record<string, string> = { class: v.cls };
  if (v.race) patch.race = v.race;
  const { error } = await admin.from('characters').update(patch)
    .eq('guild_id', GUILD_TAG).eq('name', row.name);
  if (error) return { ok: false, error: error.message };

  const { data: me } = await admin.from('wolfpack_members')
    .select('discord_id').eq('user_id', user.id).maybeSingle();
  await admin.from('audit_log').insert({
    guild_id:         GUILD_TAG,
    action:           'character_class_set',
    actor_discord_id: me?.discord_id ? String(me.discord_id) : null,
    actor_name:       actorName(user),
    payload: {
      name: row.name,
      from: { class: row.class ?? null, race: row.race ?? null },
      to:   { class: v.cls, race: v.race ?? row.race ?? null },
      source: 'officer',
    },
  });

  revalidatePath(`/character/${encodeURIComponent(row.name)}/spells`);
  revalidatePath(`/character/${encodeURIComponent(row.name)}`);
  return {
    ok: true,
    message: row.opendkp_id != null
      ? 'Saved. OpenDKP is not changed by this, so it may still show the old class there.'
      : 'Saved.',
  };
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
