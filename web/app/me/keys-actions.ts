'use server';

// /keys upload from /me. Same pattern as inventory: parse the log-line burst
// the EQ /keys command produces, store as a replace-semantics snapshot.
//
// Real format (Uilnayar 2026-06-23 screenshot):
//   [09:06:12] Trakanon Idol
//   [09:06:12] Key of Veeshan
//   [09:06:12] Sky: Island 1.5 (Noble Dojorn)
//   [09:06:12] Sky: Island 1 (Azarack)
//   …
// All lines from the same /keys invocation share the timestamp; we use the
// timestamp burst as the natural framing. The parser also accepts plain
// pasted key names (no timestamp prefix) so users can paste a clean list.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';

type ParsedKey = { key_name: string };

// Strip the `[HH:MM:SS] ` log prefix when present; trim; drop empties + dupes.
function parseKeys(text: string): ParsedKey[] {
  const out: ParsedKey[] = [];
  const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    let line = raw.trim();
    if (!line) continue;
    // Strip the EQ log prefix "[HH:MM:SS] " if present.
    line = line.replace(/^\[\d{1,2}:\d{2}:\d{2}\]\s*/, '');
    // Strip a second optional timestamp some clients emit.
    line = line.replace(/^\(\d{1,2}:\d{2}:\d{2}\)\s*/, '');
    line = line.trim();
    if (!line) continue;
    // Filter obvious non-key chatter that occasionally lands on the same
    // second — system messages, combat lines, anything containing a verb
    // pattern that keys don't have.
    if (/(^You |^Your |hits|misses| says,|tells the |tells you|begins to cast|loots a|has been slain)/i.test(line)) continue;
    if (line.length < 3 || line.length > 96) continue;
    const k = line.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push({ key_name: line });
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
  if (me?.discord_id && ch?.discord_id && me.discord_id === ch.discord_id) return { ok: true, officer: false };
  return { ok: false, officer: false, error: 'not your character' };
}

export async function uploadKeys(characterName: string, rawText: string): Promise<{ ok: boolean; count?: number; error?: string }> {
  const name = (characterName || '').trim();
  if (!/^[A-Za-z]{2,}$/.test(name)) return { ok: false, error: 'invalid character name' };
  const gate = await ownsOrOfficer(name);
  if (!gate.ok) return { ok: false, error: gate.error };

  const keys = parseKeys(rawText || '');
  if (keys.length === 0) return { ok: false, error: 'no keys parsed — paste the lines from /keys (timestamps optional)' };

  const admin = supabaseAdmin();
  const { data: ch } = await admin
    .from('characters').select('name').eq('guild_id', 'wolfpack').ilike('name', name).maybeSingle();
  const canonical = ch?.name || name;

  // Best-effort match each key to eqemu_items.id by exact name (case-
  // insensitive). Quarm-custom keys ("Sky: Island 1.5 (Noble Dojorn)") may
  // not resolve — that's fine; key_name is the display value.
  const { data: matches } = await admin
    .from('eqemu_items')
    .select('id, name')
    .in('name', keys.map(k => k.key_name).slice(0, 200));
  const idByLowerName = new Map<string, number>();
  for (const m of ((matches ?? []) as { id: number; name: string }[])) {
    if (!idByLowerName.has(m.name.toLowerCase())) idByLowerName.set(m.name.toLowerCase(), m.id);
  }

  // Replace snapshot — keyring is a current state, not a history log.
  await admin.from('character_keys')
    .delete().eq('guild_id', 'wolfpack').ilike('character_name', canonical);

  const now = new Date().toISOString();
  const rows = keys.map(k => ({
    guild_id: 'wolfpack',
    character_name: canonical,
    key_name: k.key_name,
    item_id: idByLowerName.get(k.key_name.toLowerCase()) ?? null,
    observed_at: now,
  }));
  const { error } = await admin.from('character_keys').insert(rows);
  if (error) return { ok: false, error: error.message };

  revalidatePath('/me');
  revalidatePath(`/character/${encodeURIComponent(canonical)}/quests`);
  return { ok: true, count: rows.length };
}
