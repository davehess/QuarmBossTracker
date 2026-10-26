'use server';

// File a "Sync from my logs" request for the signed-in member's own Mimic. The rules (ownership, one open request at
// a time, validation) are in web/lib/popRescan.ts; this only wires them to the session and the table.
// The status is read back by the browser itself (RLS: a member reads their own rows), so polling costs no function
// invocation here.

import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { ownedCharacters } from '@/lib/ownedCharacters';
import { GUILD_TAG } from '@/lib/guild';
import { DEFAULT_DAYS, requestRescan, type RescanResult } from '@/lib/popRescan';

export async function requestLogRescan(character: string | null, days: number = DEFAULT_DAYS): Promise<RescanResult> {
  const admin = supabaseAdmin();
  const res = await requestRescan({
    guildId: GUILD_TAG,
    userId: async () => (await supabaseServer().auth.getUser()).data.user?.id ?? null,
    discordId: async (userId) => {
      const { data } = await admin.from('wolfpack_members').select('discord_id').eq('user_id', userId).maybeSingle();
      return (data as { discord_id: string | null } | null)?.discord_id ?? null;
    },
    owned: async (userId) => (await ownedCharacters(userId)).map(c => c.name),
    open: async (discordId) => {
      const { data, error } = await admin.from('pop_rescan_requests').select('id, status, requested_at, taken_at')
        .eq('guild_id', GUILD_TAG).eq('discord_id', discordId).in('status', ['pending', 'taken'])
        .order('requested_at', { ascending: false }).limit(5);
      return error ? null : ((data ?? []) as { id: number; status: 'pending' | 'taken'; requested_at: string; taken_at: string | null }[]);
    },
    insert: async (row) => {
      const { data, error } = await admin.from('pop_rescan_requests').insert(row).select('id').single();
      return error || !data ? { error: error?.message ?? 'no row' } : { id: (data as { id: number }).id };
    },
    now: () => new Date(),
  }, character, days);
  return res;
}
