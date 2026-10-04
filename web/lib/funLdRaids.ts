// The two reads behind "a real raid" on the /fun linkdead card (rules in funLd.ts):
// the officers' OpenDKP raids, and the ticks that name the character. The page and
// the server action both call loadRaidDates, so "which LD counts" is one answer.
//
// Takes the client as an argument and imports nothing but selectAll, so the test
// can run it against a fake.

import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { attendeeFilter, attendedRaidDates, raidDatesOf } from './funLd';

type RaidRow = { raid_id: number | string; ts: string | null };

/** All raids, oldest id first. ~420 rows of two columns; a plain select would stop at 1000. */
async function loadRaids(sb: SupabaseClient): Promise<RaidRow[]> {
  const raids = await selectAll<RaidRow>((from, to) => sb
    .from('opendkp_raids')
    .select('raid_id, ts')
    .order('raid_id')
    .range(from, to));
  // selectAll throws on a failed page, so a short list never gets here. An empty
  // one still is not "no raids happened" (there are ~420), it is a read that
  // returned nothing: say so instead of drawing a card that quietly shows no LDs.
  if (raids.length === 0) throw new Error('opendkp_raids returned nothing');
  return raids;
}

/** Every raid date ('YYYY-MM-DD') the officers logged in OpenDKP. */
export async function loadRaidDates(sb: SupabaseClient): Promise<Set<string>> {
  return raidDatesOf(await loadRaids(sb));
}

/**
 * The raid dates, and the ones `name` was ticked on, in one pass over the raids.
 * Only the ticks that name him come back, and only their raid_id (see
 * attendeeFilter), so the read stays small however long the attendee lists are.
 */
export async function loadRaidDatesAndAttendance(
  sb: SupabaseClient,
  name: string,
): Promise<{ raidDates: Set<string>; attended: Set<string> }> {
  const [raids, ticks] = await Promise.all([
    loadRaids(sb),
    selectAll<{ raid_id: number | string }>((from, to) => sb
      .from('opendkp_ticks')
      .select('raid_id')
      .or(attendeeFilter(name))
      .order('tick_id')
      .range(from, to)),
  ]);
  return { raidDates: raidDatesOf(raids), attended: attendedRaidDates(raids, ticks) };
}
