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
