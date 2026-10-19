'use server';

// /admin/voice-reports server action: an officer closes a report as fixed or dismissed. The page is gated by the
// /admin layout and requireOfficer(), but a server action is its own endpoint, so it asks isOfficer again before it
// writes (the /admin/pronunciations pattern). The bot has no route for this; the page writes with the service role.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { memberDiscordId } from '@/lib/pronunciations';

export type StatusResult = { ok: true } | { ok: false; error: string };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function closeVoiceReport(id: string, status: 'fixed' | 'dismissed'): Promise<StatusResult> {
  if (!UUID_RE.test(String(id)) || (status !== 'fixed' && status !== 'dismissed')) return { ok: false, error: 'bad request' };
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) return { ok: false, error: 'officers only' };
  const admin = supabaseAdmin();
  const { error } = await admin.from('voice_reports')
    .update({ status, reviewed_by: await memberDiscordId(admin, user.id), reviewed_at: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, error: 'could not save' };
  revalidatePath('/admin/voice-reports');
  return { ok: true };
}
