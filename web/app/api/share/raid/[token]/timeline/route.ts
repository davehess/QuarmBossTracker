// GET /api/share/raid/<token>/timeline: the curated bosses killed inside a shared session, for the raid timeline strip
// on the public share page (the guild lead, 2026-10-21: the Tactics timeline for another guild's raid leadership,
// "i need it beforehand"). The token is the whole credential; the window is the share row's.
//
//   -> { now, ended, kills: [{ npc_id, name, at }] }   the same shape /api/spectator/timeline serves, plus `ended`:
//                                                       true once the window is over, and `now` then stops at its end
//
// Boss names and kill times only (web/lib/raidTimelineLoad.ts): nothing a guest could not already read off the share
// page's own boss list. ABUSE as the other share routes (lib/shareGuard.ts): per-IP limit before the lookup, per-share
// hourly ceiling after it. The lookup stays OUTSIDE the cache, so an expired or revoked link is refused on every
// request; the read is kept 10 s per share in this instance's memory, so a room of guests polling costs one read a window.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveShare } from '@/lib/raidShareLookup';
import { ceilingApi, guardApi } from '@/lib/shareGuard';
import { loadTimelineKills, type TimelineKill } from '@/lib/raidTimelineLoad';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex, nofollow' };
const CACHE_MS = 10_000;
const MEMO_MAX = 200;

const memo = new Map<string, { at: number; kills: TimelineKill[] }>();

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const limited = guardApi(req);
  if (limited) return limited;
  try {
    const sb = supabaseAdmin();
    const share = await resolveShare(sb, params.token);
    if (!share) return NextResponse.json({ error: 'not found' }, { status: 404, headers: HEADERS });
    const over = ceilingApi(share.row.id);
    if (over) return over;

    const t0 = Date.now();
    // Kept per share AND per stored window: a share whose start or end was moved (an officer's change, or a hand edit of
    // the row) must not be answered from the old window's read for the rest of the 10 s. The row's own columns, not the
    // computed window, because an open share's window ends at the clock and would never hit.
    const memoKey = `${share.row.id}|${share.row.from_at}|${share.row.to_at}`;
    let hit = memo.get(memoKey);
    if (!hit || t0 - hit.at >= CACHE_MS) {
      const kills = await loadTimelineKills(sb, new Date(share.win.fromMs).toISOString(), new Date(share.win.toMs).toISOString(), share.row.guild_id, { guestRaids: true });
      hit = { at: t0, kills };
      memo.delete(memoKey);
      memo.set(memoKey, hit);
      if (memo.size > MEMO_MAX) memo.delete(memo.keys().next().value as string);
    }
    const now = Date.now();
    const ended = now >= share.win.toMs;
    return NextResponse.json({ now: ended ? share.win.toMs : now, ended, kills: hit.kills }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'timeline unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
