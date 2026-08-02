'use server';

// Roadmap queue interactions — voting + "here's the thing you're blocked on"
// submissions. The page itself stays public/static; these actions run at
// request time. Votes live in `roadmap_votes` (RLS-locked, service-role only
// — the session check happens HERE, server-side, before the admin client
// writes), so the public page can show aggregate counts without exposing
// per-member rows. Submissions ride the existing `feedback` pipeline: insert
// with discord_msg_id NULL and the bot relays it into the Discord #feedback
// thread and /admin/feedback like every other piece of feedback — no new
// officer surface to watch.

import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { queueItems } from '@/lib/roadmapData';

const VALID_KEYS = new Set(queueItems.map((q) => q.key));

async function sessionUserId(): Promise<string | null> {
  try {
    const { data: { user } } = await supabaseServer().auth.getUser();
    return user?.id ?? null;
  } catch { return null; }
}

export async function getRoadmapVotes(): Promise<{
  counts: Record<string, number>;
  mine: string[];
  signedIn: boolean;
}> {
  const admin = supabaseAdmin();
  const counts: Record<string, number> = {};
  let mine: string[] = [];
  const userId = await sessionUserId();
  try {
    const { data } = await admin.from('roadmap_votes').select('item_key, user_id');
    for (const row of data || []) {
      counts[row.item_key] = (counts[row.item_key] || 0) + 1;
      if (userId && row.user_id === userId) mine.push(row.item_key);
    }
  } catch { /* empty counts — page still renders */ }
  return { counts, mine, signedIn: !!userId };
}

export async function toggleRoadmapVote(itemKey: string): Promise<{
  ok: boolean;
  voted?: boolean;
  count?: number;
  error?: string;
}> {
  if (!VALID_KEYS.has(itemKey)) return { ok: false, error: 'Unknown item.' };
  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: 'Sign in with Discord to vote.' };

  const admin = supabaseAdmin();
  const { data: existing } = await admin
    .from('roadmap_votes')
    .select('item_key')
    .eq('item_key', itemKey)
    .eq('user_id', userId)
    .maybeSingle();

  if (existing) {
    await admin.from('roadmap_votes').delete().eq('item_key', itemKey).eq('user_id', userId);
  } else {
    await admin.from('roadmap_votes').insert([{ item_key: itemKey, user_id: userId }]);
  }
  const { count } = await admin
    .from('roadmap_votes')
    .select('*', { count: 'exact', head: true })
    .eq('item_key', itemKey);
  return { ok: true, voted: !existing, count: count ?? 0 };
}

export async function submitRoadmapEvidence(input: {
  itemKey: string;
  content: string;
}): Promise<{ ok: boolean; error?: string }> {
  const item = queueItems.find((q) => q.key === input.itemKey);
  if (!item) return { ok: false, error: 'Unknown item.' };
  const content = (input.content || '').trim();
  if (!content) return { ok: false, error: 'Paste or write something first.' };
  if (content.length > 3000) return { ok: false, error: 'Keep it under 3000 characters.' };

  const userId = await sessionUserId();
  if (!userId) return { ok: false, error: 'Sign in with Discord to submit — so we can follow up if it unblocks the work.' };

  const admin = supabaseAdmin();
  // Attribution mirrors /feedback's lookup.
  let name: string | null = null;
  let discordId: string | null = null;
  try {
    const { data: pack } = await admin
      .from('wolfpack_members')
      .select('discord_id, nickname, global_name')
      .eq('user_id', userId)
      .maybeSingle();
    discordId = pack?.discord_id ?? null;
    name = pack?.nickname || pack?.global_name || null;
  } catch { /* name stays null */ }

  const { error } = await admin.from('feedback').insert([{
    submitter_discord_id: discordId,
    submitter_name:       name || 'web (member)',
    category:             'other',
    message:              `[roadmap ${item.num} — ${item.title}] ${content}`,
    // discord_msg_id NULL → the bot's web-feedback relay posts it into the
    // #feedback thread and backfills the link, same as /feedback.
    status:               'new',
  }]);
  if (error) return { ok: false, error: 'Could not save — please try again.' };
  return { ok: true };
}
