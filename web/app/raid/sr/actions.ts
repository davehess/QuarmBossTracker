'use server';

// Pick or drop one Soft Reserve item for the character the signed-in member BRINGS to the next raid.
// The character is never taken from the browser: it is worked out here from the member's own sign-up
// (loadBringing), so nobody can pick for a character that is not theirs or for an alt they are not bringing.
// The rules (caps, lock, "is this a drop of a target") are lib/softReserve.ts checkAdd / checkRemove; the browser
// sends only the boss and the item. A speed bump of 60 changes in ten minutes per member, per server instance.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { makeLimiter } from '@/lib/popRecitalSave';
import { checkAdd, checkRemove, type Pick } from '@/lib/softReserve';
import { loadBringing, loadPicksOf, loadSrBase, pickContext } from '@/lib/softReserveLoad';

const allowed = makeLimiter(60, 10 * 60_000);

export type SetPickResult = { ok: true; mine: Pick[] } | { ok: false; message: string };

export async function setPick(npcId: number, itemId: number, on: boolean): Promise<SetPickResult> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, message: 'Sign in to pick.' };
  if (!allowed(user.id)) return { ok: false, message: 'Slow down a moment, then try again.' };
  if (!Number.isInteger(npcId) || !Number.isInteger(itemId) || npcId <= 0 || itemId <= 0) {
    return { ok: false, message: 'That is not a pick we know.' };
  }
  try {
    const base = await loadSrBase();
    if (!base) return { ok: false, message: 'There is no raid to pick for yet.' };
    const { bringing } = await loadBringing(user.id, base.event.id);
    if (!bringing) return { ok: false, message: 'You have no sign-up for this raid, so there is no character to pick for.' };
    const ctx = pickContext(base);
    const mine = await loadPicksOf(base.event.id, bringing.name);
    const sb = supabaseAdmin();
    const pick = { npc_id: npcId, item_id: itemId };

    if (!on) {
      const c = checkRemove(ctx);
      if (!c.ok) return { ok: false, message: c.message };
      const { error } = await sb.from('sr_picks').delete()
        .eq('event_id', base.event.id).eq('character_name', bringing.name).eq('npc_id', npcId).eq('item_id', itemId);
      if (error) return { ok: false, message: 'Could not save. Try again.' };
      revalidatePath('/raid/sr');
      return { ok: true, mine: mine.filter(p => !(p.npc_id === npcId && p.item_id === itemId)) };
    }

    const c = checkAdd(ctx, mine, pick);
    if (!c.ok) return { ok: false, message: c.message };
    const { error } = await sb.from('sr_picks').insert({
      event_id: base.event.id, character_name: bringing.name, npc_id: npcId, item_id: itemId, picked_by: user.id,
    });
    if (error) return { ok: false, message: 'Could not save. Try again.' };
    // Two taps at once can both pass the check; count again and take this one back if it broke a cap.
    const after = await loadPicksOf(base.event.id, bringing.name);
    const over = after.length > base.rules.per_person
      || (base.rules.per_boss != null && after.filter(p => p.npc_id === npcId).length > base.rules.per_boss);
    if (over) {
      await sb.from('sr_picks').delete()
        .eq('event_id', base.event.id).eq('character_name', bringing.name).eq('npc_id', npcId).eq('item_id', itemId);
      return { ok: false, message: 'That went over your picks. Drop one to pick another.' };
    }
    revalidatePath('/raid/sr');
    return { ok: true, mine: after };
  } catch (e) {
    return { ok: false, message: e instanceof Error ? e.message : 'Could not save. Try again.' };
  }
}
