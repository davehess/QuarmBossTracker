// Officer actions for Fight Cards (docs/DESIGN-fight-cards.md, task #43).
// Same posture as parses/actions.ts: 'use server' boundary + officer check;
// writes go through the admin client because fight_cards is service-role
// write-only (authenticated members read, only officers author).
'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

async function assertOfficer() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  if (!(await isOfficer(user.id))) return null;
  return user;
}

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Shared field extraction for create + update. Multi-select trigger ids arrive
// as repeated form entries; anything that isn't a UUID is dropped rather than
// stored (a mistyped id would render as MISSING forever).
function cardFields(formData: FormData) {
  const text = (k: string, max = 4000) => {
    const v = String(formData.get(k) ?? '').trim();
    return v ? v.slice(0, max) : null;
  };
  const bossId = parseInt(String(formData.get('boss_npc_id') || ''), 10);
  const sortOrder = parseInt(String(formData.get('sort_order') || '0'), 10);
  const triggerIds = formData.getAll('trigger_ids').map(String).filter(v => UUID_RX.test(v));
  return {
    boss_npc_id: Number.isFinite(bossId) ? bossId : null,
    title: text('title', 200),
    comp_notes: text('comp_notes'),
    kit_notes: text('kit_notes'),
    tactics: text('tactics', 8000),
    guide_ref: text('guide_ref', 500),
    sort_order: Number.isFinite(sortOrder) ? sortOrder : 0,
    trigger_ids: triggerIds,
  };
}

export async function createFightCard(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const f = cardFields(formData);
  if (!f.boss_npc_id) return;
  await supabaseAdmin().from('fight_cards').insert({
    guild_id: 'wolfpack',
    ...f,
    updated_by: u!.email || u!.id,
  });
  revalidatePath('/raid/plan');
}

export async function updateFightCard(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const f = cardFields(formData);
  if (!id || !f.boss_npc_id) return;
  await supabaseAdmin().from('fight_cards').update({
    ...f,
    active: formData.get('active') === 'on',
    updated_by: u!.email || u!.id,
    updated_at: new Date().toISOString(),
  }).eq('id', id);
  revalidatePath('/raid/plan');
}

export async function deleteFightCard(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  if (!id) return;
  await supabaseAdmin().from('fight_cards').delete().eq('id', id);
  revalidatePath('/raid/plan');
}
