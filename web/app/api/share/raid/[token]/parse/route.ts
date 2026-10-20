// GET /api/share/raid/<token>/parse?encounter=<id>: the full parse of one fight in a shared session, loaded when
// its row is expanded on the public share page. No sign-in: the token is the whole credential.
//
//   -> { parse: { id, durationSec, totalDamage, players: [{ name, cls, damage, dps, pct, durationSec }] } }
//
// The window comes ONLY from the share row (lib/raidShareLookup.ts), never from the URL; the visitor sends an
// encounter id and loadFightParse refuses it unless the fight lies in that window (lib/raidSessionParse.ts). An
// unknown, expired or revoked token, a fight outside the window and an id that does not exist all give the same
// plain 404. Opted-out characters are labelled by class in the rows (winners excepted). Cache-Control is private and short so a revoke bites
// within a minute.
import { NextResponse } from 'next/server';
import { supabaseAdmin } from '@/lib/supabase';
import { resolveShare } from '@/lib/raidShareLookup';
import { loadFightParse } from '@/lib/raidSessionParse';

export const dynamic = 'force-dynamic';

const HEADERS = { 'Cache-Control': 'private, max-age=60', 'X-Robots-Tag': 'noindex, nofollow' };
const NOT_FOUND = () => NextResponse.json({ error: 'not found' }, { status: 404, headers: { 'Cache-Control': 'no-store', 'X-Robots-Tag': 'noindex' } });

export async function GET(req: Request, { params }: { params: { token: string } }) {
  try {
    const sb = supabaseAdmin();
    const share = await resolveShare(sb, params.token);
    if (!share) return NOT_FOUND();
    const parse = await loadFightParse(sb, new URL(req.url).searchParams.get('encounter'), { guild: share.row.guild_id, win: share.win });
    if (!parse) return NOT_FOUND();
    return NextResponse.json({ parse }, { headers: HEADERS });
  } catch {
    return NextResponse.json({ error: 'parse unavailable' }, { status: 500, headers: { 'Cache-Control': 'no-store' } });
  }
}
