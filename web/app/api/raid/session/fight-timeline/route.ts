// GET /api/raid/session/fight-timeline?encounter=<id>&from=<iso>&to=<iso>: one fight's damage curve and deaths for the
// night panel of the members' session review, loaded when the fight is opened.
//
//   -> { timeline: FightTimeline }   lib/raidFightTimeline.ts; opted-out characters are their class and a number
//
// Members only (a signed-in session, 401 otherwise), like /api/raid/session/parse. `from`/`to` are the review's window:
// they decide only who counts as a bid winner (shown by name), never what is read.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { makeWindow } from '@/lib/raidShare';
import { loadFightTimeline } from '@/lib/raidFightTimeline';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  try {
    const q = new URL(req.url).searchParams;
    const win = makeWindow(Date.parse(q.get('from') ?? ''), Date.parse(q.get('to') ?? '')) ?? undefined;
    const timeline = await loadFightTimeline(supabaseAdmin(), q.get('encounter'), { guild: GUILD_TAG, anonWin: win });
    if (!timeline) return fail(404, 'not found');
    return NextResponse.json({ timeline }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return fail(500, 'timeline unavailable');
  }
}
