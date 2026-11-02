// Data for the gate variants (?v=gate-a, ?v=gate-b) that loadRoute does not carry: WHICH characters have had a full
// read of their flags. A Seer recital or a #popflags read (Mimic's, or a paste) lists every flag the character holds, so for them an absent
// flag is a real "no" (❌); for everyone else it only means nobody saw it (❓). See web/lib/popGateStatus.ts.
//
// One cheap read per character (limit 1): pop_flags.character is free text, so the match is case-blind like /pop's.

import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';

export async function loadFullReads(names: string[]): Promise<Set<string>> {
  const admin = supabaseAdmin();
  const hits = await Promise.all(names.map(async name => {
    const { data } = await admin.from('pop_flags').select('character').eq('guild_id', GUILD_TAG).ilike('character', name)
      .in('source', ['recital', 'popflags', 'popflags_paste']).limit(1);
    return (data ?? []).length > 0 ? name.toLowerCase() : null;
  }));
  return new Set(hits.filter((n): n is string => !!n));
}
