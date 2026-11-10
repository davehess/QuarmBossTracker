'use server';

// Load characters from Zeal's `<Name>-PoPFlags.txt` exports (DECISIONS §545). The rules are web/lib/hubImport.ts; this
// wires them to the session and the hub_* tables with the service role, server-side only. The player is the SIGNED-IN
// one, taken from the session, never from an argument. Writes go to hub_characters and hub_flags and nothing else; the
// only Wolf Pack table touched is one READ of `characters`, for the claim rule.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { discordIdOf } from '@/lib/lockout';
import { GUILD_TAG } from '@/lib/guild';
import { makeLimiter } from '@/lib/popRecitalSave';
import { profileOf } from '@/lib/hubRegistry';
import { importExports, MAX_FILE_BYTES, MAX_FILES_PER_UPLOAD, type ImportDeps, type ImportResult } from '@/lib/hubImport';

const allowed = makeLimiter(10, 10 * 60_000);

export async function importCharacters(formData: FormData): Promise<ImportResult> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  const discordId = discordIdOf(user);
  if (!user || !discordId) return { ok: false, error: 'Sign in first.' };
  if (!allowed(discordId)) return { ok: false, error: 'Too many uploads. Wait a few minutes and try again.' };

  const entries = formData.getAll('files').filter((f): f is File => typeof f === 'object' && f !== null && 'text' in f);
  if (entries.length > MAX_FILES_PER_UPLOAD) return { ok: false, error: `Up to ${MAX_FILES_PER_UPLOAD} files at a time.` };
  // An oversize file is measured, not read: only its size reaches the rules, which reject it.
  const files = await Promise.all(entries.map(async f => ({
    name: String(f.name || 'file'), size: f.size, text: f.size > MAX_FILE_BYTES ? '' : await f.text(),
  })));

  const admin = supabaseAdmin();
  const { displayName, avatarUrl } = profileOf(user);
  const { data: player, error: playerError } = await admin.from('hub_players')
    .upsert({ discord_id: discordId, display_name: displayName, avatar_url: avatarUrl, last_seen_at: new Date().toISOString() }, { onConflict: 'discord_id' })
    .select('player_id, deleted_at')
    .single();
  if (playerError || !player) return { ok: false, error: 'Raid Mimic accounts are not open yet.' };
  if (player.deleted_at) return { ok: false, error: 'This account was deleted.' };
  const playerId = player.player_id as string;

  const deps: ImportDeps = {
    playerId, discordId, now: Date.now,
    async heldNames() {
      const { data, error } = await admin.from('hub_characters').select('name_lc').eq('player_id', playerId).limit(200);
      return error ? null : (data ?? []).map(r => r.name_lc as string);
    },
    async wolfpackOwners(lcs) {
      // Names are letters only (NAME_RX), so they are safe inside the filter.
      const { data, error } = await admin.from('characters').select('name, discord_id')
        .eq('guild_id', GUILD_TAG).or(lcs.map(lc => `name.ilike.${lc}`).join(',')).limit(500);
      if (error) return null;
      const m = new Map<string, string>();
      for (const r of data ?? []) {
        const lc = String(r.name || '').toLowerCase();
        if (lc && r.discord_id && !m.has(lc)) m.set(lc, String(r.discord_id));
      }
      return m;
    },
    async holders(lcs) {
      const { data, error } = await admin.from('hub_characters').select('player_id, name_lc, proof').in('name_lc', lcs).limit(1000);
      if (error) return null;
      const m = new Map<string, { player_id: string; proof: string }[]>();
      for (const h of data ?? []) {
        const k = h.name_lc as string;
        if (!m.has(k)) m.set(k, []);
        m.get(k)!.push({ player_id: h.player_id as string, proof: h.proof as string });
      }
      return m;
    },
    async insertCharacters(rows) {
      const { error } = await admin.from('hub_characters').upsert(rows, { onConflict: 'player_id,name_lc', ignoreDuplicates: true });
      return error ? error.message : null;
    },
    async touchCharacters(pid, lcs) {
      const { error } = await admin.from('hub_characters').update({ last_seen_at: new Date().toISOString() }).eq('player_id', pid).in('name_lc', lcs);
      return error ? error.message : null;
    },
    async flipContested(lcs) {
      const { error } = await admin.from('hub_characters').update({ proof: 'contested' }).in('name_lc', lcs).eq('proof', 'claimed');
      return error ? error.message : null;
    },
    async insertFlags(rows) {
      const { error } = await admin.from('hub_flags').upsert(rows, { onConflict: 'player_id,name_lc,flag_key,earned_at', ignoreDuplicates: true });
      return error ? error.message : null;
    },
  };

  const result = await importExports(files, deps);
  if (result.ok) revalidatePath('/characters');
  return result;
}
