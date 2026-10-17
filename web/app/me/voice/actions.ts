'use server';

// /me/voice server actions: set or clear how one of YOUR characters' names is spoken. The rules live in
// web/lib/pronunciations.ts; this file only resolves WHO is asking. The id comes from the signed-in session,
// never from the client, and the character must be one ownedCharacters returns for that person. Always
// officer:false here: an officer sets other people's names from /admin/pronunciations, not from this page.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import {
  savePronunciation as saveRule, clearPronunciation as clearRule, memberDiscordId, type Result,
} from '@/lib/pronunciations';

async function who() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const discordId = await memberDiscordId(admin, user.id);
  if (!discordId) return null;
  const owned = (await ownedCharacters(user.id)).map(c => ({ name: c.name }));
  return { admin, actor: { discordId, officer: false }, owned };
}

export async function saveMyPronunciation(character: string, say: string): Promise<Result> {
  const me = await who();
  if (!me) return { ok: false, error: 'not signed in' };
  const r = await saveRule(me.admin, me.actor, me.owned, character, say);
  if (r.ok) revalidatePath('/me/voice');
  return r;
}

export async function clearMyPronunciation(character: string): Promise<Result> {
  const me = await who();
  if (!me) return { ok: false, error: 'not signed in' };
  const r = await clearRule(me.admin, me.actor, me.owned, character);
  if (r.ok) revalidatePath('/me/voice');
  return r;
}
