// Who is going on the raid night and who holds each preflag. SERVER ONLY (it reads with the service client):
// /pop/raid draws the full table from it, and /screen reads the same two functions for its Overview box
// (the guild lead picked option C for the screen, 2026-10-14). Moved out of app/pop/raid/page.tsx unchanged
// so both pages answer the question the same way; the pure part that shapes the answer for a client lives
// in lib/screenPlan.ts.
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { stepsHeld } from '@/lib/popSteps';
import { popRoster, RAIDER_RANKS, RAID_ALT_RANKS } from '@/lib/popRoster';
import { SELF_TICK_KEYS, selfFlagsFromTicks } from '@/lib/popSelfFlags';
import { WHO_ZONE_NAMES, flagsFromSightings, type Sighting } from '@/lib/popWho';
import { RAID_DATE, pickRaidEvent } from '@/lib/raidPlan';
import { GUILD_TAG } from '@/lib/guild';

// Raid-Helper sign-up statuses that do not count as coming (commands/preraid.js uses the same test).
const NOT_GOING = /absen|declin|bench|tentat/i;
const GUILD = GUILD_TAG;

export type Raider = { name: string; cls: string | null };

const chunks = <T,>(xs: T[], n = 100): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
};

export async function loadRaiders(): Promise<{ raiders: Raider[]; note: string; unlinked: string[] }> {
  const sb = supabaseAdmin();
  const { data: evRows, error: evErr } = await sb.from('rh_events')
    .select('id, title, start_time')
    .gte('start_time', '2026-10-14T00:00:00Z').lt('start_time', '2026-10-16T00:00:00Z')
    .order('start_time', { ascending: true }).limit(50);
  if (evErr) throw new Error(`events: ${evErr.message}`);
  const event = pickRaidEvent((evRows ?? []) as { id: string; title: string; start_time: string }[], RAID_DATE);

  if (event) {
    const signups = await selectAll<{ discord_id: string | null; user_name: string | null; status: string | null; class_name: string | null }>((from, to) =>
      sb.from('rh_signups').select('discord_id, user_name, status, class_name')
        .eq('event_id', event.id)
        .order('signup_id', { ascending: true }).range(from, to));
    const going = signups.filter(s => !NOT_GOING.test(String(s.status || '')));
    const ids = [...new Set(going.map(s => s.discord_id).filter((d): d is string => !!d))];
    // A main's main_name is its own name (null on a few old rows), so read every character the player has and
    // keep the mains here. characters has no level column (it lives in who_directory).
    type Row = { name: string; discord_id: string; class: string | null; rank: string | null; active: boolean | null; main_name: string | null };
    const rows: Row[] = [];
    for (const part of chunks(ids)) {
      const { data, error } = await sb.from('characters')
        .select('name, discord_id, class, rank, active, main_name')
        .eq('guild_id', GUILD).in('discord_id', part).limit(1000);
      if (error) throw new Error(`characters: ${error.message}`);
      rows.push(...(data ?? []) as Row[]);
    }
    const mains = rows.filter(c => !c.main_name || c.main_name.toLowerCase() === c.name.toLowerCase());
    // One main per player: the one on the class they signed up as, then active, then on a raider rank.
    const signedClass = new Map(going.map(s => [s.discord_id, String(s.class_name || '').toLowerCase()]));
    const score = (x: Row) => {
      const want = signedClass.get(x.discord_id) || '';
      const cls = String(x.class || '').toLowerCase();
      return (want && cls && (want.startsWith(cls) || cls.startsWith(want)) ? 4 : 0)
        + (x.active ? 2 : 0) + (RAIDER_RANKS.includes(x.rank ?? '') ? 1 : 0);
    };
    const best = new Map<string, Row>();
    for (const c of mains) {
      const cur = best.get(c.discord_id);
      if (!cur || score(c) > score(cur)) best.set(c.discord_id, c);
    }
    const linked = new Set(best.keys());
    const unlinked = going.filter(s => !s.discord_id || !linked.has(s.discord_id)).map(s => s.user_name || 'unknown');
    const raiders = [...best.values()].map(c => ({ name: c.name, cls: c.class })).sort((a, b) => a.name.localeCompare(b.name));
    if (raiders.length) {
      return { raiders, note: `Sign-ups: ${event.title}, ${going.length} going.`, unlinked };
    }
  }

  // No event, or nobody on it linked to a character: the whole raid roster, mains only.
  const { data: rosterRaw, error } = await sb.from('characters')
    .select('name, rank, active, class')
    .eq('guild_id', GUILD).in('rank', [...RAIDER_RANKS, ...RAID_ALT_RANKS]).limit(1000);
  if (error) throw new Error(`roster: ${error.message}`);
  const rows = (rosterRaw ?? []) as { name: string; rank: string | null; active: boolean | null; class: string | null }[];
  const levelOf = new Map<string, number>();
  for (const part of chunks(rows)) {
    const seen = await selectAll<{ character_key: string; level: number | null }>((from, to) =>
      sb.from('who_directory').select('character_key, level')
        .in('character_key', part.map(r => r.name.toLowerCase()))
        .order('character_key', { ascending: true }).range(from, to));
    for (const w of seen) {
      if (w.level != null && w.level > (levelOf.get(w.character_key) ?? 0)) levelOf.set(w.character_key, w.level);
    }
  }
  const members = popRoster(rows.map(r => ({ ...r, level: levelOf.get(r.name.toLowerCase()) ?? null }))).filter(m => m.main);
  const clsOf = new Map(rows.map(r => [r.name.toLowerCase(), r.class]));
  const raiders = members.map(m => ({ name: m.name, cls: clsOf.get(m.name.toLowerCase()) ?? null }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { raiders, note: 'No sign-up event found: showing all raiders.', unlinked: [] };
}

// Mimic's recorded flags, the owners' ticks and /who proof, merged, then expanded by what each step implies.
export async function loadHeld(names: string[]): Promise<Map<string, Set<string>>> {
  const sb = supabaseAdmin();
  const flags = new Map<string, Set<string>>(names.map(n => [n.toLowerCase(), new Set<string>()]));
  const add = (key: string, flag: string) => flags.get(key)?.add(flag);

  const [flagRows, tickRows, sightRows] = await Promise.all([
    Promise.all(chunks(names).map(part => selectAll<{ character: string; flag_key: string }>((from, to) =>
      sb.from('pop_flags').select('character, flag_key')
        .in('character', part).not('flag_key', 'in', '(unmapped,hail)')
        .order('id', { ascending: true }).range(from, to)))),
    Promise.all(chunks(names).map(part => selectAll<{ character_name: string; item_key: string }>((from, to) =>
      sb.from('pop_guide_ticks').select('character_name, item_key')
        .eq('guild_id', GUILD).in('item_key', SELF_TICK_KEYS).in('character_name', part)
        .order('character_name', { ascending: true }).order('item_key', { ascending: true }).range(from, to)))),
    selectAll<Sighting & { character_key: string }>((from, to) =>
      sb.rpc('pop_who_sightings', { p_guild_id: GUILD, p_names: names.map(n => n.toLowerCase()), p_zones: WHO_ZONE_NAMES }).range(from, to)),
  ]);

  for (const r of flagRows.flat()) add(r.character.toLowerCase(), r.flag_key);
  for (const [k, fs] of selfFlagsFromTicks(tickRows.flat())) for (const f of fs) add(k, f);
  const sightBy = new Map<string, Sighting[]>();
  for (const r of sightRows) {
    if (!sightBy.has(r.character_key)) sightBy.set(r.character_key, []);
    sightBy.get(r.character_key)!.push(r);
  }
  for (const [k, rows] of sightBy) for (const f of flagsFromSightings(rows).keys()) add(k, f);

  return new Map([...flags].map(([k, set]) => [k, stepsHeld(set)]));
}
