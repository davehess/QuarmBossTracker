'use server';

// The two irreversible moves on /admin/encounters (the guild lead, 2026-10-31, DECISIONS §493): hard-deleting an
// encounter and folding a duplicate cluster into one row. They moved out of page.tsx so each can check a typed phrase
// on the server before it touches anything (lib/adminTyped.ts): the encounter's boss name for a delete, MERGE for a
// merge. The page shows the phrase; a hand-built POST with the wrong one is refused here, with nothing written.
// What each does once confirmed is exactly what it did before.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { MERGE_PHRASE, encounterPhrase, typedConfirmOk } from '@/lib/adminTyped';

async function officerOrBounce() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');
}

const refused = (): never => redirect('/admin/encounters?danger=wrong-phrase#danger');

// Merge a duplicate cluster into one target in a single action. Accepts either
// `sources` (comma-separated ids, for cluster merges) or a single `source` (for
// backward-compatible pairwise forms). We move every source's contributions
// onto the target and delete the sources — FK cascade clears their now-stale
// encounter_players / combat_rollup — then rebuild the target from the combined
// contributions: merge_encounter_players() fully recomputes encounter_players
// (max damage per player) and totals, so there's no need to hand-move player
// rows or untangle PK collisions.
export async function mergeEncounters(formData: FormData): Promise<void> {
  await officerOrBounce();
  if (!typedConfirmOk(formData.get('confirm'), MERGE_PHRASE)) return refused();
  const target = String(formData.get('target') || '');
  const raw = String(formData.get('sources') || formData.get('source') || '');
  const sources = raw.split(',').map(s => s.trim()).filter(s => s && s !== target);
  if (!target || sources.length === 0) return;
  const admin = supabaseAdmin();

  await admin.from('contributions').update({ encounter_id: target }).in('encounter_id', sources);
  await admin.from('encounters').delete().in('id', sources);
  try { await admin.rpc('merge_encounter_players', { p_encounter_id: target }); } catch {}

  revalidatePath('/admin/encounters');
}

// Hard-delete an encounter and all child rows. Used to remove ghost
// encounters: a trash mob mis-classified as a boss, an aborted pull that
// never resolved, etc. We delete children first (contributions,
// encounter_players, encounter_combat_rollup) and then the encounter row.
// combat_events isn't populated yet so we don't bother. Idempotent.
//
// The phrase is the boss name AS THE PAGE SHOWS IT, re-derived here from the row and the catalog rather than read from
// the form, so the form cannot supply its own answer.
export async function deleteEncounter(formData: FormData): Promise<void> {
  await officerOrBounce();
  const id = String(formData.get('id') || '');
  if (!id) return;
  const admin = supabaseAdmin();
  const { data: enc } = await admin.from('encounters').select('npc_id').eq('id', id).maybeSingle();
  if (!enc) return;   // already gone: the delete is idempotent, and there is nothing to confirm
  const npcId = (enc as { npc_id: number | null }).npc_id;
  let name: string | null = null;
  if (npcId != null) {
    const { data: npc } = await admin.from('eqemu_npc_types').select('name').eq('id', npcId).maybeSingle();
    name = (npc as { name: string | null } | null)?.name ?? null;
  }
  if (!typedConfirmOk(formData.get('confirm'), encounterPhrase(name, npcId))) return refused();
  await admin.from('encounter_players').delete().eq('encounter_id', id);
  await admin.from('contributions').delete().eq('encounter_id', id);
  // Best-effort on optional child tables — table may not exist in older
  // deployments; the catch swallows the error so the encounter still goes.
  try { await admin.from('encounter_combat_rollup').delete().eq('encounter_id', id); } catch {}
  try { await admin.from('combat_events').delete().eq('encounter_id', id); } catch {}
  await admin.from('encounters').delete().eq('id', id);
  revalidatePath('/admin/encounters');
}
