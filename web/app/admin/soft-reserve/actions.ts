'use server';

// Officer writes for Soft Reserve: one event's rules, and the lock. Every call re-checks the officer role (the page
// and its layout checks do not protect a server action that is called directly). The rules are checked by
// lib/softReserve.ts parseRulesForm; here the boss ids are also checked against the drop tables, so a typo cannot
// become a target with nothing to reserve.
import { revalidatePath } from 'next/cache';
import { requireOfficer } from '@/lib/officer';
import { supabaseAdmin } from '@/lib/supabase';
import { parseRulesForm } from '@/lib/softReserve';
import { loadDropRows } from '@/lib/softReserveLoad';

export type SaveResult = { ok: true; message: string } | { ok: false; message: string };

export type RulesInput = {
  enabled: boolean; per_person: string; per_boss: string; visibility: string; npc_ids: number[]; lock_mode: string;
  lock_at: string; no_reserve: string;
};

async function eventExists(eventId: string): Promise<boolean> {
  if (!eventId || eventId.length > 64) return false;
  const { data } = await supabaseAdmin().from('rh_events').select('id').eq('id', eventId).maybeSingle();
  return !!data;
}

export async function saveSrRules(eventId: string, input: RulesInput): Promise<SaveResult> {
  const userId = await requireOfficer();
  if (!(await eventExists(eventId))) return { ok: false, message: 'That raid event was not found.' };
  const parsed = parseRulesForm(input);
  if (!parsed.ok) return parsed;
  const sb = supabaseAdmin();
  const { npc_ids } = parsed.rules;
  if (npc_ids.length > 40) return { ok: false, message: 'That is more than 40 bosses. Pick fewer.' };
  if (npc_ids.length) {
    let rows;
    try { rows = await loadDropRows(npc_ids); } catch { return { ok: false, message: 'Could not check the bosses. Try again.' }; }
    const known = new Set(rows.map(r => r.npc_id));
    const bad = npc_ids.filter(n => !known.has(n));
    if (bad.length) return { ok: false, message: `No drop table for NPC ${bad.join(', ')}. Check the id on PQDI.` };
  }
  const { error } = await sb.from('sr_rules').upsert({
    event_id: eventId, ...parsed.rules, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) return { ok: false, message: 'Could not save. Try again.' };
  revalidatePath('/raid/sr');
  revalidatePath('/admin/soft-reserve');
  return { ok: true, message: 'Saved.' };
}

/** Lock or unlock picks by hand (the `manual` mode's button, and an override in every other mode). */
export async function setSrLocked(eventId: string, locked: boolean): Promise<SaveResult> {
  const userId = await requireOfficer();
  if (!(await eventExists(eventId))) return { ok: false, message: 'That raid event was not found.' };
  const { error } = await supabaseAdmin().from('sr_rules').upsert({
    event_id: eventId, locked, updated_by: userId, updated_at: new Date().toISOString(),
  }, { onConflict: 'event_id' });
  if (error) return { ok: false, message: 'Could not save. Try again.' };
  revalidatePath('/raid/sr');
  revalidatePath('/admin/soft-reserve');
  return { ok: true, message: locked ? 'Picks are locked.' : 'Picks are open.' };
}
