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
import {
  parseInventory, characterFromInventoryFilename, claimVerdict,
  type ParsedInvRow,
} from '@/lib/inventoryFile';

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

  const wrote = await writeInventory(canonical, rows);
  if (wrote.error) return { ok: false, error: wrote.error };

  revalidatePath('/me');
  revalidatePath(`/character/${encodeURIComponent(canonical)}/quests`);
  return { ok: true, count: rows.length };
}

// Replace-semantics snapshot write, shared by the single-character upload above
// and the multi-file mule upload below. Inventory is a point-in-time photo, so
// a fresh upload fully replaces the previous one rather than merging slots.
async function writeInventory(canonical: string, rows: ParsedInvRow[]): Promise<{ error?: string }> {
  const admin = supabaseAdmin();
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
  for (let i = 0; i < payload.length; i += 500) {
    const { error } = await admin.from('character_inventory').insert(payload.slice(i, i + 500));
    if (error) return { error: error.message };
  }
  return {};
}

// ── Multi-file mule upload (Hitya 2026-08-14) ───────────────────────────────
// "Can you make it so that anyone can upload additional inventory files from
// the /me page and have it bring in their other characters/mules?"
//
// The per-character upload above cannot do this: it is gated on the character
// ALREADY existing in `characters` with your discord_id, which is exactly what
// a bank mule is not. Pyxil's (Archanistsells, Lavenderna, Pyxtrade…) exist
// only as files on her disk — no logs, no /who sighting, no OpenDKP row — so
// the FILE is the only evidence they exist and its NAME the only claim of
// whose they are.
//
// Per-file results rather than one verdict: a batch where two of six files are
// somebody else's needs to say which two, not fail as a whole.
export type MuleResult = {
  file: string;
  character: string | null;
  ok: boolean;
  count?: number;
  claimed?: boolean;
  note?: string;
  error?: string;
};

export async function uploadMuleInventories(
  files: { name: string; text: string }[],
): Promise<{ ok: boolean; results: MuleResult[]; error?: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { ok: false, results: [], error: 'not signed in' };

  const admin = supabaseAdmin();
  const { data: me } = await admin
    .from('wolfpack_members')
    .select('discord_id, merged_into_discord_id')
    .eq('user_id', user.id).maybeSingle();
  if (!me?.discord_id) {
    return { ok: false, results: [], error: 'your Discord account is not linked yet — sign in from the tray or ask an officer' };
  }

  // The same household notion /me uses: a person may hold several Discord
  // accounts merged together, and a character on any of them is theirs.
  const root = me.merged_into_discord_id || me.discord_id;
  const { data: aliases } = await admin
    .from('wolfpack_members').select('discord_id')
    .or(`discord_id.eq.${root},merged_into_discord_id.eq.${root}`);
  const household = new Set<string>(
    ((aliases ?? []) as { discord_id: string }[]).map(r => r.discord_id).filter(Boolean),
  );
  household.add(me.discord_id);

  // A new mule joins the uploader's family so /me groups it with their others
  // rather than stranding it as its own root.
  const { data: mine } = await admin
    .from('characters').select('name, main_name, discord_id')
    .eq('guild_id', 'wolfpack').in('discord_id', [...household]).limit(50);
  const familyMain = ((mine ?? []) as { name: string; main_name: string | null }[])
    .map(c => c.main_name || c.name).find(Boolean) || null;

  const results: MuleResult[] = [];
  const seenThisBatch = new Set<string>();

  for (const f of (files || []).slice(0, 40)) {
    const fileName = String(f?.name || '(unnamed)');
    const character = characterFromInventoryFilename(fileName);
    if (!character) {
      results.push({
        file: fileName, character: null, ok: false,
        error: 'could not tell which character this is from the file name — keep it as <Name>-Inventory.txt',
      });
      continue;
    }
    if (seenThisBatch.has(character.toLowerCase())) {
      results.push({ file: fileName, character, ok: false, error: 'two files for the same character in one batch' });
      continue;
    }
    seenThisBatch.add(character.toLowerCase());

    const rows = parseInventory(f?.text || '');
    if (rows.length === 0) {
      results.push({
        file: fileName, character, ok: false,
        error: 'no items parsed — is this an EQ /outputfile inventory file?',
      });
      continue;
    }

    const { data: existing } = await admin
      .from('characters').select('name, discord_id, opendkp_id')
      .eq('guild_id', 'wolfpack').ilike('name', character).maybeSingle();
    const verdict = claimVerdict(existing ?? null, household);
    if (verdict.action === 'refuse') {
      results.push({ file: fileName, character, ok: false, error: verdict.reason });
      continue;
    }

    const canonical = existing?.name || character;
    if (!existing) {
      // Create it, claimed. registered_via_web_* is the existing audit trail
      // for a character that entered the roster through the site rather than
      // through OpenDKP or a log sighting.
      const { error } = await admin.from('characters').insert({
        guild_id: 'wolfpack',
        name: canonical,
        discord_id: me.discord_id,
        main_name: familyMain,
        active: true,
        registered_via_web_at: new Date().toISOString(),
        registered_via_web_by_discord_id: me.discord_id,
      });
      if (error) { results.push({ file: fileName, character, ok: false, error: error.message }); continue; }
    } else if (verdict.claim) {
      // Claiming a row that already existed. Stamp the SAME audit columns a
      // created row gets — the claim rule is deliberately permissive (see
      // claimVerdict), so being able to see who took what, and when, is what
      // makes a wrong one cheap to undo.
      const { error } = await admin.from('characters')
        .update({
          discord_id: me.discord_id,
          main_name: familyMain,
          registered_via_web_at: new Date().toISOString(),
          registered_via_web_by_discord_id: me.discord_id,
        })
        .eq('guild_id', 'wolfpack').ilike('name', canonical);
      if (error) { results.push({ file: fileName, character, ok: false, error: error.message }); continue; }
    }

    const wrote = await writeInventory(canonical, rows);
    if (wrote.error) { results.push({ file: fileName, character, ok: false, error: wrote.error }); continue; }

    results.push({
      file: fileName, character: canonical, ok: true, count: rows.length,
      claimed: !existing || verdict.claim,
    });
  }

  revalidatePath('/me');
  return { ok: results.some(r => r.ok), results };
}
