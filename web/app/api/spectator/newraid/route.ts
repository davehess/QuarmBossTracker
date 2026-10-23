// POST /api/spectator/newraid: an officer starts the live raid timeline over, or takes that back (beta preview
// ?v=newraid on /spectator; the guild lead, 2026-10-23: "this needs to be a new raid for midnight and on").
//
//   { action: 'start' } -> stores the cut "now" in bot_kv `live_raid_cut:<guild>`; the live timeline, its "since last
//                          death" clock and the review link then begin at that instant (lib/liveRaidWindow.ts)
//   { action: 'clear' } -> deletes it
//
// Officers only (the same role test as /admin). The cut is one instant; it holds no name, and is ignored once it is
// 12 hours old. JSON only: a cross-site form post cannot send that content type without a preflight.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { cutKey } from '@/lib/liveRaidWindow';
import { dropLiveMemo } from '@/lib/liveRaidLoad';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function POST(req: Request) {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');
  if (!(req.headers.get('content-type') ?? '').includes('application/json')) return fail(415, 'json only');

  let action: unknown;
  try { action = ((await req.json()) as { action?: unknown } | null)?.action; } catch { return fail(400, 'bad request'); }
  if (action !== 'start' && action !== 'clear') return fail(400, 'bad request');

  try {
    const sb = supabaseAdmin();
    const now = new Date();
    const { error } = action === 'start'
      ? await sb.from('bot_kv').upsert(
        { guild_id: GUILD_TAG, key: cutKey(GUILD_TAG), value: { v: 1, at: now.toISOString() }, updated_at: now.toISOString() },
        { onConflict: 'guild_id,key' })
      : await sb.from('bot_kv').delete().eq('guild_id', GUILD_TAG).eq('key', cutKey(GUILD_TAG));
    if (error) return fail(502, 'could not save');
    dropLiveMemo();
    return NextResponse.json({ ok: true, at: action === 'start' ? now.getTime() : null }, { headers: NO_STORE });
  } catch {
    return fail(500, 'could not save');
  }
}
