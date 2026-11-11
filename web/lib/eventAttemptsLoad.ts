// The database read behind the gold splits (server only): the encounter rows on an event's mobs, over all history.
// Narrow columns, paged with selectAll on the primary key (a unique order). Members only: the pages check the session
// before calling.
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { selectAll } from '@/lib/selectAll';
import { selectInChunks } from '@/lib/selectInChunks';
import { buildAttempts, oursOnly, rowSide, type Attempt, type EncRow } from '@/lib/eventAttempts';
import { defNpcIds, splitsDefFor, type SplitsDef } from '@/lib/eventSplitsDefs';
import { EVENTS, eventBySlug, type PopEvent } from '@/lib/popEvents';

const COLS = 'id, npc_id, raid_night_id, started_at, ended_at, classification, is_wipe';

/**
 * Mark each row ours or another guild's (the guild lead, 2026-11-11): a member who raids with another guild has that
 * raid recorded under our guild id. Reads only the player names of the rows' encounters and our roster's names.
 */
async function withSides(rows: EncRow[]): Promise<EncRow[]> {
  if (!rows.length) return rows;
  const sb = supabaseAdmin();
  const roster = await selectAll<{ name: string }>((from, to) =>
    sb.from('characters').select('name').eq('guild_id', GUILD_TAG).order('name').range(from, to));
  const wp = new Set(roster.map(r => r.name.toLowerCase()));
  const players = await selectInChunks<string, { encounter_id: string; character_name: string }>(rows.map(r => r.id), (keys, from, to) =>
    sb.from('encounter_players').select('encounter_id, character_name').in('encounter_id', keys)
      .order('encounter_id').order('character_name').range(from, to));
  const byEnc = new Map<string, string[]>();
  for (const p of players) { const l = byEnc.get(p.encounter_id); if (l) l.push(p.character_name); else byEnc.set(p.encounter_id, [p.character_name]); }
  return rows.map(r => ({ ...r, side: rowSide(r.classification, byEnc.get(r.id) ?? [], wp) }));
}

export async function loadEventRows(npcIds: number[]): Promise<EncRow[]> {
  const sb = supabaseAdmin();
  return withSides(await selectInChunks<number, EncRow>(npcIds, (keys, from, to) =>
    sb.from('encounters').select(COLS).eq('guild_id', GUILD_TAG).in('npc_id', keys).order('id').range(from, to)));
}

export async function loadEventAttempts(slug: string): Promise<{ event: PopEvent; def: SplitsDef; attempts: Attempt[] } | null> {
  const event = eventBySlug(slug);
  const def = splitsDefFor(slug);
  if (!event || !def) return null;
  const sb = supabaseAdmin();
  const rows = await withSides(await selectAll<EncRow>((from, to) =>
    sb.from('encounters').select(COLS).eq('guild_id', GUILD_TAG).in('npc_id', defNpcIds(def, event)).order('id').range(from, to)));
  return { event, def, attempts: buildAttempts(def, rows) };
}

/** `attempts`, `successes`, `bestSec` and `lastMs` count our runs only; `otherAttempts` is another guild's, shown beside them. */
export type EventSummary = { slug: string; attempts: number; successes: number; bestSec: number | null; lastMs: number | null; otherAttempts: number };

/** Every event that has at least one attempt, for the index. One chunked read, grouped per event in memory. */
export async function loadEventSummaries(computeBest: (def: SplitsDef, attempts: Attempt[]) => number | null): Promise<EventSummary[]> {
  const ids = new Set<number>();
  for (const e of EVENTS) { const d = splitsDefFor(e.slug); if (d) defNpcIds(d, e).forEach(n => ids.add(n)); }
  const rows = await loadEventRows([...ids]);
  const byNpc = new Map<number, EncRow[]>();
  for (const r of rows) { const l = byNpc.get(r.npc_id); if (l) l.push(r); else byNpc.set(r.npc_id, [r]); }
  const out: EventSummary[] = [];
  for (const e of EVENTS) {
    const def = splitsDefFor(e.slug);
    if (!def) continue;
    const mine = defNpcIds(def, e).flatMap(n => byNpc.get(n) ?? []);
    if (!mine.length) continue;
    const all = buildAttempts(def, mine);
    const attempts = oursOnly(all);
    if (!attempts.length) continue;
    out.push({
      slug: e.slug, attempts: attempts.length, successes: attempts.filter(a => a.success).length,
      bestSec: computeBest(def, attempts), lastMs: Math.max(...attempts.map(a => a.startMs)),
      otherAttempts: all.length - attempts.length,
    });
  }
  return out;
}
