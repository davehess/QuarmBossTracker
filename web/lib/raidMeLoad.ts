// The reads behind /pop/raid/me (lib/raidMe.ts holds the rules). SERVER ONLY: it uses the service client.
//
// Two questions, both about the signed-in member and the next raid night:
//   - which raid-helper event is next (rh_events; the choice is lib/raidPlan.ts pickNextRaidEvent, the
//     same evening-event rule /pop/raid uses for its fixed night);
//   - did this member sign up for it, and as which class (rh_signups, by the member's Discord id, or any id in
//     the household when accounts are merged: the walk ownedCharacters does for characters).
// What each character holds is not read here: lib/raidPreflags.ts loadHeld already merges Mimic, ticks and /who.
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { NOT_GOING, pickNextRaidEvent } from '@/lib/raidPlan';

export type NextEvent = { id: string; title: string; start_time: string };
export type MySignup = { status: string | null; class_name: string | null };

/** The next raid-helper event, today (Eastern) or later. Null when none is scheduled. */
export async function loadNextEvent(now: Date = new Date()): Promise<NextEvent | null> {
  const { data, error } = await supabaseAdmin().from('rh_events')
    .select('id, title, start_time')
    // A day back covers the Eastern day boundary; pickNextRaidEvent drops anything before today.
    .gte('start_time', new Date(now.getTime() - 24 * 3600_000).toISOString())
    .order('start_time', { ascending: true }).limit(100);
  if (error) throw new Error(`events: ${error.message}`);
  return pickNextRaidEvent((data ?? []) as NextEvent[], now);
}

/** Every Discord id in the member's household: their own, the one their accounts merged into, and the others merged there. */
async function householdDiscordIds(userId: string): Promise<string[]> {
  const sb = supabaseAdmin();
  const { data: me } = await sb.from('wolfpack_members')
    .select('discord_id, merged_into_discord_id').eq('user_id', userId).maybeSingle();
  const row = me as { discord_id: string | null; merged_into_discord_id: string | null } | null;
  if (!row?.discord_id) return [];
  const root = row.merged_into_discord_id || row.discord_id;
  const { data: aliases } = await sb.from('wolfpack_members')
    .select('discord_id').or(`discord_id.eq.${root},merged_into_discord_id.eq.${root}`).limit(100);
  return [...new Set([row.discord_id, root, ...((aliases ?? []) as { discord_id: string | null }[]).map(a => a.discord_id)]
    .filter((d): d is string => !!d))];
}

/** The member's own sign-up for an event: a yes if they have one, else whatever they filed (absent, tentative...). */
export async function loadMySignup(eventId: string, userId: string): Promise<MySignup | null> {
  const ids = await householdDiscordIds(userId);
  if (ids.length === 0) return null;
  const rows = await selectAll<MySignup>((from, to) =>
    supabaseAdmin().from('rh_signups').select('status, class_name')
      .eq('event_id', eventId).in('discord_id', ids)
      .order('signup_id', { ascending: true }).range(from, to));
  const yes = rows.find(r => !NOT_GOING.test(String(r.status || '')) && !NOT_GOING.test(String(r.class_name || '')));
  return yes ?? rows[0] ?? null;
}
