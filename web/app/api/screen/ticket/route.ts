// GET /api/screen/ticket: the bearer the raid screen's page presents to the BOT for its 3-second reads.
//
//   -> { token, exp, liveUrl }   token: a screen ticket (lib/screenTicket.ts), exp in seconds, liveUrl: the
//                                 bot's /api/screen/live. The page renews it a few minutes before exp.
//   -> { token: null }           the bot feed is not configured (SCREEN_TOKEN_SECRET or SCREEN_LIVE_URL is
//                                 unset, or SCREEN_LIVE_URL is not an https address): the page keeps polling
//                                 Vercel exactly as it did before the bot feed existed.
//
// Why the reads moved: Vercel (Hobby) caps function invocations per month and sixty viewers polling every
// three seconds for a raid is most of a month's allowance in one night. The bot holds every raider's latest
// position in memory and is flat-rate, so the page asks the bot directly and this route is called once per
// viewer per ~two hours.
//
// Members only, the same gate as /api/spectator/positions: a signed-in Supabase session (sign-in itself is
// the guild and role gate: app/auth/callback). The ticket's `sub` is the user id; the bot never needs more.
// Nothing is stored. Never cached: the token is a bearer.
import { NextResponse } from 'next/server';
import { supabaseServer } from '@/lib/supabase-server';
import { signScreenTicket } from '@/lib/screenTicket';

export const dynamic = 'force-dynamic';

const NO_STORE = { 'Cache-Control': 'no-store' };
const fail = (status: number, error: string) => NextResponse.json({ error }, { status, headers: NO_STORE });

/** The bot's feed address from SCREEN_LIVE_URL, or null when unset or unsafe (a bearer goes there: https only, or localhost for dev). */
function liveUrlFromEnv(): string | null {
  const raw = (process.env.SCREEN_LIVE_URL || '').trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  return u.toString();
}

export async function GET() {
  const { data: { user } } = await supabaseServer().auth.getUser();
  if (!user) return fail(401, 'unauthorized');

  const liveUrl = liveUrlFromEnv();
  const ticket = liveUrl ? signScreenTicket(user.id) : null;
  if (!liveUrl || !ticket) return NextResponse.json({ token: null }, { headers: NO_STORE });
  return NextResponse.json({ token: ticket.token, exp: ticket.exp, liveUrl }, { headers: NO_STORE });
}
