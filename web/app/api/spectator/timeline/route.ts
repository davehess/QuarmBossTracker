// GET /api/spectator/timeline: the curated bosses that died in the last six hours, for the raid timeline strip on
// /spectator (web/components/RaidTimeline.tsx).
//
//   -> { now, kills: [{ npc_id, name, at }] }   `at` and `now` in epoch ms, `at` = the encounter's ended_at (the
//                                                kill time from the log; the row lands 30 to 60 s after the kill)
//
// Members-only, the same gate as /api/spectator/positions: a signed-in session, 401 otherwise; the reads use the
// admin client after that check. The read itself (what counts as a boss and a kill, the bounded queries) lives in
// web/lib/raidTimelineLoad.ts, shared with the public share route /api/share/raid/<token>/timeline.
//
// Cached 10 s in this instance's memory, so a room full of open tabs polling every 10 s costs one read a window.
// The cache sits AFTER the auth check.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { loadTimelineKills, type TimelineKill } from '@/lib/raidTimelineLoad';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const CACHE_MS = 10_000;

type Body = { now: number; kills: TimelineKill[] };

let memo: { at: number; body: Body } | null = null;

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const t0 = Date.now();
  if (memo && t0 - memo.at < CACHE_MS) return NextResponse.json(memo.body, { headers: NO_STORE });

  try {
    const kills = await loadTimelineKills(supabaseAdmin(), new Date(t0 - LOOKBACK_MS).toISOString(), new Date(t0 + 60_000).toISOString());
    const body: Body = { now: Date.now(), kills };
    memo = { at: t0, body };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch {
    return fail(500, 'timeline unavailable');
  }
}
