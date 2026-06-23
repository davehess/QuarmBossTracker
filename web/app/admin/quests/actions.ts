'use server';

// Server actions for /admin/quests. Officer-gated.

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { supabaseAdmin } from '@/lib/supabase';
import { supabaseServer } from '@/lib/supabase-server';
import { isOfficer } from '@/lib/officer';

async function gate(): Promise<boolean> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return false;
  return await isOfficer(user.id);
}

export async function createQuest(form: FormData): Promise<void> {
  if (!await gate()) redirect('/?error=admin_required');
  const name = String(form.get('name') || '').trim();
  if (!name) return;
  const category = String(form.get('category') || '').trim() || null;
  const zone = String(form.get('zone') || '').trim() || null;
  const pqdi = String(form.get('pqdi_quest_url') || '').trim() || null;
  const notes = String(form.get('notes') || '').trim() || null;
  const rewardName = String(form.get('reward_item_name') || '').trim() || null;
  const isStack = form.get('is_stack_turnin') === 'on';
  const displayOrder = parseInt(String(form.get('display_order') || '100'), 10) || 100;

  await supabaseAdmin().from('quest_catalog').insert({
    guild_id: 'wolfpack', name, category, zone, pqdi_quest_url: pqdi, notes,
    reward_item_name: rewardName, is_stack_turnin: isStack, display_order: displayOrder, active: true,
  });
  revalidatePath('/admin/quests');
}

export async function addRequiredItem(form: FormData): Promise<void> {
  if (!await gate()) redirect('/?error=admin_required');
  const quest_id = parseInt(String(form.get('quest_id') || ''), 10);
  const item_name = String(form.get('item_name') || '').trim();
  if (!quest_id || !item_name) return;
  const quantity = Math.max(1, parseInt(String(form.get('quantity') || '1'), 10) || 1);
  const display_order = parseInt(String(form.get('display_order') || '100'), 10) || 100;
  const optional = form.get('optional') === 'on';
  const notes = String(form.get('notes') || '').trim() || null;
  await supabaseAdmin().from('quest_required_item').insert({
    quest_id, item_name, quantity, optional, display_order, notes,
  });
  revalidatePath('/admin/quests');
}

export async function deleteQuest(form: FormData): Promise<void> {
  if (!await gate()) redirect('/?error=admin_required');
  const id = parseInt(String(form.get('id') || ''), 10);
  if (!id) return;
  await supabaseAdmin().from('quest_catalog').delete().eq('id', id);
  revalidatePath('/admin/quests');
}

export async function deleteItem(form: FormData): Promise<void> {
  if (!await gate()) redirect('/?error=admin_required');
  const id = parseInt(String(form.get('id') || ''), 10);
  if (!id) return;
  await supabaseAdmin().from('quest_required_item').delete().eq('id', id);
  revalidatePath('/admin/quests');
}

export async function toggleActive(form: FormData): Promise<void> {
  if (!await gate()) redirect('/?error=admin_required');
  const id = parseInt(String(form.get('id') || ''), 10);
  if (!id) return;
  const cur = await supabaseAdmin().from('quest_catalog').select('active').eq('id', id).maybeSingle();
  if (!cur.data) return;
  await supabaseAdmin().from('quest_catalog').update({ active: !cur.data.active }).eq('id', id);
  revalidatePath('/admin/quests');
}
