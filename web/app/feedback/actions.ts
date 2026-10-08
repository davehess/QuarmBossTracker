'use server';

// Submit feedback from wolfpack.quest/feedback into the SAME `feedback` table
// the Discord /feedback command uses (so it shows up on /admin/feedback with
// everything else). We insert with discord_msg_id = null; the bot polls for
// null-msg-id rows and relays them into the Discord #feedback thread, then
// stamps the id/link. Open to everyone; attributed to the signed-in Discord
// identity when available. Service-role write (RLS-locked table).

import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { storeShots } from '@/lib/feedbackShots';

const CATEGORIES = ['bug', 'idea', 'praise', 'other'] as const;

export async function submitFeedback(input: {
  category: string;
  message: string;
  screenshots?: string[];
}): Promise<{ ok: boolean; error?: string }> {
  const message = (input.message || '').trim();
  if (!message) return { ok: false, error: 'Please write something first.' };
  if (message.length > 4000) return { ok: false, error: 'That\'s a bit long — keep it under 4000 characters.' };

  const category = (CATEGORIES as readonly string[]).includes(input.category) ? input.category : 'other';

  const admin = supabaseAdmin();

  // Best-effort attribution if signed in.
  let discordId: string | null = null;
  let name: string | null = null;
  try {
    const { data: { user } } = await supabaseServer().auth.getUser();
    if (user) {
      const { data: pack } = await admin
        .from('wolfpack_members')
        .select('discord_id, nickname, global_name')
        .eq('user_id', user.id)
        .maybeSingle();
      discordId = pack?.discord_id ?? null;
      name = pack?.nickname || pack?.global_name || null;
    }
  } catch { /* anonymous is fine */ }

  // Screenshots (2026-09-26) only from a signed-in pack member: an anonymous
  // form that stores images and reposts them into Discord is an open door.
  // Anonymous text feedback is unchanged.
  const shotPaths = discordId ? await storeShots(admin, input.screenshots, 'web') : [];

  const { error } = await admin.from('feedback').insert([{
    submitter_discord_id: discordId,
    submitter_name:       name || 'web (anonymous)',
    category,
    message:              `[from wolfpack.quest] ${message}`,
    // discord_msg_id left NULL → the bot's web-feedback relay posts it to the
    // #feedback thread (screenshots attached) and backfills the id/link.
    status:               'new',
    ...(shotPaths.length ? { screenshot_paths: shotPaths } : {}),
  }]);
  if (error) return { ok: false, error: 'Could not save — please try again.' };
  return { ok: true };
}
