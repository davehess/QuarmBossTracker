// GET /api/spectator/timeline: the curated bosses that died in the last six hours, for the raid timeline strip on
// /spectator (web/components/RaidTimeline.tsx).
//
//   -> { now, kills: [{ npc_id, name, at }] }   `at` and `now` in epoch ms, `at` = the encounter's ended_at (the
//                                                kill time from the log; the row lands 30 to 60 s after the kill)
//
// Members-only, the same gate as /api/spectator/positions: a signed-in session, 401 otherwise; the reads use the
// admin client after that check. A boss is a bosses_local row with auto_registered = false (web/lib/bossFilter.ts),
// a kill is an encounter with an ended_at and no classification (not a wipe, a test or a PvP row), as in
// /api/spectator/replay/bosses. Only the columns the strip draws are selected: no player, no damage, no zone.
//
// Cached 10 s in this instance's memory, so a room full of open tabs polling every 10 s costs one read a window.
// The cache sits AFTER the auth check. Reads are bounded for the 1,000-row cap (test/db-read-discipline-web.test.js):
// the encounter read pages through selectAll on a unique order, the curated read is chunked.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import { chunk, displayMobName } from '@/lib/replayBosses';

export const dynamic = 'force-dynamic';

const GUILD = GUILD_TAG;
const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const LOOKBACK_MS = 6 * 60 * 60 * 1000;
const CACHE_MS = 10_000;
const CHUNK = 100;

type EncRaw = {
  npc_id: number; ended_at: string;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};
type Body = { now: number; kills: { npc_id: number; name: string; at: number }[] };

let memo: { at: number; body: Body } | null = null;

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const t0 = Date.now();
  if (memo && t0 - memo.at < CACHE_MS) return NextResponse.json(memo.body, { headers: NO_STORE });

  try {
    const admin = supabaseAdmin();
    const since = new Date(t0 - LOOKBACK_MS).toISOString();
    const raw = await selectAll<EncRaw>((from, to) => admin.from('encounters')
      .select('id, npc_id, ended_at, eqemu_npc_types(name)')
      .eq('guild_id', GUILD)
      .is('classification', null)
      .not('ended_at', 'is', null)
      .gte('ended_at', since)
      .order('id')
      .range(from, to));

    const npcIds = [...new Set(raw.map(r => r.npc_id))];
    const curated = new Set<number>();
    for (const ids of chunk(npcIds, CHUNK)) {
      const { data, error } = await admin.from('bosses_local')
        .select('npc_id')
        .eq('auto_registered', false)
        .in('npc_id', ids)
        .limit(100);   // a literal, equal to CHUNK: one row at most per id asked for
      if (error) throw error;
      for (const r of (data ?? []) as { npc_id: number }[]) curated.add(r.npc_id);
    }

    const kills = raw.filter(r => curated.has(r.npc_id)).map(r => {
      const t = Array.isArray(r.eqemu_npc_types) ? r.eqemu_npc_types[0] : r.eqemu_npc_types;
      return { npc_id: r.npc_id, name: displayMobName(t?.name) || 'Unknown boss', at: Date.parse(r.ended_at) };
    }).filter(k => Number.isFinite(k.at)).sort((a, b) => a.at - b.at || a.npc_id - b.npc_id);

    const body: Body = { now: Date.now(), kills };
    memo = { at: t0, body };
    return NextResponse.json(body, { headers: NO_STORE });
  } catch {
    return fail(500, 'timeline unavailable');
  }
}
