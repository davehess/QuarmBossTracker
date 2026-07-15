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

export type StageMoveInput = {
  character: string;
  from: { page: number; button: number };
  to: { page: number; button: number };
};

// Move a macro to another slot (swap when the destination is occupied).
// Staged as ONE pending edit writing both slots in full — the agent's apply
// already treats value:null as "delete the key", so vacating the source is
// just seven null writes. NOTE for users: EQ hot-bar buttons reference
// socials BY SLOT, so a hot button pointing at a moved macro must be
// re-dragged in game — identical to the in-game behavior when you rearrange
// the socials window by hand.
export async function stageMacroMove(input: StageMoveInput): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const { discordId, owned } = await _ownedCharacterSet(user.id);
  if (!discordId) return { ok: false, error: 'no Discord link — ask an officer to link your characters' };

  const character = String(input.character || '').trim();
  if (!character || !owned.has(character.toLowerCase())) return { ok: false, error: 'not your character' };
  const fp = Math.trunc(Number(input.from?.page)), fb = Math.trunc(Number(input.from?.button));
  const tp = Math.trunc(Number(input.to?.page)),   tb = Math.trunc(Number(input.to?.button));
  for (const [p, b] of [[fp, fb], [tp, tb]] as const) {
    if (!(p >= 1 && p <= 10) || !(b >= 1 && b <= 12)) return { ok: false, error: 'slot out of range' };
  }
  if (fp === tp && fb === tb) return { ok: false, error: 'same slot' };

  const admin = supabaseAdmin();
  const { data: cells } = await admin
    .from('ui_socials_index')
    .select('page, button, name, color, lines')
    .eq('guild_id', 'wolfpack')
    .ilike('character', character)
    .or(`and(page.eq.${fp},button.eq.${fb}),and(page.eq.${tp},button.eq.${tb})`);
  type Cell = { page: number; button: number; name: string | null; color: number | null; lines: string[] };
  const src = ((cells ?? []) as Cell[]).find(c => c.page === fp && c.button === fb);
  const dst = ((cells ?? []) as Cell[]).find(c => c.page === tp && c.button === tb);
  if (!src) return { ok: false, error: 'source slot is empty (index may be stale — take a fresh UI Studio backup)' };

  // Full seven-key write per slot: Name, Color, Line1-5 (null deletes).
  const writeCell = (page: number, button: number, cell: Cell | null) => {
    const base = `Page${page}Button${button}`;
    const lines = cell && Array.isArray(cell.lines) ? cell.lines : [];
    const edits: { section: string; key: string; value: string | null }[] = [
      { section: 'Socials', key: `${base}Name`,  value: cell ? (cell.name ?? '') : null },
      { section: 'Socials', key: `${base}Color`, value: cell ? String(cell.color ?? 0) : null },
    ];
    for (let i = 0; i < 5; i++) {
      const v = lines[i] != null && lines[i] !== '' ? lines[i] : null;
      edits.push({ section: 'Socials', key: `${base}Line${i + 1}`, value: v });
    }
    return edits;
  };
  const edits = [...writeCell(tp, tb, src), ...writeCell(fp, fb, dst ?? null)];

  const label = src.name || '(unnamed)';
  const summary = dst
    ? `swap ${label} P${fp}B${fb} ⇄ ${dst.name || '(unnamed)'} P${tp}B${tb}`
    : `move ${label} P${fp}B${fb} → P${tp}B${tb}`;
  const { error } = await admin.from('ui_pending_edits').insert({
    guild_id: 'wolfpack',
    character,
    owner_discord_id: discordId,
    target_file: null,
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
