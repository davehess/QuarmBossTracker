// GET /api/spectator/replay/bosses?night=<night_key>: the bosses killed on a recorded night, with their spawn
// points, for the replay nights that were recorded before the recorder kept targets.
//
//   -> { night, from, to, bosses: [{ npc_id, name, from, to, points: [{ zone, x, y, z }] }] }   times in epoch ms
//
// Members-only, the same gate as /api/spectator/replay: a signed-in session, 401 otherwise; the reads use the
// admin client after that check. What counts as a boss is the repo's own rule (web/lib/bossFilter.ts): a row in
// bosses_local with auto_registered = false. What counts as a kill is an encounter with an ended_at (the death was
// seen) and no classification (not a wipe, a test or a PvP row). The spawn points are the SERVER frame, the same
// axes as a replay raider; see web/lib/replayBosses.ts for what that does and does not tell you.
//
// Every read is bounded for the 1,000-row cap (test/db-read-discipline-web.test.js): the encounter and spawn
// reads page through selectAll on a unique order, the `in (...)` lists are chunked so the URL stays short, and the
// curated-boss read asks for at most one chunk's worth of rows.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { selectAll } from '@/lib/selectAll';
import { GUILD_TAG } from '@/lib/guild';
import {
  buildSpawnBosses, chunk, type EncounterRow, type Spawn2Row, type SpawnEntryRow,
} from '@/lib/replayBosses';

export const dynamic = 'force-dynamic';

const GUILD = GUILD_TAG;
const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
// utils/raidNight.js nightKey: en-US 2-digit month/day/year, e.g. 10/14/2026.
const NIGHT_KEY = /^\d{2}\/\d{2}\/\d{4}$/;
const CHUNK = 100;

type EncRaw = {
  npc_id: number; started_at: string; ended_at: string | null; zone_short: string | null;
  eqemu_npc_types: { name: string | null } | { name: string | null }[] | null;
};

export async function GET(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const night = new URL(req.url).searchParams.get('night') ?? '';
  if (!NIGHT_KEY.test(night)) return fail(400, 'bad request');

  try {
    const admin = supabaseAdmin();

    // The night's span: its first and last recorded minute.
    const edge = async (asc: boolean) => {
      const { data, error } = await admin.from('raid_track_minutes')
        .select('minute_at')
        .eq('guild_id', GUILD)
        .eq('night_key', night)
        .order('minute_at', { ascending: asc })
        .limit(1);
      if (error) throw error;
      return (data?.[0] as { minute_at: string } | undefined)?.minute_at ?? null;
    };
    const [first, last] = await Promise.all([edge(true), edge(false)]);
    if (!first || !last) return NextResponse.json({ night, bosses: [] }, { headers: { 'Cache-Control': 'private, max-age=60' } });
    const fromIso = first;
    const toIso = new Date(Date.parse(last) + 60_000).toISOString();

    const raw = await selectAll<EncRaw>((from, to) => admin.from('encounters')
      .select('id, npc_id, started_at, ended_at, zone_short, eqemu_npc_types(name)')
      .eq('guild_id', GUILD)
      .is('classification', null)
      .not('ended_at', 'is', null)
      .gte('ended_at', fromIso)
      .lte('started_at', toIso)
      .order('id')
      .range(from, to));
    const npcIds = [...new Set(raw.map(r => r.npc_id))];

    // Curated bosses only: the rest of the night's encounters are trash.
    const curated = new Set<number>();
    for (const ids of chunk(npcIds, CHUNK)) {
      const { data, error } = await admin.from('bosses_local')
        .select('npc_id')
        .eq('auto_registered', false)
        .in('npc_id', ids)
        .limit(100);   // a literal, equal to CHUNK: one row at most per id asked for, and the guard reads numbers
      if (error) throw error;
      for (const r of (data ?? []) as { npc_id: number }[]) curated.add(r.npc_id);
    }
    const encounters: EncounterRow[] = raw.filter(r => curated.has(r.npc_id)).map(r => {
      const t = Array.isArray(r.eqemu_npc_types) ? r.eqemu_npc_types[0] : r.eqemu_npc_types;
      return { npc_id: r.npc_id, name: t?.name ?? null, zone_short: r.zone_short, started_at: r.started_at, ended_at: r.ended_at };
    });
    if (!encounters.length) return NextResponse.json({ night, bosses: [] }, { headers: { 'Cache-Control': 'private, max-age=60' } });

    const bossIds = [...new Set(encounters.map(e => e.npc_id))];
    const entries: SpawnEntryRow[] = [];
    for (const ids of chunk(bossIds, 50)) {
      entries.push(...await selectAll<SpawnEntryRow>((from, to) => admin.from('eqemu_spawnentry')
        .select('spawngroup_id, npc_id')
        .in('npc_id', ids)
        .order('spawngroup_id').order('npc_id')
        .range(from, to)));
    }
    const groupIds = [...new Set(entries.map(e => e.spawngroup_id))];
    const spawns: Spawn2Row[] = [];
    for (const ids of chunk(groupIds, CHUNK)) {
      spawns.push(...await selectAll<Spawn2Row>((from, to) => admin.from('eqemu_spawn2')
        .select('id, spawngroup_id, zone_short, x, y, z')
        .in('spawngroup_id', ids)
        .order('id')
        .range(from, to)));
    }

    // A finished night will not change; one still being recorded may gain a kill.
    const over = Date.parse(last) < Date.now() - 10 * 60_000;
    return NextResponse.json(
      { night, from: fromIso, to: toIso, bosses: buildSpawnBosses(encounters, entries, spawns) },
      { headers: { 'Cache-Control': over ? 'private, max-age=3600' : 'private, max-age=60' } },
    );
  } catch {
    return fail(500, 'bosses unavailable');
  }
}
