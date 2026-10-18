// GET /api/share/raid/<token>/replay?w=<n>: one 15-minute slice of a shared session's recording, for the
// public share page's replay. No sign-in: the token is the whole credential.
//
//   -> { rows: [{ minute_at, zones, data }] }   the same compact rows /api/spectator/replay serves
//
// The visitor sends the TOKEN and a window INDEX, never a time: the slice is cut from the window stored on the
// share row (lib/raidShare.ts replaySlice), so there is no parameter that can reach outside it. An unknown,
// expired or revoked token is a plain 404 (lib/raidShareLookup.ts).
//
// Opted-out characters are removed from every row before it leaves (lib/raidSession.ts scrubMinuteData).
// Cache-Control is private and short so a revoke bites within a minute even for a browser that kept a slice.
//
// ABUSE (the guild lead, 2026-10-17; lib/shareGuard.ts): the per-IP limit runs before the token is looked up and
// the per-share hourly ceiling right after. The slice is read ONCE for all visitors (unstable_cache, 5 minutes,
// tagged raid-share:<id>). The lookup stays OUTSIDE the cache, so an expired or revoked link is refused on every
// request whatever is cached.
import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { replaySlice, shareTag, SHARE_CACHE_S, windowIso } from '@/lib/raidShare';
import { loadOptedOut, resolveShare } from '@/lib/raidShareLookup';
import { scrubMinuteData } from '@/lib/raidSession';
import { ceilingApi, guardApi } from '@/lib/shareGuard';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, max-age=60', 'X-Robots-Tag': 'noindex, nofollow' };
const NOT_FOUND = () => NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const limited = guardApi(req);
  if (limited) return limited;
  try {
    const sb = supabaseAdmin();
    const share = await resolveShare(sb, params.token);
    if (!share) return NOT_FOUND();
    const over = ceilingApi(share.row.id);
    if (over) return over;

    const slice = replaySlice(share.win, new URL(req.url).searchParams.get('w'));
    if (!slice) return NextResponse.json({ rows: [] }, { headers: HEADERS });

    const { from, to } = windowIso(slice);
    const guild = share.row.guild_id;
    const rows = await unstable_cache(async () => {
      const db = supabaseAdmin();
      const { data, error } = await db.from('raid_track_minutes')
        .select('minute_at, zones, data')
        .eq('guild_id', guild)
        .gte('minute_at', from).lt('minute_at', to)
        .order('minute_at')
        .limit(15);   // a literal: REPLAY_WINDOW_MS / MINUTE_MS, one row per minute of the slice
      if (error) throw error;   // a throw is never cached
      const optedOut = await loadOptedOut(db, guild);
      return (data ?? []).map((r: { minute_at: string; zones: string[] | null; data: string }) => ({
        minute_at: r.minute_at, zones: r.zones, data: scrubMinuteData(r.data, optedOut),
      }));
    }, ['raid-share', share.row.id, 'replay', String(slice.fromMs)], { revalidate: SHARE_CACHE_S, tags: [shareTag(share.row.id)] })();
    return NextResponse.json({ rows }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'replay unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
