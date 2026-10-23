// GET /api/raid/session/bosses?from=<iso>&to=<iso>: the curated bosses killed INSIDE the session review's window, with
// their spawn points, for the members' page (/raid/session). The twin of /api/share/raid/<token>/bosses, behind a
// sign-in instead of a token.
//
//   -> { bosses: SpawnBoss[] }   times in epoch ms, the same shape /api/spectator/replay/bosses serves
//
// Why not /api/spectator/replay/bosses: that route reads a whole NIGHT by night_key, so the second of two raids in a
// night numbered and marked the first one's kills too (the guild lead, 2026-10-23). Here the window is the page's own,
// and only a boss whose kill (ended_at) is inside it comes back, the Kills tab's rule. See lib/replayBossesLoad.ts for
// the reads.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { inWindow, makeWindow, windowIso } from '@/lib/raidShare';
import { loadSpawnBosses } from '@/lib/replayBossesLoad';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  try {
    const q = new URL(req.url).searchParams;
    const win = makeWindow(Date.parse(q.get('from') ?? ''), Date.parse(q.get('to') ?? ''));
    if (!win) return fail(400, 'bad request');
    const { from, to } = windowIso(win);
    const bosses = (await loadSpawnBosses(supabaseAdmin(), from, to)).filter(b => inWindow(win, b.to));
    // A window that ended more than ten minutes ago will not gain a kill; one still being recorded may.
    const over = win.toMs < Date.now() - 10 * 60_000;
    return NextResponse.json({ bosses }, { headers: { 'Cache-Control': over ? 'private, max-age=300' : 'private, max-age=30' } });
  } catch {
    return fail(500, 'bosses unavailable');
  }
}
