// The full parse of ONE fight in a raid session review: every player's damage, DPS and share, read when a row is
// expanded rather than with the page. Server-side, service-role client. The members' route
// (/api/raid/session/parse) and the public share route (/api/share/raid/<token>/parse) both call
// `loadFightParse`, so a member and a share visitor are shown the same table.
//
// The share route passes the share row's window. An encounter whose END is outside it comes back null (the route
// answers its one 404), so a visitor holding a token cannot read a fight from another night by guessing ids. The
// review lists a fight by its end, so the guard serves exactly the listed set: one that began a minute before the
// window opened is listed and expandable. Only unclassified fights (no wipe, test or PvP flag) are served, the
// same set the review lists.
//
// A character with `exclude_from_stats` or `exclude_inventory` stays in the rows as their label ("Cleric 2", the
// same one the rest of the review uses; lib/raidSession.ts anonName), unless they won an item in the window,
// in which case they are their name. The percentages and totals are of EVERYONE's damage, labelled players
// included. The server swaps the name before the row leaves; the real name never reaches the browser. Every
// read is bounded for the 1,000-row cap (test/db-read-discipline-web.test.js).
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { chunk } from './replayBosses';
import { inWindow, type ShareWindow } from './raidShare';
import { loadAnon } from './raidShareLookup';
import { LISTED_MARKS, anonName, nameKey, type AnonMap } from './raidSession';

export type ParseRow = { name: string; cls: string | null; damage: number; dps: number | null; pct: number; durationSec: number | null };
export type FightParse = { id: string; durationSec: number | null; totalDamage: number; players: ParseRow[] };

export type FightEnc = { id: string; started_at: string; ended_at: string | null; duration_sec: number | null };
export type FightPlayerIn = { character_name: string; total_damage: number | null; dps: number | null; duration_sec: number | null };

const UUID_RX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const looksLikeEncounterId = (v: unknown): v is string => typeof v === 'string' && UUID_RX.test(v);

/** True when the fight ended inside the window — exactly the fights the review lists (raidSessionLoad filters on ended_at). */
export function fightInWindow(enc: Pick<FightEnc, 'started_at' | 'ended_at'>, win: ShareWindow): boolean {
  return enc.ended_at != null && inWindow(win, Date.parse(enc.ended_at));
}

/** The table: no-damage rows removed, biggest first, each with its share of everyone's damage. Opted-out players are their labels. */
export function buildFightParse(
  enc: FightEnc, players: readonly FightPlayerIn[], classes: ReadonlyMap<string, string | null>, anon: AnonMap,
): FightParse {
  const kept = players.filter(p => typeof p.total_damage === 'number' && p.total_damage > 0);
  const total = kept.reduce((s, p) => s + (p.total_damage ?? 0), 0);
  const rows = kept
    .map<ParseRow>(p => {
      const name = anonName(anon, p.character_name);
      const e = anon.get(nameKey(p.character_name));
      return {
        name,
        // a labelled player's class is the label's; their pet has none. Anyone else: the guild's character table.
        cls: e ? (name === e.label ? e.cls : null) : classes.get(p.character_name.toLowerCase()) ?? null,
        damage: p.total_damage ?? 0,
        dps: typeof p.dps === 'number' ? p.dps : null,
        pct: total > 0 ? ((p.total_damage ?? 0) / total) * 100 : 0,
        durationSec: p.duration_sec ?? enc.duration_sec,
      };
    })
    .sort((a, b) => b.damage - a.damage || a.name.localeCompare(b.name));   // ties on the SHOWN name
  return { id: enc.id, durationSec: enc.duration_sec, totalDamage: total, players: rows };
}

/** One fight's full parse, or null when it is not one this caller may see (unknown id, other guild, marked live / pvp / test, outside `win`). */
export async function loadFightParse(
  sb: SupabaseClient, encounterId: unknown,
  // `win` bounds WHAT is served (a share). `anonWin` only names the session whose bid winners are shown by name, for
  // the members' call, which has no bound; a share's `win` serves for both.
  opts: { guild: string; win?: ShareWindow; anonWin?: ShareWindow },
): Promise<FightParse | null> {
  if (!looksLikeEncounterId(encounterId)) return null;
  const { data, error } = await sb.from('encounters')
    .select('id, started_at, ended_at, duration_sec')
    .eq('id', encounterId)
    .eq('guild_id', opts.guild)
    .or(LISTED_MARKS)   // the marks the review lists (ours, wipes, another guild's), so a listed row opens
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const enc = data as FightEnc;
  if (opts.win && !fightInWindow(enc, opts.win)) return null;

  const [players, anon] = await Promise.all([
    selectAll<FightPlayerIn>((from, to) => sb.from('encounter_players')
      .select('character_name, total_damage, dps, duration_sec')
      .eq('encounter_id', enc.id)
      .order('character_name')
      .range(from, to)),
    loadAnon(sb, opts.guild, opts.win ?? opts.anonWin),
  ]);

  // Class, where the guild's character table knows it. Not for a labelled player: their class is already on the label.
  const shown = players.filter(p => !anon.has(nameKey(p.character_name))).map(p => p.character_name);
  const classes = new Map<string, string | null>();
  for (const names of chunk(shown, 100)) {
    const rows = await selectAll<{ name: string; class: string | null }>((from, to) => sb.from('characters')
      .select('name, class')
      .eq('guild_id', opts.guild)
      .in('name', names)
      .order('name')
      .range(from, to));
    for (const r of rows) classes.set(r.name.toLowerCase(), r.class);
  }
  return buildFightParse(enc, players, classes, anon);
}
