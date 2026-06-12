// Officer actions for parse classification — shared by the /parses listing
// page (inline admin strip on each KillCard) and /parses/[id] detail page.
// Defined in a separate module so both server components can import without
// duplicating the 'use server' boundary or the officer check.
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

async function assertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

const ALLOWED = new Set(['wipe', 'live', 'pvp', 'test']);

export async function classifyEncounter(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const classification = String(formData.get('classification') || '').toLowerCase().trim();
  const reason = String(formData.get('reason') || '').slice(0, 200) || null;
  if (!id || !ALLOWED.has(classification)) return;
  const admin = supabaseAdmin();
  await admin.from('encounters').update({
    classification,
    classification_reason: reason,
    classification_at: new Date().toISOString(),
    classification_by: u!.email || u!.id,
  }).eq('id', id);
  // Both surfaces show classification chips + adjusted counts; revalidate
  // both so the admin sees the result without a hard refresh.
  revalidatePath('/parses');
  revalidatePath(`/parses/${id}`);
}

export async function clearClassification(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  if (!id) return;
  const admin = supabaseAdmin();
  await admin.from('encounters').update({
    classification: null,
    classification_reason: null,
    classification_at: null,
    classification_by: null,
  }).eq('id', id);
  revalidatePath('/parses');
  revalidatePath(`/parses/${id}`);
}
