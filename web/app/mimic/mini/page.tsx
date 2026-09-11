// Mimic mini mode — the guild picks. Every overlay is shown in full next to
// three mini renditions; members vote for one and leave feedback that stays on
// the page (Hitya 2026-09-11: "the guild's opinions matter here"). Member-only:
// the mocks use real raider names, the same ones /parses and /who show.
//
// Data: overlay_design_votes (one row per member per overlay, changeable) and
// overlay_design_feedback (append-only thread per overlay). Both are read here
// with the service role and written by ./actions.ts.

import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import type { FeedbackRow, VoteRow } from '@/lib/miniReview';
import MiniReview from './MiniReview';

export const metadata = {
  title: 'Mimic mini mode',
  description: 'Every overlay in a version that takes less room — see the three renditions, vote for the one you would raid with, and say why.',
};

export const dynamic = 'force-dynamic';

export default async function MiniModePage() {
  const user = await getSessionUser();
  if (!user) redirect('/auth/signin?next=/mimic/mini');

  const admin = supabaseAdmin();
  const [{ data: pack }, { data: votes }, { data: feedback }] = await Promise.all([
    admin.from('wolfpack_members').select('nickname, global_name').eq('user_id', user.id).maybeSingle(),
    admin.from('overlay_design_votes').select('overlay, user_id, choice, voter_name'),
    admin.from('overlay_design_feedback').select('id, overlay, user_id, author, choice, body, created_at').order('created_at', { ascending: true }),
  ]);

  return (
    <MiniReview
      me={{ id: user.id, name: pack?.nickname || pack?.global_name || 'Pack member' }}
      votes={(votes ?? []) as VoteRow[]}
      feedback={(feedback ?? []) as FeedbackRow[]}
    />
  );
}
