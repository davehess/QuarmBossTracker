// GET /api/raid/session/parse?encounter=<id>: the full parse of one fight in the members' session review, loaded
// when its row is expanded.
//
//   -> { parse: { id, durationSec, totalDamage, players: [{ name, cls, damage, dps, pct, durationSec }] } }
//
// Members only, the same gate as /api/spectator/replay/bosses: a signed-in session, 401 otherwise; the read uses
// the admin client after that check. The public twin is /api/share/raid/<token>/parse, which adds the share's
// window. Opted-out characters are removed (lib/raidSessionParse.ts).
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { GUILD_TAG } from '@/lib/guild';
import { loadFightParse } from '@/lib/raidSessionParse';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  try {
    const parse = await loadFightParse(supabaseAdmin(), new URL(req.url).searchParams.get('encounter'), { guild: GUILD_TAG });
    if (!parse) return fail(404, 'not found');
    return NextResponse.json({ parse }, { headers: { 'Cache-Control': 'private, max-age=60' } });
  } catch {
    return fail(500, 'parse unavailable');
  }
}
