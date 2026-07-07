'use server';

// Server actions for /me/ui — stage + cancel macro edits. Edits land in
// ui_pending_edits; the owner's agent polls GET /api/agent/ui-pending-edits
// and applies them to the character's ini once they're logged out (EQ
// rewrites the ini from memory on /camp, so a live client would clobber).
//
// Ownership: the character must belong to the signed-in member's household
// (same household+family walk /me uses). Section allowlist: only [Socials]
// keys are ever written from the web — enforced here AND when the bot serves
// the rows to agents.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';

async function _ownedCharacterSet(userId: string): Promise<{ discordId: string | null; owned: Set<string> }> {
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, merged_into_discord_id')
    .eq('user_id', userId)
    .maybeSingle();
  if (!pack?.discord_id) return { discordId: null, owned: new Set() };
  const householdRoot = pack.merged_into_discord_id || pack.discord_id;
  const { data: aliases } = await admin
    .from('wolfpack_members')
    .select('discord_id')
    .or(`discord_id.eq.${householdRoot},merged_into_discord_id.eq.${householdRoot}`);
  const householdIds = new Set(((aliases ?? []) as { discord_id: string }[]).map(r => r.discord_id).filter(Boolean));
  householdIds.add(pack.discord_id);
  householdIds.add(householdRoot);
  const { data: allChars } = await admin
    .from('characters')
    .select('name, main_name, discord_id')
    .eq('guild_id', 'wolfpack');
  const all = (allChars ?? []) as { name: string; main_name: string | null; discord_id: string | null }[];
  const anchored = all.filter(c => c.discord_id && householdIds.has(c.discord_id));
  const familyRoots = new Set(anchored.map(c => (c.main_name || c.name).toLowerCase()));
  const owned = new Set(
    all.filter(c => familyRoots.has((c.main_name || c.name).toLowerCase())).map(c => c.name.toLowerCase())
  );
  return { discordId: pack.discord_id, owned };
}

export type StageMacroInput = {
  character: string;
  page: number;
  button: number;
  name: string;
  lines: string[];   // up to 5; blanks mean "no line"
};

export async function stageMacroEdit(input: StageMacroInput): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const { discordId, owned } = await _ownedCharacterSet(user.id);
  if (!discordId) return { ok: false, error: 'no Discord link — ask an officer to link your characters' };

  const character = String(input.character || '').trim();
  const page = Math.trunc(Number(input.page));
  const button = Math.trunc(Number(input.button));
  if (!character || !owned.has(character.toLowerCase())) return { ok: false, error: 'not your character' };
  if (!(page >= 1 && page <= 10) || !(button >= 1 && button <= 12)) return { ok: false, error: 'slot out of range' };
  // EQ social button labels are short; lines cap comfortably under EQ's limit.
  const name = String(input.name || '').slice(0, 16).trim();
  const lines = (Array.isArray(input.lines) ? input.lines : [])
    .slice(0, 5)
    .map(l => String(l ?? '').slice(0, 255));
  if (!name && !lines.some(l => l.trim())) return { ok: false, error: 'empty macro' };

  const admin = supabaseAdmin();
  // Diff against the indexed cell so the agent applies a minimal edit set —
  // and so clearing a line that existed on disk deletes the key (value null).
  const { data: curRows } = await admin
    .from('ui_socials_index')
    .select('name, color, lines')
    .eq('guild_id', 'wolfpack')
    .ilike('character', character)
    .eq('page', page)
    .eq('button', button)
    .limit(1);
  const cur = (curRows && curRows[0]) as { name: string | null; color: number | null; lines: string[] } | undefined;
  const curLines: string[] = cur && Array.isArray(cur.lines) ? cur.lines : [];

  const base = `Page${page}Button${button}`;
  const edits: { section: string; key: string; value: string | null }[] = [];
  if (!cur || (cur.name ?? '') !== name) edits.push({ section: 'Socials', key: `${base}Name`, value: name });
  if (!cur) edits.push({ section: 'Socials', key: `${base}Color`, value: '0' });
  for (let i = 0; i < 5; i++) {
    const want = (lines[i] ?? '').trim() === '' ? null : lines[i];
    const had = curLines[i] != null && curLines[i] !== '' ? curLines[i] : null;
    if (want === had) continue;
    if (want === null && had === null) continue;
    edits.push({ section: 'Socials', key: `${base}Line${i + 1}`, value: want });
  }
  if (edits.length === 0) return { ok: false, error: 'no changes' };

  const summary = `${name || '(unnamed)'} → Page ${page} · Button ${button}`;
  const { error } = await admin.from('ui_pending_edits').insert({
    guild_id: 'wolfpack',
    character,
    owner_discord_id: discordId,
    target_file: null,   // agent resolves <char>_pq.proj.ini
    edits,
    note: summary,
    status: 'pending',
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath('/me/ui');
  return { ok: true };
}

export async function cancelPendingEdit(id: number): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const { discordId } = await _ownedCharacterSet(user.id);
  if (!discordId) return { ok: false, error: 'no Discord link' };
  const admin = supabaseAdmin();
  const { error } = await admin
    .from('ui_pending_edits')
    .update({ status: 'cancelled' })
    .eq('id', id)
    .eq('owner_discord_id', discordId)
    .eq('status', 'pending');
  if (error) return { ok: false, error: error.message };
  revalidatePath('/me/ui');
  return { ok: true };
}
