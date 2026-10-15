// DELETE /api/raid/shares/<id>: an officer revokes a share link. The row stays (its view count and who made it
// are worth keeping); `revoked_at` is set, and the very next request to the public page or its routes is a 404.
// Revoking twice is fine. Officers only, same-origin only.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const o = req.headers.get('origin');
  if (o) {
    let ok = false;
    try { ok = new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { /* ok stays false */ }
    if (!ok) return fail(403, 'cross-site request');
  }
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'sign in first');
  if (!(await isOfficer(user.id))) return fail(403, 'officers only');
  if (!UUID.test(params.id)) return fail(400, 'bad id');

  const { data, error } = await supabaseAdmin().from('raid_shares')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', params.id)
    .eq('guild_id', GUILD_TAG)
    .is('revoked_at', null)
    .select('id');
  if (error) return fail(502, 'could not revoke');
  // Nothing updated: already revoked, or not ours. Either way the link is not live, which is what was asked.
  return NextResponse.json({ ok: true, revoked: (data ?? []).length }, { headers: NO_STORE });
}
