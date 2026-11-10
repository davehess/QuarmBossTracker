// Proof that a person manages a Discord server, for registering it as a guild (security hardening, 2026-11-10).
//
// Discord's server list is readable only with the person's own OAuth token, which exists for the one sign-in that asked for
// the `guilds` scope ("Find my guilds" / "Confirm my server", web/lib/openSignIn.ts) and is never stored. So that sign-in
// writes a SIGNED, short-lived, HttpOnly cookie naming the servers the person can manage (owner or MANAGE_GUILD), bound to
// their Discord id; createGuild accepts a Discord server id only if it is in a cookie that verifies for the signed-in person.
// The cookie is the server's statement, not the client's: forging it needs the signing key (derived from the service-role
// key, which only the server holds). Nothing client-sent is trusted, and a missing, expired or foreign cookie means "ask again".
import { createHmac, timingSafeEqual } from 'node:crypto';

export const MANAGE_COOKIE = 'rm_manage';
export const MANAGE_TTL_MS = 15 * 60_000;

export const MANAGE_MESSAGES = {
  needSignIn: 'Sign in again to confirm you manage this server.',
  notManager: 'You can only register a Discord server you own or manage. Check the server id, or leave it empty and use invite codes.',
} as const;

type Payload = { d: string; s: string[]; x: number };

function key(): Buffer | null {
  const k = process.env.SUPABASE_SERVICE_ROLE_KEY;
  return k ? createHmac('sha256', 'rm-manage-cookie-v1').update(k).digest() : null;
}

function mac(body: string): string | null {
  const k = key();
  return k ? createHmac('sha256', k).update(body).digest('base64url') : null;
}

/** The cookie value for `serverIds` (the servers this person manages), good for 15 minutes. null when the server has no key. */
export function signManageProof(discordId: string, serverIds: readonly string[], now: number = Date.now()): string | null {
  const body = Buffer.from(JSON.stringify({ d: discordId, s: [...serverIds], x: now + MANAGE_TTL_MS } satisfies Payload)).toString('base64url');
  const sig = mac(body);
  return sig ? `${body}.${sig}` : null;
}

/** The managed server ids a cookie proves for `discordId`, or null when it is missing, forged, expired or someone else's. */
export function readManageProof(cookie: string | null | undefined, discordId: string, now: number = Date.now()): string[] | null {
  if (!cookie || typeof cookie !== 'string') return null;
  const dot = cookie.indexOf('.');
  if (dot < 1) return null;
  const body = cookie.slice(0, dot);
  const sig = cookie.slice(dot + 1);
  const want = mac(body);
  if (!want || sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  try {
    const p = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Payload;
    if (p.d !== discordId || !Array.isArray(p.s) || typeof p.x !== 'number' || p.x <= now) return null;
    return p.s.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}

/** true = the proof lists this server; false = a fresh proof exists and does not; null = no usable proof (sign in again). */
export function managesDiscordServer(cookie: string | null | undefined, discordId: string, serverId: string, now: number = Date.now()): boolean | null {
  const ids = readManageProof(cookie, discordId, now);
  return ids === null ? null : ids.includes(serverId);
}
