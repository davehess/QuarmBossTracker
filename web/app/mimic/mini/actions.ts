'use server';

// Votes + feedback for the Mimic mini-mode review (/mimic/mini). Writes go
// through the service role (the tables are RLS-locked, reads authenticated)
// with the signed-in member's identity from the session, same posture as the
// /feedback form. Every input is validated against lib/miniReview so a bad
// overlay key or choice can never reach the table.

import { revalidatePath } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { getSessionUser } from '@/lib/session';
import { cleanFeedback, isChoice, isOverlayKey, type FeedbackRow } from '@/lib/miniReview';

async function whoAmI(): Promise<{ id: string; name: string } | null> {
  const user = await getSessionUser();
  if (!user) return null;
  const { data: pack } = await supabaseAdmin()
    .from('wolfpack_members')
    .select('nickname, global_name')
    .eq('user_id', user.id)
    .maybeSingle();
  return { id: user.id, name: pack?.nickname || pack?.global_name || 'Pack member' };
}

export async function castVote(input: { overlay: string; choice: string }): Promise<{ ok: boolean; error?: string }> {
  if (!isOverlayKey(input?.overlay) || !isChoice(input?.choice)) return { ok: false, error: 'Not a valid vote.' };
  const me = await whoAmI();
  if (!me) return { ok: false, error: 'Sign in to vote.' };
  const { error } = await supabaseAdmin().from('overlay_design_votes').upsert(
    { overlay: input.overlay, user_id: me.id, choice: input.choice, voter_name: me.name, updated_at: new Date().toISOString() },
    { onConflict: 'overlay,user_id' },
  );
  if (error) return { ok: false, error: 'Could not save your vote — try again.' };
  revalidatePath('/mimic/mini');
  return { ok: true };
}

export async function removeVote(input: { overlay: string }): Promise<{ ok: boolean; error?: string }> {
  if (!isOverlayKey(input?.overlay)) return { ok: false, error: 'Not a valid overlay.' };
  const me = await whoAmI();
  if (!me) return { ok: false, error: 'Sign in first.' };
  const { error } = await supabaseAdmin().from('overlay_design_votes').delete()
    .eq('overlay', input.overlay).eq('user_id', me.id);
  if (error) return { ok: false, error: 'Could not remove your pick — try again.' };
  revalidatePath('/mimic/mini');
  return { ok: true };
}

export async function postFeedback(input: { overlay: string; body: string; choice?: string | null }): Promise<{ ok: boolean; row?: FeedbackRow; error?: string }> {
  if (!isOverlayKey(input?.overlay)) return { ok: false, error: 'Not a valid overlay.' };
  const cleaned = cleanFeedback(input?.body);
  if (!cleaned.ok) return { ok: false, error: cleaned.error };
  const me = await whoAmI();
  if (!me) return { ok: false, error: 'Sign in to leave feedback.' };
  const choice = isChoice(input.choice) ? input.choice : null;
  const { data, error } = await supabaseAdmin().from('overlay_design_feedback')
    .insert({ overlay: input.overlay, user_id: me.id, author: me.name, choice, body: cleaned.body })
    .select('id, overlay, user_id, author, choice, body, created_at')
    .single();
  if (error || !data) return { ok: false, error: 'Could not save — try again.' };
  revalidatePath('/mimic/mini');
  return { ok: true, row: data as FeedbackRow };
}
