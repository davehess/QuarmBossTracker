'use server';

// Server actions for the /test-server planning page.
//   • toggleInterest(topic, notes)  — flips the signed-in user's interest
//     row for that topic. Re-running with the same topic flips it OFF.
//     Optional notes attach a "how I can help" detail.
//   • postComment(body)             — adds a comment as the signed-in user.
//   • deleteComment(id)             — soft-deletes; allowed for the author
//     OR an officer.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin }  from '@/lib/supabase';
import { isOfficer }      from '@/lib/officer';

export async function toggleInterest(topic: string, notes: string | null): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  if (!topic || typeof topic !== 'string' || topic.length > 64) return { ok: false, error: 'invalid topic' };
  const trimmedNotes = (notes || '').trim().slice(0, 500) || null;

  const admin = supabaseAdmin();
  // Toggle: if a row exists, delete it (or update notes). Easiest semantic:
  // empty-notes click toggles; non-empty notes upserts with the new notes.
  const { data: existing } = await admin
    .from('test_server_interests')
    .select('id, notes')
    .eq('user_id', user.id)
    .eq('topic',   topic)
    .maybeSingle();

  if (existing) {
    if (trimmedNotes && trimmedNotes !== existing.notes) {
      // Notes-only update — keeps the interest on.
      await admin.from('test_server_interests')
        .update({ notes: trimmedNotes })
        .eq('id', existing.id);
    } else {
      // No notes change → toggle off.
      await admin.from('test_server_interests').delete().eq('id', existing.id);
    }
  } else {
    await admin.from('test_server_interests')
      .insert({ user_id: user.id, topic, notes: trimmedNotes });
  }

  revalidatePath('/test-server');
  return { ok: true };
}

export async function postComment(body: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const trimmed = (body || '').trim().slice(0, 4000);
  if (!trimmed) return { ok: false, error: 'comment is empty' };

  await supabaseAdmin()
    .from('test_server_comments')
    .insert({ user_id: user.id, body: trimmed });

  revalidatePath('/test-server');
  return { ok: true };
}

export async function deleteComment(id: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };

  const admin = supabaseAdmin();
  const { data: row } = await admin
    .from('test_server_comments')
    .select('user_id, deleted_at')
    .eq('id', id)
    .maybeSingle();
  if (!row) return { ok: false, error: 'not found' };
  if (row.deleted_at) return { ok: true };

  // Author can delete their own; otherwise officer-only.
  const isAuthor = row.user_id === user.id;
  const officer  = isAuthor ? false : await isOfficer(user.id);
  if (!isAuthor && !officer) return { ok: false, error: 'not allowed' };

  await admin.from('test_server_comments')
    .update({ deleted_at: new Date().toISOString() })
    .eq('id', id);

  revalidatePath('/test-server');
  return { ok: true };
}
