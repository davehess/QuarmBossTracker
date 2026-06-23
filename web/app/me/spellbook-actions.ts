'use server';

// Spellbook upload. EQ outputs:
//   Index <tab> SpellId <tab> Level <tab> Name
// SpellId joins eqemu_spells.id directly so the downstream "who needs this
// spell we have" admin view (Uilnayar 2026-06-23) joins exactly.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

type ParsedSpell = { spell_id: number; spell_name: string; spell_level: number | null };

export function parseSpellbook(text: string): ParsedSpell[] {
  const out: ParsedSpell[] = [];
  const seen = new Set<number>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    let cols = line.split('\t');
    if (cols.length < 4) cols = line.split(/\s{2,}/);
    if (cols.length < 4) continue;
    const [, idStr, lvlStr, ...nameParts] = cols.map(c => c.trim());
    // Header: 'Index', 'SpellId', 'Level', 'Name'
    if (/^spellid$/i.test(idStr)) continue;
    const id = parseInt(idStr, 10);
    if (!Number.isFinite(id) || id <= 0) continue;
    const name = nameParts.join(' ').trim();
    if (!name) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    const lvl = parseInt(lvlStr, 10);
    out.push({
      spell_id: id,
      spell_name: name.slice(0, 96),
      spell_level: Number.isFinite(lvl) ? lvl : null,
    });
  }
  return out;
}

async function ownsOrOfficer(characterName: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  if (await isOfficer(user.id)) return { ok: true };
  const admin = supabaseAdmin();
  const [{ data: me }, { data: ch }] = await Promise.all([
    admin.from('wolfpack_members').select('discord_id').eq('user_id', user.id).maybeSingle(),
    admin.from('characters').select('discord_id').eq('guild_id', 'wolfpack').ilike('name', characterName).maybeSingle(),
  ]);
  if (me?.discord_id && ch?.discord_id && me.discord_id === ch.discord_id) return { ok: true };
  return { ok: false, error: 'not your character' };
}

export async function uploadSpellbook(characterName: string, rawText: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const name = (characterName || '').trim();
  if (!/^[A-Za-z]{2,}$/.test(name)) return { ok: false, error: 'invalid character name' };
  const gate = await ownsOrOfficer(name);
  if (!gate.ok) return { ok: false, error: gate.error };

  const spells = parseSpellbook(rawText || '');
  if (spells.length === 0) return { ok: false, error: 'no spells parsed — expected tab-separated Index/SpellId/Level/Name' };

  const admin = supabaseAdmin();
  const { data: ch } = await admin
    .from('characters').select('name').eq('guild_id', 'wolfpack').ilike('name', name).maybeSingle();
  const canonical = ch?.name || name;

  await admin.from('character_spellbook')
    .delete().eq('guild_id', 'wolfpack').ilike('character_name', canonical);

  const now = new Date().toISOString();
  const rows = spells.map(s => ({
    guild_id: 'wolfpack',
    character_name: canonical,
    spell_id: s.spell_id,
    spell_name: s.spell_name,
    spell_level: s.spell_level,
    observed_at: now,
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { error } = await admin.from('character_spellbook').insert(rows.slice(i, i + 500));
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/me');
  return { ok: true, count: rows.length };
}
