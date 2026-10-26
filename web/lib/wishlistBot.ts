// The website's one door to the bot's wishlist: POST {bot}/api/web/wishlist (utils/webWishlist.js).
//
// A wishlist bid is sealed with a key only the bot holds, so the website never encrypts, stores or logs a bid: it
// signs a 60-second ticket for the signed-in member (lib/screenTicket.ts, audience 'wishlist', the same
// SCREEN_TOKEN_SECRET /screen already shares with the bot) and passes the request on. The bot re-checks that the
// member owns the character. Server only: the ticket is signed here and never goes to a browser.
//
// The bot's address is the origin of SCREEN_LIVE_URL (set for /screen), so there is no new variable. Unset
// SCREEN_TOKEN_SECRET or SCREEN_LIVE_URL means the controls are hidden, not broken.
import { signScreenTicket, WISHLIST_AUD, WISHLIST_TTL_S } from '@/lib/screenTicket';

export type BotItem = { item_id: number; priority: number | null; bid: number | null };
export type BotResult<T = Record<string, unknown>> = ({ ok: true } & T) | { ok: false; error: string };

/** The bot's origin from SCREEN_LIVE_URL, or null when unset or unsafe (a bearer goes there: https only, or localhost for dev). */
export function botOrigin(): string | null {
  const raw = (process.env.SCREEN_LIVE_URL || '').trim();
  if (!raw) return null;
  let u: URL;
  try { u = new URL(raw); } catch { return null; }
  const local = u.hostname === 'localhost' || u.hostname === '127.0.0.1';
  if (u.protocol !== 'https:' && !(local && u.protocol === 'http:')) return null;
  if (u.username || u.password) return null;
  return u.origin;
}

/** True when the page can offer the wishlist controls. */
export function wishlistWritesEnabled(): boolean {
  return !!process.env.SCREEN_TOKEN_SECRET && !!botOrigin();
}

/** Ask the bot to do `body` as the Supabase user `userId`. Never throws; the error text is safe to show the member. */
export async function callBotWishlist<T = Record<string, unknown>>(userId: string, body: Record<string, unknown>): Promise<BotResult<T>> {
  const origin = botOrigin();
  const ticket = origin ? signScreenTicket(userId, { aud: WISHLIST_AUD, ttlS: WISHLIST_TTL_S }) : null;
  if (!origin || !ticket) return { ok: false, error: 'The wishlist is not switched on for the website yet.' };
  try {
    const res = await fetch(`${origin}/api/web/wishlist`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${ticket.token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
      signal: AbortSignal.timeout(8000),
    });
    const j = (await res.json().catch(() => null)) as ({ ok?: boolean; error?: string } & Record<string, unknown>) | null;
    if (res.ok && j?.ok) return j as BotResult<T>;
    // The bot's own refusals are written for the member (bad bid, already listed, not yours); anything else is generic.
    if (res.status >= 400 && res.status < 500 && res.status !== 401 && typeof j?.error === 'string') return { ok: false, error: j.error };
    if (res.status === 503 && typeof j?.error === 'string') return { ok: false, error: j.error };
    return { ok: false, error: 'The bot did not answer that. Try again in a moment.' };
  } catch {
    return { ok: false, error: 'Could not reach the bot. Try again in a moment.' };
  }
}
