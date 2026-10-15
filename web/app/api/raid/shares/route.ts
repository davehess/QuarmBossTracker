// /api/raid/shares: officers make and list the public share links for a raid session window.
//
//   GET  ?from=<iso>&to=<iso>  -> { shares: [{ id, title, from_at, to_at, created_at, expires_at, revoked_at,
//                                  view_count, status }] }   the shares that overlap the window, newest first.
//                                  NEVER a token: only the hash is stored, so there is nothing to return.
//   POST { from, to, title?, days? } -> { share, path, url, canonical }   the link, shown ONCE.
//
// Officers only (lib/officer.ts, the role names the site already uses); a signed-in member who is not an officer
// gets 403, a visitor 401. The write uses the service key (raid_shares has RLS on and no policy).
// Revoking is DELETE /api/raid/shares/<id>.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { supabaseAdmin } from '@/lib/supabase';
import { isOfficer } from '@/lib/officer';
import { GUILD_TAG } from '@/lib/guild';
import {
  expiryDays, hashToken, makeWindow, newToken, sharePath, shareStatus, SHARE_ORIGIN, windowIso, type ShareRow,
} from '@/lib/raidShare';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });
const COLUMNS = 'id, guild_id, from_at, to_at, title, created_at, expires_at, revoked_at, view_count';

/** Same-origin check for the cookie-authenticated write: a form on another site cannot make an officer's browser create a link. */
function sameOrigin(req: Request): boolean {
  const o = req.headers.get('origin');
  if (!o) return true;
  try { return new URL(o).host === (req.headers.get('x-forwarded-host') || req.headers.get('host')); } catch { return false; }
}

async function officerId(): Promise<{ id: string } | { status: number; error: string }> {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return { status: 401, error: 'sign in first' };
  if (!(await isOfficer(user.id))) return { status: 403, error: 'officers only' };
  return { id: user.id };
}

const view = (r: ShareRow) => ({ ...r, guild_id: undefined, status: shareStatus(r) });

export async function GET(req: Request) {
  const who = await officerId();
  if (!('id' in who)) return fail(who.status, who.error);
  const q = new URL(req.url).searchParams;
  const win = makeWindow(Date.parse(q.get('from') ?? ''), Date.parse(q.get('to') ?? ''));
  if (!win) return fail(400, 'bad window');
  const { from, to } = windowIso(win);
  const { data, error } = await supabaseAdmin().from('raid_shares')
    .select(COLUMNS)
    .eq('guild_id', GUILD_TAG)
    .lt('from_at', to)
    .gt('to_at', from)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) return fail(502, 'shares unavailable');
  return NextResponse.json({ shares: ((data ?? []) as ShareRow[]).map(view) }, { headers: NO_STORE });
}

export async function POST(req: Request) {
  if (!sameOrigin(req)) return fail(403, 'cross-site request');
  const who = await officerId();
  if (!('id' in who)) return fail(who.status, who.error);

  let body: { from?: unknown; to?: unknown; title?: unknown; days?: unknown };
  try { body = await req.json(); } catch { return fail(400, 'bad request'); }
  const win = makeWindow(Date.parse(String(body.from ?? '')), Date.parse(String(body.to ?? '')));
  if (!win) return fail(400, 'bad window');
  const title = String(body.title ?? '').replace(/\s+/g, ' ').trim().slice(0, 120);
  const days = expiryDays(body.days);

  const token = newToken();
  const { from, to } = windowIso(win);
  const { data, error } = await supabaseAdmin().from('raid_shares')
    .insert({
      token_hash: hashToken(token),
      guild_id: GUILD_TAG,
      from_at: from,
      to_at: to,
      title,
      created_by: who.id,
      expires_at: new Date(Date.now() + days * 86_400_000).toISOString(),
    })
    .select(COLUMNS)
    .single();
  if (error || !data) return fail(502, 'could not create the link');

  const path = sharePath(token);
  const origin = req.headers.get('origin') || new URL(req.url).origin;
  return NextResponse.json(
    { share: view(data as ShareRow), path, url: origin + path, canonical: SHARE_ORIGIN + path },
    { status: 201, headers: NO_STORE },
  );
}
