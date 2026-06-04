// Public feedback form. Open to everyone (no sign-in wall); attributed to the
// signed-in Discord identity when available. Submissions land in app_feedback
// (triaged on /admin/feedback) and the bot relays each into the Discord
// #feedback thread.

import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import FeedbackForm from './FeedbackForm';

export const dynamic = 'force-dynamic';

export const metadata = {
  title: 'Feedback — Wolf Pack EQ',
  description: 'Tell us what\'s broken, what you\'d love, or what\'s working.',
};

export default async function FeedbackPage() {
  let signedInAs: string | null = null;
  try {
    const { data: { user } } = await supabaseServer().auth.getUser();
    if (user) {
      const { data: pack } = await supabaseAdmin()
        .from('wolfpack_members')
        .select('nickname, global_name')
        .eq('user_id', user.id)
        .maybeSingle();
      signedInAs = pack?.nickname || pack?.global_name || null;
    }
  } catch { /* anonymous */ }

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div>
        <h1 className="text-2xl text-gold">💬 Feedback</h1>
        <p className="text-sm text-dim mt-1">
          Bugs, ideas, gripes, kudos — all of it helps. Every submission lands in our triage
          list and the Discord <code>#feedback</code> thread, and we genuinely read them all.
        </p>
      </div>
      <FeedbackForm signedInAs={signedInAs} />
      <p className="text-[11px] text-dim text-center">
        Prefer Discord? <code>/feedback</code> in the guild works too — it goes to the same place.
      </p>
    </div>
  );
}
