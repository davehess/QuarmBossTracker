'use server';

// Tick or untick one PoP guide item for one of YOUR characters (the guild lead, 2026-09-28:
// "Make this a checkbox type of thing"). Owner-only: the character must be in the signed-in
// member's household + family (ownedCharacters, the same walk /me and /pop use). The item key
// must be one the guide defines, so the table can never fill with junk. Items ticked by a
// recorded PoP flag are never written here.
//
// setFlagTicks is the same write for a PoP FLAG instead of a step (the guild lead, 2026-10-03: "check off
// their own flags for their own characters outside of using mimic"): /pop's matrix and My Characters call
// it. The row is the guide step that grants the flag, else `flag:<key>` (web/lib/popSelfFlags.ts), so both
// pages read one store. One ownership gate, writeTicks below, serves both.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { GUIDE_KEYS } from '@/lib/popGuide';
import { MAX_FLAGS_PER_TICK, tickKeyForFlag, tickKeysForFlag } from '@/lib/popSelfFlags';
import { GUILD_TAG } from '@/lib/guild';

type Result = { ok: boolean; error?: string };

export async function setGuideTick(character: string, itemKey: string, ticked: boolean): Promise<Result> {
  if (typeof character !== 'string' || typeof itemKey !== 'string' || typeof ticked !== 'boolean') {
    return { ok: false, error: 'bad request' };
  }
  if (!GUIDE_KEYS.has(itemKey)) return { ok: false, error: 'unknown item' };

  const res = await writeTicks(character, [itemKey], [itemKey], ticked);
  // A step that grants a flag counts on /pop too, so its cached copy must not outlive the tick. Not
  // /pop/guide: the checklist already shows the tick, and re-rendering it per click costs a page of reads.
  if (res.ok) revalidatePath('/pop');
  return res;
}

// Several flags in one write: a matrix cell is a whole gate, and a gate can need two (Torment, Sol Ro).
export async function setFlagTicks(character: string, flags: string[], ticked: boolean): Promise<Result> {
  if (typeof character !== 'string' || !Array.isArray(flags) || typeof ticked !== 'boolean') {
    return { ok: false, error: 'bad request' };
  }
  if (flags.length === 0 || flags.length > MAX_FLAGS_PER_TICK) return { ok: false, error: 'bad request' };
  // Sets: one upsert statement cannot name the same row twice.
  const write = new Set<string>();
  const remove = new Set<string>();
  for (const f of flags) {
    const key = tickKeyForFlag(f);
    if (!key) return { ok: false, error: 'unknown flag' };
    write.add(key);
    for (const k of tickKeysForFlag(f)) remove.add(k);
  }

  const res = await writeTicks(character, [...write], [...remove], ticked);
  if (res.ok) { revalidatePath('/pop'); revalidatePath('/pop/guide'); }
  return res;
}

// The gate: signed in, then YOUR character, and only then a write under the character's real name.
// `write` is what a tick stores; `remove` is every key that counts as the same report, so an untick
// cannot leave one behind.
async function writeTicks(character: string, write: string[], remove: string[], ticked: boolean): Promise<Result> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  const owned = (await ownedCharacters(user.id)).find(c => c.name.toLowerCase() === character.toLowerCase());
  if (!owned) return { ok: false, error: 'not your character' };

  const admin = supabaseAdmin();
  if (ticked) {
    const { data: me } = await admin.from('wolfpack_members').select('discord_id').eq('user_id', user.id).maybeSingle();
    const now = new Date().toISOString();
    const { error } = await admin.from('pop_guide_ticks').upsert(
      write.map(item_key => ({ guild_id: GUILD_TAG, character_name: owned.name, item_key,
        ticked_at: now, ticked_by: me?.discord_id ?? null })),
      { onConflict: 'guild_id,character_name,item_key' },
    );
    if (error) return { ok: false, error: error.message };
  } else {
    const { error } = await admin.from('pop_guide_ticks').delete()
      .eq('guild_id', GUILD_TAG).eq('character_name', owned.name).in('item_key', remove);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}
