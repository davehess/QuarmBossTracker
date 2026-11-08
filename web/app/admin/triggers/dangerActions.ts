'use server';

// Deleting a guild trigger (the guild lead, 2026-10-31, DECISIONS §493). It reaches every raider's agent within about two
// minutes and cannot be taken back, so it asks for the trigger's name, typed. The name is read from the row here, not
// from the form, so the form cannot supply its own answer. Switching a trigger off (the on/off button) stays one click:
// that one is reversible.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';
import { typedConfirmOk } from '@/lib/adminTyped';

export async function deleteTrigger(formData: FormData): Promise<void> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  if (!id) return;
  const admin = supabaseAdmin();
  const { data: row } = await admin.from('guild_triggers').select('name').eq('id', id).maybeSingle();
  if (!row) return;   // already gone
  if (!typedConfirmOk(formData.get('confirm'), (row as { name: string | null }).name)) {
    redirect('/admin/triggers?danger=wrong-phrase');
  }
  await admin.from('guild_triggers').delete().eq('id', id);
  revalidatePath('/admin/triggers');
}
