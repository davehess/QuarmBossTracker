// DELETE /api/raid/shares/<id>: an officer revokes a share link. The row stays (its view count and who made it
// are worth keeping); `revoked_at` is set, and the public page and its routes answer 404 from then on (at once on
// this instance, within a minute on the others: the lookup is memoised for 60 s).
// Revoking twice is fine. Officers only, same-origin only.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import { revalidateTag } from 'next/cache';
import { isOpenShare, planShareWindow, shareTag } from '@/lib/raidShare';
import { invalidateShare } from '@/lib/raidShareLookup';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Same-origin + officer + id gate shared by PATCH and DELETE; a Response is a refusal. */
async function gate(req: Request, id: string): Promise<Response | null> {
  const o = req.headers.get('origin');
  if (o) {
    let ok = false;
    try { ok = new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { /* ok stays false */ }
    if (!ok) return fail(403, 'cross-site request');
  }
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'sign in first');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');
  if (!UUID.test(id)) return fail(400, 'bad id');
  return null;
}

// PATCH /api/raid/shares/<id> { from?: iso, to?: iso, open?: boolean }: an officer moves a share's END after the fact
// (the guild lead, 2026-10-21: "one that lets me set an end-time after the raid finishes") and, since 2026-10-23, its
// START (the second of two back-to-back raids had to be cut by hand in SQL). The token and address do not change.
//   { to }          a fixed end: after the start, the whole window <= 24 h, not past now + 12 h.
//   { open: true }  follow the raid: the end is the clock (up to 24 h from the start) until it is closed.
//   { open: false } Close: fix the end at this moment.
//   { from }        a new start (to the minute); an open share stays open, a fixed one keeps its end, which must still
//                   be after the new start and within 24 h of it (lib/raidShare.ts planShareWindow).
// A revoked share cannot be changed. Both caches are dropped, like a revoke, so the old window is not served.
export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const refused = await gate(req, params.id);
  if (refused) return refused;
  let body: { from?: unknown; to?: unknown; open?: unknown };
  try { body = await req.json(); } catch { return fail(400, 'bad request'); }
  if (!body || typeof body !== 'object') return fail(400, 'bad request');

  const db = supabaseAdmin();
  const { data: row, error: readErr } = await db.from('raid_shares')
    .select('id, from_at, to_at')
    .eq('id', params.id).eq('guild_id', GUILD_TAG).is('revoked_at', null)
    .maybeSingle();
  if (readErr) return fail(502, 'could not read the link');
  if (!row) return fail(404, 'no such live link');
  const plan = planShareWindow(row as { from_at: string; to_at: string }, body);
  if ('error' in plan) return fail(400, plan.error);

  const { data, error } = await db.from('raid_shares')
    .update({ from_at: plan.from_at, to_at: plan.to_at })
    .eq('id', params.id).eq('guild_id', GUILD_TAG).is('revoked_at', null)
    .select('id, from_at, to_at');
  if (error) return fail(502, 'could not change the window');
  invalidateShare(params.id);
  revalidateTag(shareTag(params.id));
  const out = (data ?? [])[0] as { from_at: string; to_at: string } | undefined;
  return NextResponse.json(
    { ok: true, from_at: out?.from_at ?? plan.from_at, to_at: out?.to_at ?? plan.to_at, open: isOpenShare(out ?? plan) },
    { headers: NO_STORE },
  );
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const refused = await gate(req, params.id);
  if (refused) return refused;

  const { data, error } = await supabaseAdmin().from('raid_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('guild_id', GUILD_TAG)
    .is('revoked_at', null)
    .select('id');
  if (error) return fail(502, 'could not revoke');
  // Prompt revoke (the guild lead, 2026-10-17). The public lookup is memoised 60 s per process: this clears the
  // instance that took the click, the TTL bounds every other one. The tag drops the slices and bosses kept across
  // visitors so none is served after this. Run even when nothing updated (already revoked): it is idempotent.
  invalidateShare(params.id);
  revalidateTag(shareTag(params.id));
  // Nothing updated: already revoked, or not ours. Either way the link is not live, which is what was asked.
  return NextResponse.json({ ok: true, revoked: (data ?? []).length }, { headers: NO_STORE });
}
