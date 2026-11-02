'use server';

// Post a reply on /feedback/<ref>. The writer must be the report's submitter or an officer, checked here
// again on the server (the page hiding the form is not the gate). The insert goes through the service role
// because feedback_replies has RLS on and no policy for anyone else; the bot's 10-minute loop then posts
// the reply under the report's card in the Discord #feedback thread.
import { redirect } from 'next/navigation';
import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { cleanReply, parseRefParam } from '@/lib/feedbackReport';
import { loadViewer, openReport } from './access';

const MAX_REPLIES_PER_REPORT = 50;   // A thread this long wants a person, not another reply.

export async function postReply(formData: FormData): Promise<void> {
  const ref = parseRefParam(String(formData.get('ref') ?? ''));
  if (!ref) redirect('/feedback');
  const back = `/feedback/FB-${ref}`;

  const viewer = await loadViewer();
  if (!viewer) redirect(`/auth/signin?next=${encodeURIComponent(back)}`);
  const report = await openReport(viewer, ref);
  if (!report || !viewer.discordId) redirect(back);

  const clean = cleanReply(formData.get('body'));
  if (!clean.ok) redirect(`${back}?err=${clean.error}#reply`);

  const admin = supabaseAdmin();
  const { count } = await admin.from('feedback_replies')
    .select('id', { count: 'exact', head: true }).eq('feedback_id', report.id);
  if ((count ?? 0) >= MAX_REPLIES_PER_REPORT) redirect(`${back}?err=full#reply`);

  // The same reply sent again within two minutes is one reply (the guild lead, 2026-11-02: FB-110's reply reached
  // Discord three times; the slow form had been submitted three times, 4 and 7 seconds apart). Same text later is fine.
  const { data: last } = await admin.from('feedback_replies')
    .select('body, created_at').eq('feedback_id', report.id).eq('author_discord_id', viewer.discordId)
    .order('created_at', { ascending: false }).limit(1);
  const prev = Array.isArray(last) ? last[0] : null;
  if (prev && prev.body === clean.body && Date.now() - Date.parse(prev.created_at) < 2 * 60_000) {
    redirect(`${back}?sent=1#replies`);
  }

  const { error } = await admin.from('feedback_replies').insert([{
    feedback_id: report.id,
    author_discord_id: viewer.discordId,
    body: clean.body,
  }]);
  if (error) redirect(`${back}?err=fail#reply`);

  revalidatePath(back);
  revalidatePath('/admin/feedback');
  redirect(`${back}?sent=1#replies`);
}
