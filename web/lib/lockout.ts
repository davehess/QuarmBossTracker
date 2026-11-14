// Member lockout, the website half (the guild lead, 2026-10-13: "lock out members despite discord roles and
// invalidate mimic sessions"; DECISIONS-2026-09-21.md §252). The table is member_lockouts (service role only);
// the bot re-reads it every 20 s for Mimic and Discord, and this module is how the site learns the same list.
//
// Active = a row exists AND (until IS NULL OR until > now()). An expired row is inert.
//
// ⚠ Runs in the Edge middleware, on every request that carries a session. So: nothing Node-only here, one
// cached read per 20 s per isolate (concurrent callers share the in-flight read), and a hard timeout. A failed
// or slow read FAILS OPEN to the last known set (empty if there has never been one): the lockout is a
// guild-policy tool, not a security perimeter, and a database blip must not sign the whole guild out.
// The database client is imported on first read, not at load: the middleware imports this module, and the
// middleware tests run with root packages only (no supabase-js there).

export type Lockouts = { byDiscord: Set<string>; byUser: Set<string> };
type Row = { discord_id: string | null; user_id: string | null; until: string | null };

const TTL_MS = 20_000;
const RETRY_MS = 5_000;     // after a failed read, try again this soon rather than every request
const READ_TIMEOUT_MS = 2_000;

// Pure: a lockout row is active unless it has an end time that has passed. (An unparseable `until` stays active:
// the safe reading of a row an officer put there on purpose.)
export function isActiveRow(r: { until: string | null }, now: number = Date.now()): boolean {
  if (r.until == null) return true;
  const t = Date.parse(r.until);
  return !(Number.isFinite(t) && t <= now);
}

// Pure: the rows → the two lookup sets, dropping expired rows.
export function activeSets(rows: Row[] | null | undefined, now: number = Date.now()): Lockouts {
  const byDiscord = new Set<string>();
  const byUser = new Set<string>();
  for (const r of rows || []) {
    if (!isActiveRow(r, now)) continue;
    if (r.discord_id) byDiscord.add(String(r.discord_id));
    if (r.user_id) byUser.add(String(r.user_id));
  }
  return { byDiscord, byUser };
}

let _last: Lockouts = { byDiscord: new Set(), byUser: new Set() };
let _readAt = 0;               // when _last was last refreshed (or the last failure, for backoff)
let _ok = false;               // whether the last attempt succeeded
let _inflight: Promise<Lockouts> | null = null;

async function readRows(): Promise<Row[]> {
  const { supabaseAdmin } = await import('./supabase');
  const q = supabaseAdmin().from('member_lockouts').select('discord_id,user_id,until').limit(1000);   // a lockout list is a handful of rows; 1000 is also PostgREST's own ceiling
  const res = await Promise.race([
    Promise.resolve(q),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error('lockout-timeout')), READ_TIMEOUT_MS)),
  ]);
  if (res.error) throw new Error(res.error.message);
  return (res.data || []) as Row[];
}

export async function getActiveLockouts(): Promise<Lockouts> {
  const age = Date.now() - _readAt;
  if (_readAt && age < (_ok ? TTL_MS : RETRY_MS)) return _last;
  if (_inflight) return _inflight;
  _inflight = (async () => {
    try {
      _last = activeSets(await readRows());
      _ok = true;
    } catch {
      _ok = false;           // keep the last known set (fail open)
    } finally {
      _readAt = Date.now();
      _inflight = null;
    }
    return _last;
  })();
  return _inflight;
}

// The Discord id of a Supabase auth user, read ONLY from the two places the signed-in person cannot write:
//   1. the Discord identity Supabase recorded at sign-in (user.identities), and
//   2. app_metadata.discord_id, which only the server can set (the claim flow stamps it on an invited password
//      account; server code that already holds a verified id passes it the same way).
// user_metadata is NEVER read: the account's owner can change it from the browser, so an id taken from it is
// whatever they say it is (DECISIONS §579). An identity's id must be all digits (a Discord id is; this also picks the
// right field whichever way the identity is serialised). A server-stamped id is held to a shape that cannot break
// out of a filter string.
const DISCORD_ID_RX = /^\d{5,25}$/;
const STAMPED_ID_RX = /^[\w-]{1,40}$/;
export function discordIdOf(
  user: { app_metadata?: unknown; user_metadata?: unknown; identities?: unknown } | null | undefined,
): string | null {
  if (!user) return null;
  const identities = Array.isArray(user.identities) ? user.identities : [];
  for (const raw of identities) {
    const i = (raw ?? {}) as { provider?: unknown; id?: unknown; identity_data?: unknown };
    if (i.provider !== 'discord') continue;
    const data = (i.identity_data ?? {}) as Record<string, unknown>;
    for (const c of [i.id, data.provider_id, data.sub]) {
      const s = c == null ? '' : String(c);
      if (DISCORD_ID_RX.test(s)) return s;
    }
  }
  const app = (user.app_metadata ?? {}) as Record<string, unknown>;
  const stamped = app.discord_id == null ? '' : String(app.discord_id);
  return STAMPED_ID_RX.test(stamped) ? stamped : null;
}

/** A user-shaped value for server code that already holds a VERIFIED Discord id (the guild API's answer, a members row). */
export const verifiedDiscord = (id: string | null | undefined, discordId: unknown) =>
  ({ id: id ?? undefined, app_metadata: { discord_id: discordId == null ? null : String(discordId) } });

// Pure matcher, so the rule can be exercised without the database.
export function matchesLockout(
  user: { id?: string; app_metadata?: unknown; user_metadata?: unknown; identities?: unknown } | null | undefined,
  locks: Lockouts,
): boolean {
  if (!user) return false;
  if (user.id && locks.byUser.has(user.id)) return true;
  const did = discordIdOf(user);
  return !!did && locks.byDiscord.has(did);
}

export async function isLockedOut(
  user: { id?: string; app_metadata?: unknown; user_metadata?: unknown; identities?: unknown } | null | undefined,
): Promise<boolean> {
  if (!user) return false;
  return matchesLockout(user, await getActiveLockouts());
}
