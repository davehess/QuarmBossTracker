// Officer actions for parse classification — shared by the /parses listing
// page (inline admin strip on each KillCard) and /parses/[id] detail page.
// Defined in a separate module so both server components can import without
// duplicating the 'use server' boundary or the officer check.
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

const ALLOWED = new Set(['wipe', 'live', 'pvp', 'test', 'foreign']);

export async function classifyEncounter(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const classification = String(formData.get('classification') || '').toLowerCase().trim();
  const reason = String(formData.get('reason') || '').slice(0, 200) || null;
  if (!id || !ALLOWED.has(classification)) return;
  const admin = supabaseAdmin();
  await admin.from('encounters').update({
    classification,
    classification_reason: reason,
    classification_at: new Date().toISOString(),
    classification_by: u!.email || u!.id,
  }).eq('id', id);
  // Both surfaces show classification chips + adjusted counts; revalidate
  // both so the admin sees the result without a hard refresh.
  revalidatePath('/parses');
  revalidatePath(`/parses/${id}`);
  revalidatePath('/admin/anomalies');
}

export async function clearClassification(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  if (!id) return;
  const admin = supabaseAdmin();
  await admin.from('encounters').update({
    classification: null,
    classification_reason: null,
    classification_at: null,
    classification_by: null,
  }).eq('id', id);
  revalidatePath('/parses');
  revalidatePath(`/parses/${id}`);
  revalidatePath('/admin/anomalies');
}

// ── Intentional deaths (Hitya 2026-08-06) ─────────────────────────────────
// A STANDING rule: "<character> always dies on purpose on <this boss>". Set
// once from the fight the officer is already looking at, and it applies every
// week after — Fawx and Dant make a corpse on Kaas Thox Xi Ans Dyek every
// single raid, and a per-death toggle would have officers re-marking the same
// two rogues forever.
//
// The death is never hidden. It keeps its place in the headline count, the
// deaths list and the fight timeline; the rule only stops the raid-night review
// listing that fight under "What to work on". See
// docs/DESIGN-intentional-deaths.md and utils/raidReview.js summarizeNight.
//
// Keyed on npc_id, not the boss's display name — cleanBossName() strips '#'/'_'
// purely for rendering and two differently-templated NPCs can render the same
// clean name.

// EQ character names are letters only. Validating that here is not just
// hygiene: both actions match the stored name with ilike (case-insensitive, to
// mirror the lower() unique index), and '%'/'_' are ilike WILDCARDS — an
// unvalidated name could match rows it was never meant to touch.
const NAME_RE = /^[A-Za-z]{2,20}$/;

export async function markDeathIntentional(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const character = String(formData.get('character') || '').trim();
  const npcId = Number(formData.get('npc_id'));
  const note = String(formData.get('note') || '').slice(0, 200) || null;
  if (!id || !NAME_RE.test(character) || !Number.isFinite(npcId)) return;

  const admin = supabaseAdmin();
  // Find-then-write rather than upsert: the unique index is on
  // (guild_id, LOWER(character_name), npc_id), and an EXPRESSION index cannot
  // be targeted by an onConflict column list — an upsert here would fail at
  // runtime, not at compile time. Matching with ilike also means re-marking a
  // character whose rule was turned off REVIVES that row instead of colliding
  // with it. The index remains the backstop if two officers race.
  const { data: existing } = await admin.from('intentional_death_rules')
    .select('id')
    .eq('guild_id', 'wolfpack')
    .eq('npc_id', npcId)
    .ilike('character_name', character)
    .maybeSingle();

  if (existing?.id) {
    await admin.from('intentional_death_rules')
      .update({ active: true, note, updated_at: new Date().toISOString() })
      .eq('id', existing.id);
  } else {
    await admin.from('intentional_death_rules').insert({
      guild_id: 'wolfpack',
      character_name: character,
      npc_id: npcId,
      note,
      active: true,
      created_by_name: u!.email || u!.id,
    });
  }
  revalidatePath(`/parses/${id}`);
  revalidatePath('/raid');
}

export async function unmarkDeathIntentional(formData: FormData) {
  const u = await assertOfficer();
  if (!u) redirect('/?error=admin_required');
  const id = String(formData.get('id') || '');
  const character = String(formData.get('character') || '').trim();
  const npcId = Number(formData.get('npc_id'));
  if (!id || !NAME_RE.test(character) || !Number.isFinite(npcId)) return;

  // Deactivate rather than delete: who set the rule and why is worth keeping,
  // and reviving it is then a flag flip instead of a re-entry.
  const admin = supabaseAdmin();
  await admin.from('intentional_death_rules')
    .update({ active: false, updated_at: new Date().toISOString() })
    .eq('guild_id', 'wolfpack')
    .eq('npc_id', npcId)
    .ilike('character_name', character);
  revalidatePath(`/parses/${id}`);
  revalidatePath('/raid');
}
