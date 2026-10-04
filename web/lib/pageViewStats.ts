// What /admin/analytics renders, computed in Postgres (page_view_stats, 20261004140400_cap_safe_admin.sql).
//
// The page used to read page_views with `.limit(50000)` and count in JS. PostgREST returns at most
// 1,000 rows per response and says nothing, so the 7-day default (12,242 views, 38 viewers, 822 routes
// on 2026-10-04) showed 1,000 views from 8 viewers over two days, and every table and the sparkline
// with them. The function returns one jsonb object, which no row cap applies to.

import type { SupabaseClient } from '@supabase/supabase-js';
import { rpcJson } from './rpcJson';

export type PageViewStats = {
  total:          number;
  unique_viewers: number;
  routes_seen:    number;
  paths_seen:     number;
  top_routes:     { route: string; count: number; uniques: number }[];
  top_paths:      { path: string; count: number; uniques: number }[];
  top_users:      { user_id: string; count: number; last_seen: string }[];
  by_day:         { day: string; count: number }[];
};

const EMPTY: PageViewStats = {
  total: 0, unique_viewers: 0, routes_seen: 0, paths_seen: 0,
  top_routes: [], top_paths: [], top_users: [], by_day: [],
};

/** page_views since `sinceIso`, all of it. A failed call reads as an empty range (and is logged). */
export async function loadPageViewStats(sb: SupabaseClient, sinceIso: string): Promise<PageViewStats> {
  const s = await rpcJson<Partial<PageViewStats>>(sb, 'page_view_stats', { p_since: sinceIso }, {});
  return { ...EMPTY, ...s };
}

/** The viewer table: the ids resolved to names, an id with no member row shown as its first 8 characters. */
export function topViewers(
  users: PageViewStats['top_users'],
  nameByUser: Map<string, string>,
): { name: string; count: number; lastSeen: string }[] {
  return users.map(u => ({ name: nameByUser.get(u.user_id) ?? u.user_id.slice(0, 8), count: u.count, lastSeen: u.last_seen }));
}

/** The sparkline: one bar per day of the range, oldest first, zero on a day with no views. Days are UTC. */
export function dailyVolume(
  byDay: PageViewStats['by_day'],
  days: number,
  nowMs: number,
): { day: string; count: number }[] {
  const counts = new Map(byDay.map(d => [d.day, d.count]));
  const out: { day: string; count: number }[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(nowMs - i * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    out.push({ day: d, count: counts.get(d) ?? 0 });
  }
  return out;
}
