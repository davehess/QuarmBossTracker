'use server';

// Inventory + spellbook upload from /me. Lets a player paste/upload their
// EQ `/outputfile inventory` (and later spellbook) so the quest tracker can
// run against what they actually hold — no officer curation needed. Uploads
// are replace-semantics: a fresh upload fully replaces that character's
// snapshot.
//
// Owner-or-officer gated. The EQ inventory file is a tab-separated table:
//   Location <tab> Name <tab> ID <tab> Count <tab> Slots
// Empty slots ('Empty' / id 0) are skipped. We store the EQ item id
// directly, so downstream joins to eqemu_items (price, no-drop, class/race)
// and eqemu_tradeskill_recipe_entries (crafting components) are exact.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

type ParsedRow = { slot_label: string; item_id: number | null; item_name: string; quantity: number };

// Parse the EQ inventory output. Defensive against tab vs multi-space
// separation and a header row. Returns one row per non-empty slot.
export function parseInventory(text: string): ParsedRow[] {
  const out: ParsedRow[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.replace(/\s+$/, '');
    if (!line.trim()) continue;
    // Prefer tab split; fall back to 2+ spaces if the file was space-padded.
    let cols = line.split('\t');
    if (cols.length < 4) cols = line.split(/\s{2,}/);
    if (cols.length < 4) continue;
    const [location, name, idStr, countStr] = cols.map(c => c.trim());
    if (!location || location.toLowerCase() === 'location') continue;   // header
    const lname = (name || '').trim();
    if (!lname || /^empty$/i.test(lname) || lname === '(empty)') continue;
    // Currency entries (Bank-Coin, General-Coin, SharedBank-Coin, etc.) carry
    // platinum totals — useful but not "items," and they'd skew quantity
    // aggregates. Drop them; the player's wallet is a separate signal.
    if (/-Coin$/i.test(location) || /^Currency$/i.test(lname)) continue;
    const id = parseInt(idStr, 10);
    const count = Math.max(1, parseInt(countStr, 10) || 1);
    // Dedup on slot (one item per slot); the file shouldn't repeat slots but
    // be safe so the unique index upsert never collides within a batch.
    if (seen.has(location)) continue;
    seen.add(location);
    out.push({
      slot_label: location.slice(0, 64),
      item_id: Number.isFinite(id) && id > 0 ? id : null,
      item_name: lname.slice(0, 128),
      quantity: count,
    });
  }
  return out;
}

async function ownsOrOfficer(characterName: string): Promise<{ ok: boolean; officer: boolean; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, officer: false, error: 'not signed in' };
  const officer = await isOfficer(user.id);
  if (officer) return { ok: true, officer: true };
  const admin = supabaseAdmin();
  const [{ data: me }, { data: ch }] = await Promise.all([
    admin.from('wolfpack_members').select('discord_id').eq('user_id', user.id).maybeSingle(),
    admin.from('characters').select('discord_id').eq('guild_id', 'wolfpack').ilike('name', characterName).maybeSingle(),
  ]);
  if (me?.discord_id && ch?.discord_id && me.discord_id === ch.discord_id) {
    return { ok: true, officer: false };
  }
  return { ok: false, officer: false, error: 'not your character' };
}

export async function uploadInventory(characterName: string, rawText: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const name = (characterName || '').trim();
  if (!/^[A-Za-z]{2,}$/.test(name)) return { ok: false, error: 'invalid character name' };
  const gate = await ownsOrOfficer(name);
  if (!gate.ok) return { ok: false, error: gate.error };

  const rows = parseInventory(rawText || '');
  if (rows.length === 0) {
    return { ok: false, error: 'no items parsed — is this an EQ /outputfile inventory file? (expected tab-separated Location/Name/ID/Count rows)' };
  }

  const admin = supabaseAdmin();
  // Resolve canonical character name casing from the roster (so the
  // unique-by-lower index keys consistently).
  const { data: ch } = await admin
    .from('characters').select('name').eq('guild_id', 'wolfpack').ilike('name', name).maybeSingle();
  const canonical = ch?.name || name;

  // Replace snapshot: delete then insert. (Inventory is a point-in-time
  // photo; we don't merge old + new slots.)
  await admin.from('character_inventory')
    .delete().eq('guild_id', 'wolfpack').ilike('character_name', canonical);

  const now = new Date().toISOString();
  const payload = rows.map(r => ({
    guild_id: 'wolfpack',
    character_name: canonical,
    slot_label: r.slot_label,
    item_id: r.item_id,
    item_name: r.item_name,
    quantity: r.quantity,
    observed_at: now,
  }));
  // Insert in chunks to stay well under any payload cap.
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin.from('character_inventory').insert(payload.slice(i, i + 500));
    if (error) return { ok: false, error: error.message };
  }

  revalidatePath('/me');
  revalidatePath(`/character/${encodeURIComponent(canonical)}/quests`);
  return { ok: true, count: rows.length };
}
