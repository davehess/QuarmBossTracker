// One fight's timeline for the night panel of the session review (?v=slices, ?v=segments): the same stacked damage curve
// the parse page draws (components/DamageCurve.tsx, lib/fightCurve.ts) plus the deaths of the fight, read when a fight is
// opened. Server-side, service-role client; the members' route is /api/raid/session/fight-timeline.
//
// NAMES. The page that holds this is the session review, whose promise is that an opted-out character is only ever their
// class and a number ("Cleric 2"; lib/raidSession.ts). So the damage rows are renamed BEFORE the curve is built, the
// deaths are renamed the same way, and the class of everyone else is read from the guild's character table. The real
// name of an opted-out character never reaches the browser. Pets and NPCs are dropped from the deaths.
//
// COST: one encounter row, the encounter_timeline() rows of that fight (a function, so the filter lands first; paged
// because the 1,000-row cap is silent, see the note on the parse page), that fight's deaths sub-array, and a class
// lookup for its names. Read on demand, one fight at a time.
import type { SupabaseClient } from '@supabase/supabase-js';
import { selectAll } from './selectAll';
import { chunk } from './replayBosses';
import { loadAnon } from './raidShareLookup';
import type { ShareWindow } from './raidShare';
import { anonName, nameKey } from './raidSession';
import { buildFightCurve, type FightCurve, type TimelineRow } from './fightCurve';
import { dedupEncounterDeaths, type RawDeath } from './raidReview';
import { playerDeathName } from './nightSlices';
import { looksLikeEncounterId } from './raidSessionParse';

export type FightTimeline = {
  id: string;
  durationSec: number | null;
  curve: FightCurve | null;
  classOf: Record<string, string | null>;
  /** Seconds from the fight's start; negative is before it. */
  deaths: { name: string; cls: string | null; atSec: number }[];
};

const STEP_SEC = 5;

export async function loadFightTimeline(
  sb: SupabaseClient, encounterId: unknown, opts: { guild: string; anonWin?: ShareWindow },
): Promise<FightTimeline | null> {
  if (!looksLikeEncounterId(encounterId)) return null;
  const { data, error } = await sb.from('encounters')
    .select('id, started_at, duration_sec')
    .eq('id', encounterId).eq('guild_id', opts.guild)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const enc = data as { id: string; started_at: string; duration_sec: number | null };
  const startMs = Date.parse(enc.started_at);

  const [rows, contribs, anon] = await Promise.all([
    selectAll<TimelineRow>((from, to) => sb.rpc('encounter_timeline', { p_encounter_id: enc.id, p_step_sec: STEP_SEC }).range(from, to))
      .catch(() => [] as TimelineRow[]),
    selectAll<{ id: string; deaths: unknown }>((from, to) => sb.from('contributions')
      .select('id, deaths:raw_parse->deaths')
      .eq('encounter_id', enc.id)
      .order('id')
      .range(from, to)),
    loadAnon(sb, opts.guild, opts.anonWin),
  ]);

  const label = (n: string | null) => (n == null ? n : anonName(anon, n));
  const safe = rows.map(r => ({ ...r, char_name: label(r.char_name) as string, pet_owner: label(r.pet_owner) }));
  const curve = safe.length ? buildFightCurve(safe, STEP_SEC) : null;

  const deathRows = dedupEncounterDeaths(contribs.map(c => c.deaths as RawDeath[] | null)).filter(d => playerDeathName(d.name));
  const names = new Set<string>();
  for (const e of curve?.everyone ?? []) names.add(e.name);
  for (const d of deathRows) names.add(anonName(anon, d.name));

  // Class: a labelled player's is the label's; anyone else's is the guild's character table.
  const classOf: Record<string, string | null> = {};
  const lookup: string[] = [];
  const byLabel = new Map<string, string | null>();
  for (const e of anon.values()) byLabel.set(e.label, e.cls);
  for (const n of names) {
    if (byLabel.has(n)) classOf[n] = byLabel.get(n) ?? null;
    else if (!anon.has(nameKey(n))) lookup.push(n);
  }
  for (const part of chunk(lookup, 100)) {
    const found = await selectAll<{ name: string; class: string | null }>((from, to) => sb.from('characters')
      .select('name, class')
      .eq('guild_id', opts.guild)
      .in('name', part)
      .order('name')
      .range(from, to));
    for (const f of found) classOf[f.name] = f.class;
  }

  const deaths = deathRows.map(d => {
    const name = anonName(anon, d.name);
    const t = typeof d.ts === 'number' ? d.ts : Date.parse(d.ts);
    return { name, cls: classOf[name] ?? null, atSec: Math.round((t - startMs) / 1000) };
  }).filter(d => Number.isFinite(d.atSec)).sort((a, b) => a.atSec - b.atSec);

  return { id: enc.id, durationSec: enc.duration_sec, curve, classOf, deaths };
}
