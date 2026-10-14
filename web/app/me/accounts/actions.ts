'use server';

// /me/accounts server actions: move a character between game accounts, rename an account. The rules live in
// web/lib/gameAccounts.ts; this file only resolves WHO is asking. The id comes from the signed-in session
// (auth user -> wolfpack_members), never from the client, and the character must be one ownedCharacters
// returns for that person. The tables are service-role only, so the service client does the writing after
// that check.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import {
  moveCharacter as moveRule, renameAccount as renameRule, ownerDiscordId, type Result,
} from '@/lib/gameAccounts';

async function who() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const owner = await ownerDiscordId(admin, user.id);
  if (!owner) return null;
  const owned = (await ownedCharacters(user.id)).map(c => ({ name: c.name, class: c.class }));
  return { admin, owner, owned };
}

export async function moveCharacter(character: string, slot: number | null): Promise<Result> {
  const me = await who();
  if (!me) return { ok: false, error: 'not signed in' };
  const r = await moveRule(me.admin, me.owner, me.owned, character, slot);
  if (r.ok) revalidatePath('/me/accounts');
  return r;
}

export async function renameAccount(slot: number, label: string | null): Promise<Result> {
  const me = await who();
  if (!me) return { ok: false, error: 'not signed in' };
  const r = await renameRule(me.admin, me.owner, me.owned, slot, label);
  if (r.ok) revalidatePath('/me/accounts');
  return r;
}
