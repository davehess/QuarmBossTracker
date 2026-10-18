// GET /api/share/raid/<token>/bosses: the curated bosses killed inside a shared session, with their spawn points,
// for the public replay's boss markers. The token is the whole credential; the window is the share row's.
//
//   -> { bosses: SpawnBoss[] }   times in epoch ms, the same shape /api/spectator/replay/bosses serves
//
// Only a boss whose kill (ended_at) is inside the window is returned. See lib/replayBossesLoad.ts for the reads.
//
// ABUSE (the guild lead, 2026-10-17; lib/shareGuard.ts): per-IP limit before the lookup, per-share hourly ceiling
// after it, and the read itself is kept for all visitors (unstable_cache, 5 minutes, tagged raid-share:<id>). The
// lookup stays OUTSIDE the cache, so an expired or revoked link is refused on every request.
import { NextResponse } from 'next/server';
import { unstable_cache } from 'next/cache';
import { supabaseAdmin } from '@/lib/supabase';
import { inWindow, shareTag, SHARE_CACHE_S, windowIso } from '@/lib/raidShare';
import { resolveShare } from '@/lib/raidShareLookup';
import { loadSpawnBosses } from '@/lib/replayBossesLoad';
import { ceilingApi, guardApi } from '@/lib/shareGuard';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, max-age=60', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(req: Request, { params }: { params: { token: string } }) {
  const limited = guardApi(req);
  if (limited) return limited;
  try {
    const sb = supabaseAdmin();
    const share = await resolveShare(sb, params.token);
    if (!share) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    const over = ceilingApi(share.row.id);
    if (over) return over;
    const { from, to } = windowIso(share.win);
    const win = share.win;
    const bosses = await unstable_cache(
      async () => (await loadSpawnBosses(supabaseAdmin(), from, to)).filter(b => inWindow(win, b.to)),
      ['raid-share', share.row.id, 'bosses'],
      { revalidate: SHARE_CACHE_S, tags: [shareTag(share.row.id)] },
    )();
    return NextResponse.json({ bosses }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'bosses unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
