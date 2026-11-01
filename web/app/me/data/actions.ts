'use server';
// "Delete my account" (the guild lead, 2026-11-01). One action, and it takes nothing from the request but the typed
// word: who is deleted is whoever the session cookie says is signed in, re-checked here (an action is a public POST
// endpoint, so the page that rendered the button proves nothing). The order of the steps, and why the Discord-linked
// raid records are unlinked in slices, is in web/lib/selfData.ts (runSelfDelete) and the migration
// 20261101140000_member_self_delete.sql.

import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isDeleteConfirmed, resolveSelf, runSelfDelete } from '@/lib/selfData';

export type DeleteOutcome = { ok: true; unfinished: number } | { ok: false; message: string };

const WHY: Record<string, string> = {
  owns_guild: 'You own a guild on Raid Mimic. Hand it to someone else or close it first, then try again.',
  identity: 'This login and its Discord account do not match, so nothing was deleted. Ask an officer.',
  screenshots: 'Your feedback screenshots could not be removed just now, so nothing was deleted. Try again in a minute.',
  database: 'Something went wrong and nothing was deleted. Try again in a minute, or ask an officer.',
  account: 'Your data was removed, but your sign-in could not be deleted just now. Press the button again, or ask an officer to finish it.',
};

export async function deleteMyAccount(typed: string): Promise<DeleteOutcome> {
  if (!isDeleteConfirmed(typed)) return { ok: false, message: 'Type DELETE in capital letters to confirm.' };
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, message: 'You are signed out. Sign in again, then try again.' };

  const db = supabaseAdmin();
  const me = await resolveSelf(db, user);
  if (!me.ok) return { ok: false, message: me.reason === 'mismatch' ? WHY.identity : 'This login has no Discord account on it, so there is nothing to delete.' };

  const r = await runSelfDelete(db, me.ids);
  if (!r.ok) return { ok: false, message: WHY[r.error] ?? WHY.database };
  return { ok: true, unfinished: r.unlinkFailed.length };
}
