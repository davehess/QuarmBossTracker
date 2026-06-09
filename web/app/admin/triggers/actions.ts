'use server';

// Officer-only server actions for the triggers list. Keep these in their own
// file so the client TriggerList component can import them without dragging
// the page's heavy server-side imports along.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

async function assertOfficer(): Promise<boolean> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return false;
  return await isOfficer(user.id);
}

export async function toggleTriggerEnabled(id: string, want: boolean): Promise<{ ok: boolean; error?: string }> {
  if (!(await assertOfficer())) return { ok: false, error: 'officer access required' };
  if (!id) return { ok: false, error: 'id required' };
  const { error } = await supabaseAdmin().from('guild_triggers').update({ enabled: !!want }).eq('id', id);
  if (error) return { ok: false, error: error.message };
  // Revalidate keeps the server cache fresh for multi-officer scenarios; the
  // client patches locally first so the toggle is instant either way.
  revalidatePath('/admin/triggers');
  return { ok: true };
}

export async function deleteTriggerRow(id: string): Promise<{ ok: boolean; error?: string }> {
  if (!(await assertOfficer())) return { ok: false, error: 'officer access required' };
  if (!id) return { ok: false, error: 'id required' };
  const { error } = await supabaseAdmin().from('guild_triggers').delete().eq('id', id);
  if (error) return { ok: false, error: error.message };
  revalidatePath('/admin/triggers');
  return { ok: true };
}
