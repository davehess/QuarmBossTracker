// The reads behind /admin/triggers that pass 1,000 rows: the trigger-timing-feedback rollup, aggregated
// in Postgres (trigger_timing_feedback_rollup, 20261004140400_cap_safe_admin.sql), and the trigger list,
// which is paged.
//
// The page used to read 30 days of trigger_timing_feedback with `.limit(5000)` and tally in JS.
// PostgREST returns at most 1,000 rows per response and says nothing, so on 2026-10-04 it tallied the
// newest 1,000 of 48,294 rows ("1,000 votes on 52 triggers"; the true figure is 237 triggers).
//
// ⚠ NOT ALL OF THOSE ROWS ARE VOTES. Since #207 the table also records `dismissed` and `expired`
// (20260811120000_trigger_feedback_dismissal_directions.sql): of the 48,294 rows in 30 days, 12 are
// the explicit « earlier / ✓ good / » too early votes and 48,282 are expired or dismissed. The page has
// always counted EVERY row in `total` and judged the recommendation against it, and this keeps doing
// that exactly: completing the read does not change what the page means by a vote. Whether a dismissal
// or an expiry should count towards "votes" is the guild lead's call, and the three counts below are
// all it would take.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rpcJson } from './rpcJson';
import { selectAll } from './selectAll';

/**
 * The guild trigger list, in the order the page shows it (category, name), optionally one category.
 * The table is 512 rows (one import added 381 of them) and a plain read stops at 1,000 without saying
 * so, so it is paged; `id` makes the display order unique, which paging needs.
 */
export function loadGuildTriggers<T>(sb: SupabaseClient, columns: string, category?: string): Promise<T[]> {
  return selectAll<T>((from, to) => {
    let q = sb.from('guild_triggers').select(columns).order('category').order('name').order('id');
    if (category) q = q.eq('category', category);
    return q.range(from, to) as unknown as PromiseLike<{ data: T[] | null; error: unknown }>;
  });
}

export type FbRollupRow = {
  name:       string;
  direction:  string;
  n:          number;
  last_vote:  string | null;
  trigger_id: string | null;
};

export type FbAgg = {
  name:      string;
  total:     number;
  earlier:   number;
  good:      number;
  tooEarly:  number;
  lastVote:  string | null;
  triggerId: string | null;
};

/** The per-(trigger, direction) tallies since `sinceIso`, all of them. A failed call reads as none (and is logged). */
export const loadFeedbackRollup = (sb: SupabaseClient, sinceIso: string): Promise<FbRollupRow[]> =>
  rpcJson<FbRollupRow[]>(sb, 'trigger_timing_feedback_rollup', { p_since: sinceIso }, []);

/**
 * One row per trigger, most-voted first (ties by name). `total` counts every row whatever its
 * direction, as the page always has; earlier/good/tooEarly count only those three directions.
 */
export function foldFeedback(rows: FbRollupRow[]): { aggs: FbAgg[]; total: number } {
  const byName = new Map<string, FbAgg>();
  let total = 0;
  for (const r of rows) {
    const k = (r.name || '(unknown)').trim();
    let a = byName.get(k);
    if (!a) { a = { name: k, total: 0, earlier: 0, good: 0, tooEarly: 0, lastVote: null, triggerId: r.trigger_id || null }; byName.set(k, a); }
    a.total += r.n;
    total += r.n;
    if (r.direction === 'earlier')         a.earlier  += r.n;
    else if (r.direction === 'good')       a.good     += r.n;
    else if (r.direction === 'too_early')  a.tooEarly += r.n;
    if (r.last_vote && (!a.lastVote || Date.parse(r.last_vote) > Date.parse(a.lastVote))) a.lastVote = r.last_vote;
    if (!a.triggerId && r.trigger_id) a.triggerId = r.trigger_id;
  }
  const aggs = [...byName.values()].sort((a, b) => b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  return { aggs, total };
}
