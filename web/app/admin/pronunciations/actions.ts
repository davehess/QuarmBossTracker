'use server';

// /admin/pronunciations server actions: an officer sets or clears how ANY character's name is spoken. The page
// is gated by the /admin layout and requireOfficer(), but a server action is its own endpoint, so each one asks
// isOfficer again before it writes. The rules live in web/lib/pronunciations.ts.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import {
  savePronunciation as saveRule, clearPronunciation as clearRule, memberDiscordId, type Result,
} from '@/lib/pronunciations';

async function officer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user || !(await isOfficer(user.id))) return null;
  const admin = supabaseAdmin();
  const discordId = await memberDiscordId(admin, user.id);
  if (!discordId) return null;
  return { admin, actor: { discordId, officer: true } };
}

export async function savePronunciation(character: string, say: string): Promise<Result> {
  const me = await officer();
  if (!me) return { ok: false, error: 'officers only' };
  const r = await saveRule(me.admin, me.actor, [], character, say);
  if (r.ok) { revalidatePath('/admin/pronunciations'); revalidatePath('/me/voice'); }
  return r;
}

export async function clearPronunciation(character: string): Promise<Result> {
  const me = await officer();
  if (!me) return { ok: false, error: 'officers only' };
  const r = await clearRule(me.admin, me.actor, [], character);
  if (r.ok) { revalidatePath('/admin/pronunciations'); revalidatePath('/me/voice'); }
  return r;
}
