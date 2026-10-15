// GET /api/spectator/replay: a recorded raid night, for /spectator/replay.
//
//   ?nights=1                         -> { nights: NightSummary[] }  newest first, the last 60 days
//   ?night=<key>&from=<iso>&to=<iso>  -> { night, from, to, rows: [{ minute_at, zones, data }] }
//
// Members-only, the same gate as /api/spectator/positions: a signed-in Supabase session, 401 otherwise.
// raid_track_minutes is service-role only (RLS on, no policy), so the read uses the admin client after that
// check. `data` is handed back as the compact text the bot wrote; web/lib/raidReplay.ts decodes it in the browser.
//
// Egress: a full night is ~5.5 MB, so a request is capped at REPLAY_WINDOW_MS (15 minutes) and the client
// asks for the next window only as the playhead nears it. A window that is already over is immutable and is
// cached by the browser for a day.
//
// Every read is bounded for the 1,000-row cap (test/db-read-discipline-web.test.js): the window is at most
// 15 rows with an explicit limit, and the night list pages through selectAll ordered on the primary key.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { REPLAY_WINDOW_MS, summarizeNights, type NightMinute } from '@/lib/raidReplay';

export const dynamic = 'force-dynamic';

const GUILD = GUILD_TAG;
const NIGHTS_DAYS = 60;
const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

// utils/raidNight.js nightKey: en-US 2-digit month/day/year, e.g. 10/14/2026.
const NIGHT_KEY = /^\d{2}\/\d{2}\/\d{4}$/;

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const q = new URL(req.url).searchParams;
  try {
    const admin = supabaseAdmin();

    if (q.get('nights')) {
      const since = new Date(Date.now() - NIGHTS_DAYS * 86_400_000).toISOString();
      const rows = await selectAll<NightMinute>((from, to) => admin.from('raid_track_minutes')
        .select('night_key, minute_at, zones')
        .eq('guild_id', GUILD)
        .gte('minute_at', since)
        .order('minute_at')               // the primary key's second column: unique within a guild
        .range(from, to));
      return NextResponse.json({ nights: summarizeNights(rows) }, { headers: { 'Cache-Control': 'private, max-age=60' } });
    }

    const night = q.get('night') ?? '';
    const fromMs = Date.parse(q.get('from') ?? '');
    const toMs = Date.parse(q.get('to') ?? '');
    if (!NIGHT_KEY.test(night) || !Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) {
      return fail(400, 'bad request');
    }
    const end = Math.min(toMs, fromMs + REPLAY_WINDOW_MS);

    const { data, error } = await admin.from('raid_track_minutes')
      .select('minute_at, zones, data')
      .eq('guild_id', GUILD)
      .eq('night_key', night)
      .gte('minute_at', new Date(fromMs).toISOString())
      .lt('minute_at', new Date(end).toISOString())
      .order('minute_at')
      .limit(REPLAY_WINDOW_MS / 60_000);
    if (error) return fail(502, 'replay unavailable');

    // A window that ended more than five minutes ago will not change; one that is still being recorded may.
    const over = end < Date.now() - 5 * 60_000;
    return NextResponse.json(
      { night, from: new Date(fromMs).toISOString(), to: new Date(end).toISOString(), rows: data ?? [] },
      { headers: { 'Cache-Control': over ? 'private, max-age=86400' : 'private, max-age=15' } },
    );
  } catch {
    return fail(500, 'replay unavailable');
  }
}
