// GET /api/raid/navmesh?zone=<short_name> — a zone's walkable map for the route planner's "Walk route".
//
//   -> application/octet-stream, the slim navmesh described in web/lib/routePlanner/navmesh.ts, sent brotli-compressed
//      (Content-Encoding: br; gzip or plain when the browser does not say it reads brotli), so fetch() hands the browser the
//      slim bytes either way. Headers: X-Navmesh-Bytes (slim size, uncompressed), X-Navmesh-Source (Quarm's .nav size).
//
// Source: the navmesh the Quarm server's own pathfinder loads (EQMacEmu/Maps, repo root, GPL-derived like the EQEmu walls
// the planner already draws). Plain geometry only. Quarm's file is read, not EQEmu's: the two differ for the same zone.
//
// Members-only, the same gate as /api/spectator/mesh: a signed-in session, 401 otherwise. Nothing is read from or written
// to the database; the zone name is validated (lowercase letters, digits, underscore) before it can reach the upstream URL.
//
// Cost: a cold zone is one download (kept by Next for a day) plus an inflate, a slim and a brotli pass, well under the
// Hobby function limit; the answer is also held in this process for a few zones, so a repeat skips the work. The browser
// keeps it for a day (private).
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { isZoneShort } from '@/lib/zoneMap/source';
import { encodeSlim, fetchSlimNav, pickEncoding, type Encoding, type SlimNav } from '@/lib/routePlanner/navmeshServer';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 10;

const DAY = { 'Cache-Control': 'private, max-age=86400' };
const fail = (error: string, status: number, headers?: Record<string, string>) =>
  NextResponse.json({ error }, { status, headers });

const MEMO_MAX = 4;   // the two planner zones, with room for a third
const MEMO_TTL_MS = 6 * 60 * 60 * 1000;
const memo = new Map<string, { at: number; nav: SlimNav; enc: Map<Encoding, Uint8Array> }>();

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail('sign in first', 401);

  const zone = new URL(req.url).searchParams.get('zone');
  if (!isZoneShort(zone)) return fail('bad zone', 400);

  let hit = memo.get(zone);
  if (hit && Date.now() - hit.at > MEMO_TTL_MS) { memo.delete(zone); hit = undefined; }
  if (!hit) {
    let nav: SlimNav | null;
    try {
      nav = await fetchSlimNav(zone);
    } catch (e) {
      console.error(`[raid-navmesh] ${zone}: ${e instanceof Error ? e.message : e}`);
      return fail('map source unreachable', 502, { 'Cache-Control': 'private, max-age=60' });
    }
    if (!nav) return fail('no walkable map for this zone', 404, DAY);
    hit = { at: Date.now(), nav, enc: new Map() };
    if (memo.size >= MEMO_MAX) memo.delete(memo.keys().next().value as string);
    memo.set(zone, hit);
  }

  const enc = pickEncoding(req.headers.get('accept-encoding'));
  let body = hit.enc.get(enc);
  if (!body) { body = encodeSlim(hit.nav.slim, enc); hit.enc.set(enc, body); }

  return new NextResponse(body, {
    headers: {
      ...DAY,
      'Content-Type': 'application/octet-stream',
      ...(enc === 'identity' ? {} : { 'Content-Encoding': enc }),
      Vary: 'Accept-Encoding',
      'X-Navmesh-Bytes': String(hit.nav.slim.length),
      'X-Navmesh-Source': String(hit.nav.source),
    },
  });
}
