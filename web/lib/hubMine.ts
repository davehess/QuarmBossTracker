// A signed-in player's OWN loaded characters (hub_players / hub_characters / hub_flags), shared by /characters and the
// raidmimic landing's "Your Raid Mimic" panel so the two never read it two ways. Keyed on the Discord id taken from the
// session, never from a request. Fails soft to "none yet" when the hub_* tables are absent.
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { characterView, type CharacterView } from '@/lib/hubCharactersView';
import { MAX_CHARACTERS_PER_PLAYER } from '@/lib/hubImport';

export async function loadMine(discordId: string): Promise<CharacterView[]> {
  try {
    const admin = supabaseAdmin();
    const { data: player } = await admin.from('hub_players').select('player_id').eq('discord_id', discordId).is('deleted_at', null).maybeSingle();
    if (!player) return [];
    const { data: chars } = await admin.from('hub_characters').select('name, name_lc, proof').eq('player_id', player.player_id).order('first_seen_at').limit(MAX_CHARACTERS_PER_PLAYER * 4);
    if (!chars?.length) return [];
    // Every row, past the gateway's 1,000-row cap (re-uploads add rows), ordered on the unique id so pages neither skip nor repeat.
    const flags = await selectAll<{ name_lc: string; flag_key: string; earned_at: string }>((from, to) => admin.from('hub_flags')
      .select('name_lc, flag_key, earned_at').eq('player_id', player.player_id).order('id', { ascending: true }).range(from, to),
      { hardCap: 20000 });
    const byName = new Map<string, { flag_key: string; earned_at: string }[]>();
    for (const f of flags ?? []) {
      const k = f.name_lc as string;
      if (!byName.has(k)) byName.set(k, []);
      byName.get(k)!.push({ flag_key: f.flag_key as string, earned_at: f.earned_at as string });
    }
    return chars.map(c => characterView(String(c.name).slice(0, 24), String(c.proof), byName.get(c.name_lc as string) ?? []));
  } catch {
    return [];
  }
}
