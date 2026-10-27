// GET /api/raid/session/replay?from=<iso>&to=<iso>&w=<n>[&group=<id>]: one 15-minute slice of the session review's recording,
// for the members' page (/raid/session). The twin of /api/share/raid/<token>/replay, behind a sign-in instead of
// a token: `from`/`to` are the review's window, `w` counts 15-minute slices from its start.
//
//   -> { rows: [{ minute_at, zones, data }] }   the same compact rows /api/spectator/replay serves
//
// Why not /api/spectator/replay: that route serves the replay page and sends every name as recorded. The session
// review promises the same thing the public page does, so its board reads this one, where an opted-out character
// is renamed to their class label ("Cleric 2") before the row leaves, unless they won an item in the window
// (lib/raidSession.ts scrubMinuteData, lib/raidShareLookup.ts loadAnon).
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { makeWindow, replaySlice, windowIso } from '@/lib/raidShare';
import { loadAnon } from '@/lib/raidShareLookup';
import { scrubMinuteData } from '@/lib/raidSession';
import { loadGroupIndex } from '@/lib/raidSessionLoad';
import { narrowRows } from '@/lib/sessionGroups';

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
    const slice = replaySlice(win, q.get('w'));
    if (!slice) return NextResponse.json({ rows: [] }, { headers: NO_STORE });

    const { from, to } = windowIso(slice);
    const db = supabaseAdmin();
    const { data, error } = await db.from('raid_track_minutes')
      .select('minute_at, zones, data')
      .eq('guild_id', GUILD_TAG)
      .gte('minute_at', from).lt('minute_at', to)
      .order('minute_at')
      .limit(15);   // a literal: REPLAY_WINDOW_MS / MINUTE_MS, one row per minute of the slice
    if (error) return fail(502, 'replay unavailable');
    const anon = await loadAnon(db, GUILD_TAG, win);
    let got = (data ?? []) as { minute_at: string; zones: string[] | null; data: string }[];
    // `group` narrows the dots to one raid of the window (lib/sessionGroups.ts). Cut on the recorded names, BEFORE the
    // opt-out scrub below renames anyone. An id the window does not hold narrows to nothing: never to everyone.
    const group = q.get('group');
    if (group && /^[a-z0-9-]{3,40}$/.test(group)) {
      // A part of a larger window is cut by the raids counted in the larger one (gf, gt): lib/sessionGroups.ts groupQuery.
      const parent = makeWindow(Date.parse(q.get('gf') ?? ''), Date.parse(q.get('gt') ?? '')) ?? win;
      got = narrowRows(got, await loadGroupIndex(db, parent, anon), group);
    }
    const rows = got.map(r => ({
      minute_at: r.minute_at, zones: r.zones, data: scrubMinuteData(r.data, anon),
    }));
    // A slice that ended more than five minutes ago will not change; one still being recorded may.
    const over = slice.toMs < Date.now() - 5 * 60_000;
    return NextResponse.json({ rows }, { headers: { 'Cache-Control': over ? 'private, max-age=60' : 'private, max-age=15' } });
  } catch {
    return fail(500, 'replay unavailable');
  }
}
