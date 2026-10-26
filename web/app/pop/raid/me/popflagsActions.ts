'use server';

// Save a `#popflags` paste for one of YOUR characters. The rules (ownership, idempotency, what is written) are in
// web/lib/popFlagsPasteSave.ts; this only wires them to the session and the table, exactly as saveSeerRecital does
// (web/app/pop/guide/actions.ts). The browser sends the recognised lines; the paste itself is never stored.
// Eight saves in ten minutes per member, per server instance.

import { revalidatePath } from 'next/cache';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { GUILD_TAG } from '@/lib/guild';
import { makeLimiter } from '@/lib/popRecitalSave';
import { PASTE_SOURCE, savePopFlags, type PasteResult } from '@/lib/popFlagsPasteSave';

const pasteAllowed = makeLimiter(8, 10 * 60_000);

export async function savePopFlagsPaste(character: string, lines: string[]): Promise<PasteResult> {
  const admin = supabaseAdmin();
  const res = await savePopFlags({
    guildId: GUILD_TAG,
    userId: async () => (await supabaseServer().auth.getUser()).data.user?.id ?? null,
    owned: async (userId) => (await ownedCharacters(userId)).map(c => c.name),
    heldKeys: async (name, keys) => {
      const { data, error } = await admin.from('pop_flags').select('flag_key')
        .eq('guild_id', GUILD_TAG).eq('source', PASTE_SOURCE)
        .ilike('character', name.replace(/[\\%_]/g, '\\$&')).in('flag_key', keys).limit(100);
      return error ? null : ((data ?? []) as { flag_key: string }[]).map(r => r.flag_key);
    },
    insert: async (rows) => {
      const { error } = await admin.from('pop_flags')
        .upsert(rows, { onConflict: 'guild_id,character,flag_key,earned_at', ignoreDuplicates: true });
      return error ? error.message : null;
    },
    now: () => new Date(),
    allow: pasteAllowed,
  }, character, lines);
  // /pop reads the same rows; the raid page reads them on its next load.
  if (res.ok && res.written > 0) { revalidatePath('/pop'); revalidatePath('/pop/raid/me'); }
  return res;
}
