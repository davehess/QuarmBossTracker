// PUT /api/raid/slices { from: iso, to: iso, slices: [{ id?, fromMs, toMs, kind, label }] }: an officer saves how a window
// of a night was spent (the raid proper, an event, downtime, another guild's raid; lib/nightSlices.ts). The slices
// already saved INSIDE [from, to) are replaced by the list sent; an empty list clears them. Nothing outside the window
// is touched, and a saved slice that crosses the window's edge is refused (409-style message, nothing written).
//
//   -> { ok: true, slices: Slice[] }   what was saved, with ids
//
// Officers only, same-origin only (the gate of /api/raid/shares/<id>). A save made on a stale copy loses to the one
// before it and answers 409, so two officers cannot silently undo each other.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { makeWindow } from '@/lib/raidShare';
import { saveSlices } from '@/lib/nightSlicesLoad';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

export async function PUT(req: Request) {
  const o = req.headers.get('origin');
  if (o) {
    let ok = false;
    try { ok = new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { /* ok stays false */ }
    if (!ok) return fail(403, 'cross-site request');
  }
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'sign in first');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');

  let body: { from?: unknown; to?: unknown; slices?: unknown };
  try { body = await req.json(); } catch { return fail(400, 'bad request'); }
  if (!body || typeof body !== 'object') return fail(400, 'bad request');
  const win = makeWindow(Date.parse(String(body.from ?? '')), Date.parse(String(body.to ?? '')));
  if (!win) return fail(400, 'that window is not usable (it must be under 24 hours)');

  try {
    const res = await saveSlices(supabaseAdmin(), win, body.slices);
    if ('error' in res) return fail(res.conflict ? 409 : 400, res.error);
    return NextResponse.json({ ok: true, slices: res.saved }, { headers: NO_STORE });
  } catch {
    return fail(502, 'could not save the slices');
  }
}
