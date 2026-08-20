'use server';

// "Characters we think are yours" — the MEMBER side of character linking.
//
// Hitya 2026-08-20: "I need a way for the end user that we suspect these are a
// part of to tell us about these users." Until now the only way an uploading-
// but-unlinked character got filed was an officer working /admin/links, and
// ~110 characters were sitting there unclaimed — mostly traders and bank
// mules, which an officer cannot classify anyway (they don't know whose
// Beltbroker is whose).
//
// The person whose Mimic uploaded the file DOES know. The agent authenticates
// as them, so `agent_upload_stats.uploaded_by_discord_id` is a first-party
// ownership signal — the same signal the web mule-upload already trusts
// (lib/inventoryFile.ts claimVerdict: unclaimed → yours, someone else's →
// refuse). This surfaces that list on /me and lets its owner file each one.
//
// Three outcomes, matching the officer buttons:
//   • Trader     — level-1 Human placeholder, linked to you, never OpenDKP.
//   • Raid alt   — goes through the SAME opendkp_register_requests queue the
//                  officer surface uses (class + level required, 46+ floor).
//   • Not mine   — link_ignored, stops being suggested to anyone.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { raidAltVerdict, TRADER_DEFAULTS } from '@/lib/characterRoles';

type Result = { ok: boolean; error?: string };

// Resolve the signed-in member's household discord ids + their family root.
async function me() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return null;
  const admin = supabaseAdmin();
  const { data: pack } = await admin
    .from('wolfpack_members')
    .select('discord_id, merged_into_discord_id')
    .eq('user_id', user.id)
    .maybeSingle();
  if (!pack?.discord_id) return null;
  const root = pack.merged_into_discord_id || pack.discord_id;
  const { data: aliases } = await admin
    .from('wolfpack_members').select('discord_id')
    .or(`discord_id.eq.${root},merged_into_discord_id.eq.${root}`);
  const household = new Set(((aliases ?? []) as { discord_id: string }[]).map(r => r.discord_id).filter(Boolean));
  household.add(pack.discord_id);
  household.add(root);

  // Family root name for main_name, same rule the mule upload uses.
  const { data: mine } = await admin
    .from('characters').select('name, main_name')
    .eq('guild_id', 'wolfpack').in('discord_id', [...household]).limit(50);
  const familyMain = ((mine ?? []) as { name: string; main_name: string | null }[])
    .map(c => c.main_name || c.name).find(Boolean) || null;

  return { admin, discordId: pack.discord_id, household, familyMain };
}

// The gate: this character must actually be one YOUR agent uploaded, and must
// not already belong to somebody else. Anything else is refused — a member can
// only file characters they demonstrably have on their own machine.
async function assertClaimable(
  admin: ReturnType<typeof supabaseAdmin>,
  household: Set<string>,
  name: string,
): Promise<Result> {
  const { data: up } = await admin
    .from('agent_upload_stats')
    .select('uploaded_by_discord_id')
    .ilike('character', name)
    .limit(50);
  const uploaders = new Set(((up ?? []) as { uploaded_by_discord_id: string | null }[])
    .map(r => r.uploaded_by_discord_id).filter(Boolean) as string[]);
  const mineUploaded = [...uploaders].some(u => household.has(u));
  if (!mineUploaded) return { ok: false, error: 'that character has never uploaded from your machine' };

  const { data: existing } = await admin
    .from('characters').select('discord_id')
    .eq('guild_id', 'wolfpack').ilike('name', name).maybeSingle();
  const owner = (existing as { discord_id: string | null } | null)?.discord_id;
  if (owner && !household.has(owner)) {
    return { ok: false, error: 'that character is already linked to another member' };
  }
  return { ok: true };
}

/** File an uploading-but-unlinked character as YOUR trader. One click, no class. */
export async function claimAsTrader(name: string): Promise<Result> {
  const clean = (name || '').trim();
  if (!/^[A-Za-z]{2,}$/.test(clean)) return { ok: false, error: 'invalid character name' };
  const ctx = await me();
  if (!ctx) return { ok: false, error: 'not signed in' };
  const gate = await assertClaimable(ctx.admin, ctx.household, clean);
  if (!gate.ok) return gate;

  // Upsert rather than update: some uploading characters have no roster row at
  // all yet (the agent writes inventory keyed by name, not by a characters row).
  const { error } = await ctx.admin.from('characters').upsert({
    guild_id:   'wolfpack',
    name:       clean,
    discord_id: ctx.discordId,
    rank:       'Trader',
    race:       TRADER_DEFAULTS.race,
    class:      TRADER_DEFAULTS.cls,
    active:     true,
    link_ignored: false,
    ...(ctx.familyMain ? { main_name: ctx.familyMain, main_name_override: ctx.familyMain } : {}),
    registered_via_web_at: new Date().toISOString(),
    registered_via_web_by_discord_id: ctx.discordId,
  }, { onConflict: 'guild_id,name' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/me');
  revalidatePath('/me/inventory');
  return { ok: true };
}

/** File it as a raid alt — same OpenDKP queue the officer surface writes to. */
export async function claimAsRaidAlt(name: string, cls: string, level: number): Promise<Result> {
  const clean = (name || '').trim();
  if (!/^[A-Za-z]{2,}$/.test(clean)) return { ok: false, error: 'invalid character name' };
  if (!cls || cls === 'UNKNOWN') return { ok: false, error: 'pick a class — OpenDKP needs one' };
  const verdict = raidAltVerdict(level);
  if (!verdict.ok) return { ok: false, error: verdict.message };

  const ctx = await me();
  if (!ctx) return { ok: false, error: 'not signed in' };
  const gate = await assertClaimable(ctx.admin, ctx.household, clean);
  if (!gate.ok) return gate;

  // Parent under the member's own OpenDKP family root when we have one.
  const { data: parent } = await ctx.admin
    .from('characters').select('name, opendkp_id')
    .eq('guild_id', 'wolfpack').ilike('name', ctx.familyMain || clean).maybeSingle();
  const p = parent as { name: string; opendkp_id: number | null } | null;

  const { error } = await ctx.admin.from('opendkp_register_requests').insert({
    guild_id: 'wolfpack',
    name: clean,
    class: cls,
    race: 'Human',                      // same correctable placeholder the officer row uses
    level,
    rank: 'Raid Alt',
    parent_opendkp_id: p?.opendkp_id ?? null,
    parent_name: p?.name ?? null,
    requested_by_discord_id: ctx.discordId,
    uploader_discord_id: ctx.discordId,
    dm_owner: false,                    // they're doing it themselves — no claim DM
    status: 'pending',
  });
  // 23505 = already queued (pending-unique index) — success from the member's view.
  if (error && (error as { code?: string }).code !== '23505') {
    return { ok: false, error: error.message };
  }

  revalidatePath('/me');
  return { ok: true };
}

/** Not mine / never ask again. Same park the officer Ignore button uses. */
export async function dismissSuspected(name: string): Promise<Result> {
  const clean = (name || '').trim();
  if (!/^[A-Za-z]{2,}$/.test(clean)) return { ok: false, error: 'invalid character name' };
  const ctx = await me();
  if (!ctx) return { ok: false, error: 'not signed in' };
  const gate = await assertClaimable(ctx.admin, ctx.household, clean);
  if (!gate.ok) return gate;

  const { error } = await ctx.admin.from('characters').upsert({
    guild_id: 'wolfpack', name: clean, link_ignored: true, active: false,
  }, { onConflict: 'guild_id,name' });
  if (error) return { ok: false, error: error.message };

  revalidatePath('/me');
  return { ok: true };
}
