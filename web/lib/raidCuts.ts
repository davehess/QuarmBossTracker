// Where a recorded session turns into a DIFFERENT raid (the guild lead, 2026-10-23: the replay's "Raid 7:02 PM-1:06 AM"
// was two raids, Wolf Pack's and then another group's in another zone). Sessions are cut by a silence of over 20
// minutes (SESSION_GAP_MS), which two raids back to back never leave. This finds the extra cuts, with the SAME detector
// as the live timeline and the session review's hint (lib/raidSplit.ts detectRaidChange, its thresholds unchanged), and
// hands them to summarizeNights(rows, cuts), which every consumer of the session list calls: the replay's Session
// dropdown, the /raid/session list, the Spectator's live follow.
//
// WHICH SESSIONS: only the ones that overlap the guild raid window and hold at least 2 x MIN_SIDE_MINUTES recorded
// minutes; a daytime group is never cut. WHAT IT COSTS: the roster of a session is its `data` (~25 KB a minute), so
//   * a FINISHED session (ended over an hour ago) is worked out once and its cuts are stored in bot_kv
//     `raid_cuts:<guild>` ({ v:1, s: { "<first minute>": { to, cuts } } }); every later request reads that one row;
//   * a session still running is re-worked at most every 5 minutes, through the roster cache (lib/raidWho.ts) that
//     reads only minutes not seen before;
//   * at most MAX_COMPUTE sessions are worked out per request, newest first, and only those that began in the last 14
//     days; the rest wait for a later request and are shown whole until then (never cut on a guess).
// A failed read gives no cut: the list falls back to the gap-only sessions.
import type { SupabaseClient } from '@supabase/supabase-js';
import { GUILD_TAG } from './guild';
import { MINUTE_MS, summarizeNights, type NightMinute } from './raidReplay';
import { MIN_SIDE_MINUTES } from './raidSplit';
import { rosterCuts } from './liveRaidWindow';
import { readWhoMinutes } from './raidWho';

export const cutsKey = (guild: string) => `raid_cuts:${guild}`;
export const MAX_COMPUTE = 2;
export const COMPUTE_DAYS = 14;
export const FINISHED_MS = 60 * MINUTE_MS;     // a session whose last minute is this old is final
export const LIVE_RECHECK_MS = 5 * MINUTE_MS;
const KEEP_DAYS = 90;

type Entry = { to: number; cuts: number[] };
type Store = { v: 1; s: Record<string, Entry> };

const emptyStore = (): Store => ({ v: 1, s: {} });

/** The stored value -> a store; anything malformed is an empty one. */
export function parseStore(value: unknown): Store {
  const s = value && typeof value === 'object' ? (value as { s?: unknown }).s : null;
  const out = emptyStore();
  if (!s || typeof s !== 'object') return out;
  for (const [k, e] of Object.entries(s as Record<string, unknown>)) {
    const to = e && typeof e === 'object' ? (e as { to?: unknown }).to : null;
    const cuts = e && typeof e === 'object' ? (e as { cuts?: unknown }).cuts : null;
    if (/^\d{1,10}$/.test(k) && typeof to === 'number' && Array.isArray(cuts) && cuts.every(c => typeof c === 'number' && Number.isFinite(c))) {
      out.s[k] = { to, cuts: cuts as number[] };
    }
  }
  return out;
}

const live = new Map<number, { at: number; cuts: number[] }>();

async function readStore(sb: SupabaseClient): Promise<Store> {
  const { data, error } = await sb.from('bot_kv').select('value')
    .eq('guild_id', GUILD_TAG).eq('key', cutsKey(GUILD_TAG)).limit(1).maybeSingle();
  return error ? emptyStore() : parseStore((data as { value: unknown } | null)?.value);
}

async function writeStore(sb: SupabaseClient, store: Store, nowMs: number): Promise<void> {
  const keep = (nowMs - KEEP_DAYS * 86_400_000) / MINUTE_MS;
  const s: Record<string, Entry> = {};
  for (const [k, e] of Object.entries(store.s)) if (Number(k) >= keep) s[k] = e;
  await sb.from('bot_kv').upsert(
    { guild_id: GUILD_TAG, key: cutsKey(GUILD_TAG), value: { v: 1, s }, updated_at: new Date(nowMs).toISOString() },
    { onConflict: 'guild_id,key' });
}

/** The instants at which the raid changes inside the recorded sessions of `rows` (minute rows as the lists read them). */
export async function loadRaidCuts(sb: SupabaseClient, rows: readonly NightMinute[], nowMs: number = Date.now()): Promise<number[]> {
  const sessions = summarizeNights(rows.slice()).flatMap(n => n.sessions)
    .filter(s => s.raid && s.minutes >= 2 * MIN_SIDE_MINUTES)
    .sort((a, b) => b.from - a.from);
  if (!sessions.length) return [];

  const store = await readStore(sb);
  const cuts: number[] = [];
  let computed = 0, dirty = false;
  const times = rows.map(r => Date.parse(r.minute_at)).filter(Number.isFinite);
  for (const s of sessions) {
    const key = String(Math.round(s.from / MINUTE_MS));
    const toMin = Math.round(s.to / MINUTE_MS);
    const done = store.s[key];
    if (done && done.to === toMin) { cuts.push(...done.cuts); continue; }
    const finished = nowMs - s.to > FINISHED_MS;
    const hot = live.get(s.from);
    if (!finished && hot && nowMs - hot.at < LIVE_RECHECK_MS) { cuts.push(...hot.cuts); continue; }
    if (computed >= MAX_COMPUTE || s.from < nowMs - COMPUTE_DAYS * 86_400_000) continue;
    computed++;
    try {
      const who = await readWhoMinutes(sb, times.filter(t => t >= s.from && t < s.to), nowMs);
      const found = rosterCuts(who);
      cuts.push(...found);
      if (finished) { store.s[key] = { to: toMin, cuts: found }; dirty = true; live.delete(s.from); }
      else live.set(s.from, { at: nowMs, cuts: found });
    } catch { /* no cut for this session this time */ }
  }
  if (dirty) { try { await writeStore(sb, store, nowMs); } catch { /* recomputed next time */ } }
  return cuts;
}
