// Server loader for the "left the Discord" notice and the Access page group. Service-role reads, fewest columns.
// Fails quiet (empty list): the notice is a convenience and must never break the homepage or /admin.
import { supabaseAdmin } from '@/lib/supabase';
import { flagDeparted, DEPARTED_WINDOW_DAYS, type Departed, type DepartedMemberRow, type DepartedLockRow } from '@/lib/departedMembers';

export async function loadDeparted(): Promise<Departed[]> {
  try {
    const admin = supabaseAdmin();
    const since = new Date(Date.now() - DEPARTED_WINDOW_DAYS * 86_400_000).toISOString();
    const { data: rows } = await admin
      .from('wolfpack_members')
      .select('discord_id, user_id, nickname, global_name, is_member, refreshed_at')
      .eq('is_member', false)
      .is('merged_into_discord_id', null)
      .gte('refreshed_at', since)
      .order('refreshed_at', { ascending: false })
      .limit(100);
    const members = (rows || []) as DepartedMemberRow[];
    if (!members.length) return [];
    const ids = members.map(m => m.discord_id);
    const [{ data: locks }, { data: sess }] = await Promise.all([
      admin.from('member_lockouts').select('discord_id, until').in('discord_id', ids),
      admin.from('mimic_sessions').select('discord_id').in('discord_id', ids).is('revoked_at', null),
    ]);
    return flagDeparted({
      members,
      locks: (locks || []) as DepartedLockRow[],
      liveMimicIds: ((sess || []) as { discord_id: string }[]).map(s => s.discord_id),
    });
  } catch {
    return [];
  }
}
