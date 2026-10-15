// GET /api/share/raid/<token>/bosses: the curated bosses killed inside a shared session, with their spawn points,
// for the public replay's boss markers. The token is the whole credential; the window is the share row's.
//
//   -> { bosses: SpawnBoss[] }   times in epoch ms, the same shape /api/spectator/replay/bosses serves
//
// Only a boss whose kill (ended_at) is inside the window is returned. See lib/replayBossesLoad.ts for the reads.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { inWindow, windowIso } from '@/lib/raidShare';
import { resolveShare } from '@/lib/raidShareLookup';
import { loadSpawnBosses } from '@/lib/replayBossesLoad';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, max-age=60', 'X-Robots-Tag': 'noindex, nofollow' };

export async function GET(_req: Request, { params }: { params: { token: string } }) {
  try {
    const sb = supabaseAdmin();
    const share = await resolveShare(sb, params.token);
    if (!share) return NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });
    const { from, to } = windowIso(share.win);
    const bosses = (await loadSpawnBosses(sb, from, to)).filter(b => inWindow(share.win, b.to));
    return NextResponse.json({ bosses }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'bosses unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
