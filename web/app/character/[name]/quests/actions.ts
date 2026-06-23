'use server';

// Per-character quest layout actions: reorder / hide / unhide / dismiss /
// undismiss. Owner-or-officer gated, mirroring the upload actions on /me.
// (Uilnayar 2026-06-23: "users should be able to reorder/hide/dismiss quests
// they don't care about.")

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

async function ownsOrOfficer(characterName: string): Promise<{ ok: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, error: 'not signed in' };
  if (await isOfficer(user.id)) return { ok: true };
  const admin = supabaseAdmin();
  const [{ data: me }, { data: ch }] = await Promise.all([
    admin.from('wolfpack_members').select('discord_id').eq('user_id', user.id).maybeSingle(),
    admin.from('characters').select('discord_id').eq('guild_id', 'wolfpack').ilike('name', characterName).maybeSingle(),
  ]);
  if (me?.discord_id && ch?.discord_id && me.discord_id === ch.discord_id) return { ok: true };
  return { ok: false, error: 'not your character' };
}

async function upsertPref(characterName: string, questId: number, patch: { hidden?: boolean; dismissed?: boolean; display_order?: number | null }) {
  const gate = await ownsOrOfficer(characterName);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = supabaseAdmin();
  // Manual upsert: read-or-default → merge → write. Avoids race-free upsert
  // requiring an on_conflict spec on a partial-column index.
  const { data: existing } = await admin
    .from('character_quest_prefs')
    .select('id, display_order, hidden, dismissed')
    .eq('guild_id', 'wolfpack')
    .ilike('character_name', characterName)
    .eq('quest_id', questId)
    .maybeSingle();
  const row = {
    guild_id: 'wolfpack',
    character_name: characterName,
    quest_id: questId,
    hidden: patch.hidden ?? existing?.hidden ?? false,
    dismissed: patch.dismissed ?? existing?.dismissed ?? false,
    display_order: patch.display_order === undefined ? (existing?.display_order ?? null) : patch.display_order,
    updated_at: new Date().toISOString(),
  };
  if (existing?.id) {
    await admin.from('character_quest_prefs').update(row).eq('id', existing.id);
  } else {
    await admin.from('character_quest_prefs').insert(row);
  }
  revalidatePath(`/character/${encodeURIComponent(characterName)}/quests`);
  return { ok: true };
}

export async function setQuestHidden(characterName: string, questId: number, hidden: boolean) {
  return upsertPref(characterName, questId, { hidden });
}

export async function setQuestDismissed(characterName: string, questId: number, dismissed: boolean) {
  // Dismissing also clears hidden (one source of "out of the way" truth).
  return upsertPref(characterName, questId, { dismissed, hidden: false });
}

// Apply a full ordering — the array is the new top-to-bottom order for the
// character's visible quests. Stored as 10, 20, 30… so we can insert between
// later without renumbering.
export async function reorderQuests(characterName: string, orderedQuestIds: number[]) {
  const gate = await ownsOrOfficer(characterName);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = supabaseAdmin();
  await Promise.all(orderedQuestIds.map((qid, i) =>
    upsertPref(characterName, qid, { display_order: (i + 1) * 10 })));
  revalidatePath(`/character/${encodeURIComponent(characterName)}/quests`);
  return { ok: true };
}

// Move a quest one position up/down in the character's visible-quest list.
// Reads the current ordered list, swaps the target with its neighbor, and
// writes the result via reorderQuests. Operates over visible (not hidden /
// dismissed) quests only — that's what the user sees on screen.
export async function moveQuest(characterName: string, questId: number, direction: 'up' | 'down') {
  const gate = await ownsOrOfficer(characterName);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = supabaseAdmin();
  const [{ data: quests }, { data: prefs }] = await Promise.all([
    admin.from('quest_catalog').select('id, display_order, name').eq('guild_id', 'wolfpack').eq('active', true),
    admin.from('character_quest_prefs').select('quest_id, display_order, hidden, dismissed')
      .eq('guild_id', 'wolfpack').ilike('character_name', characterName),
  ]);
  const prefByQ = new Map<number, { display_order: number | null; hidden: boolean; dismissed: boolean }>();
  for (const p of (prefs ?? []) as { quest_id: number; display_order: number | null; hidden: boolean; dismissed: boolean }[]) {
    prefByQ.set(p.quest_id, p);
  }
  const ordered = ((quests ?? []) as { id: number; display_order: number; name: string }[])
    .filter(q => !prefByQ.get(q.id)?.hidden && !prefByQ.get(q.id)?.dismissed)
    .sort((a, b) => {
      const ao = prefByQ.get(a.id)?.display_order ?? a.display_order;
      const bo = prefByQ.get(b.id)?.display_order ?? b.display_order;
      return ao - bo || a.name.localeCompare(b.name);
    });
  const idx = ordered.findIndex(q => q.id === questId);
  if (idx < 0) return { ok: false, error: 'quest not in visible list' };
  const swap = direction === 'up' ? idx - 1 : idx + 1;
  if (swap < 0 || swap >= ordered.length) return { ok: true };  // already at edge — no-op
  const next = ordered.slice();
  [next[idx], next[swap]] = [next[swap], next[idx]];
  return reorderQuests(characterName, next.map(q => q.id));
}

export async function resetQuestLayout(characterName: string) {
  const gate = await ownsOrOfficer(characterName);
  if (!gate.ok) return { ok: false, error: gate.error };
  const admin = supabaseAdmin();
  await admin.from('character_quest_prefs')
    .delete()
    .eq('guild_id', 'wolfpack')
    .ilike('character_name', characterName);
  revalidatePath(`/character/${encodeURIComponent(characterName)}/quests`);
  return { ok: true };
}
