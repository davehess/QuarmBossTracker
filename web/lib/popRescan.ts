// "Sync from my logs" on /pop/raid/me: the member asks THEIR OWN Mimic to re-read recent EverQuest logs for
// Planes of Power flag lines. The rules live here with every outside thing passed in (the way popRecitalSave.ts
// does it), so ownership, the one-at-a-time limit and the status wording are testable without a database
// (test/pop-rescan.test.js). The table is supabase/migrations/20261026170000_pop_rescan_requests.sql; the bot's
// side is utils/popRescan.js (stream `rescan` of GET /api/agent/poll, POST /api/agent/rescan-done).
//
// This is NOT agent_backfill_requests (officer-filed, never completed by any agent). The row belongs to the member
// (discord_id); the bot claims it (pending -> taken) and the same member's agent closes it (done | failed).

export const DEFAULT_DAYS = 14;
export const MAX_DAYS = 60;
/** A pending row older than this is a request nobody's Mimic ever saw; it no longer blocks a new one (the bot
 *  stops serving it at the same age: utils/popRescan.js PENDING_TTL_MS). */
export const PENDING_TTL_MS = 24 * 3600_000;
/** A taken row older than this is an agent that died mid-read; the bot hands it out again (STALE_TAKEN_MS there). */
export const STALE_TAKEN_MS = 30 * 60_000;

/** The browser asks every 20 s while a request is open and gives up after 15 minutes (Vercel CPU and egress). */
export const POLL_MS = 20_000;
export const POLL_GIVE_UP_MS = 15 * 60_000;

export type RescanStatus = 'pending' | 'taken' | 'done' | 'failed';
export type RescanRow = {
  id: number; status: RescanStatus; character: string | null; days: number;
  requested_at: string; taken_at: string | null; done_at: string | null; found: number | null;
};

// ── Filing a request ─────────────────────────────────────────────────────────

export type RescanDeps = {
  guildId: string;
  userId: () => Promise<string | null>;
  /** The signed-in member's discord_id (wolfpack_members.user_id -> discord_id), or null. */
  discordId: (userId: string) => Promise<string | null>;
  /** The names of the characters on the signed-in member's account (ownedCharacters). */
  owned: (userId: string) => Promise<string[]>;
  /** This member's rows that are still open (pending or taken), newest first. null = could not read. */
  open: (discordId: string) => Promise<Pick<RescanRow, 'id' | 'status' | 'requested_at' | 'taken_at'>[] | null>;
  /** Insert the request; the new id, or an error message. */
  insert: (row: { guild_id: string; discord_id: string; character: string | null; days: number }) =>
    Promise<{ id: number } | { error: string }>;
  now: () => Date;
};

export type RescanResult =
  | { ok: true; id: number; already: boolean }
  | { ok: false; error: string };

/** A row that still counts as "waiting": pending and young enough to be served, or taken by an agent that is still
 *  inside its time. */
export function stillOpen(r: Pick<RescanRow, 'status' | 'requested_at' | 'taken_at'>, nowMs: number): boolean {
  if (r.status === 'pending') return nowMs - Date.parse(r.requested_at) < PENDING_TTL_MS;
  if (r.status === 'taken') return r.taken_at != null && nowMs - Date.parse(r.taken_at) < STALE_TAKEN_MS;
  return false;
}

export async function requestRescan(deps: RescanDeps, character: unknown, days: unknown = DEFAULT_DAYS): Promise<RescanResult> {
  if (character !== null && (typeof character !== 'string' || !character.trim() || character.length > 64)) {
    return { ok: false, error: 'bad request' };
  }
  if (typeof days !== 'number' || !Number.isInteger(days) || days < 1 || days > MAX_DAYS) return { ok: false, error: 'bad request' };

  const userId = await deps.userId();
  if (!userId) return { ok: false, error: 'not signed in' };
  const discordId = await deps.discordId(userId);
  if (!discordId) return { ok: false, error: 'not signed in' };

  // Ownership before anything else is read or written: a named character must be on this member's account, under
  // its real casing. null means "every character my Mimic has a log for" and is theirs by construction: the agent
  // only ever reads the logs on its own PC.
  let name: string | null = null;
  if (character !== null) {
    name = (await deps.owned(userId)).find(n => n.toLowerCase() === character.trim().toLowerCase()) ?? null;
    if (!name) return { ok: false, error: 'not your character' };
  }

  // At most one open request per member.
  const open = await deps.open(discordId);
  if (open === null) return { ok: false, error: 'Could not check your earlier requests. Try again.' };
  const nowMs = deps.now().getTime();
  const waiting = open.find(r => stillOpen(r, nowMs));
  if (waiting) return { ok: true, id: waiting.id, already: true };

  const res = await deps.insert({ guild_id: deps.guildId, discord_id: discordId, character: name, days });
  if ('error' in res) return { ok: false, error: 'Could not save the request. Try again.' };
  return { ok: true, id: res.id, already: false };
}

// ── What the button says ─────────────────────────────────────────────────────

export type RescanView =
  | { kind: 'idle' }
  | { kind: 'waiting'; text: string }
  | { kind: 'reading'; text: string }
  | { kind: 'done'; text: string; found: number }
  | { kind: 'failed'; text: string }
  | { kind: 'stale'; text: string };

/** The status line for a row. `giveUp` is true once the browser has waited its 15 minutes. */
export function rescanView(row: RescanRow | null, giveUp = false): RescanView {
  if (!row) return { kind: 'idle' };
  if (row.status === 'pending') {
    return giveUp
      ? { kind: 'stale', text: 'still waiting · open Mimic and it will pick this up' }
      : { kind: 'waiting', text: 'requested · waiting for Mimic (it checks every few minutes)' };
  }
  if (row.status === 'taken') {
    return giveUp
      ? { kind: 'stale', text: 'Mimic took this but has not finished · it will be handed out again' }
      : { kind: 'reading', text: 'Mimic is reading your logs' };
  }
  if (row.status === 'done') {
    const n = row.found ?? 0;
    return { kind: 'done', found: n, text: `done · ${n} flag line${n === 1 ? '' : 's'} read` };
  }
  return { kind: 'failed', text: 'Mimic could not read those logs · check that it is running and the character is not kept out of stats' };
}

/** Should the browser keep asking? Only while a request is open, inside its 15 minutes. */
export function shouldPoll(row: Pick<RescanRow, 'status'> | null, startedMs: number, nowMs: number): boolean {
  if (!row || (row.status !== 'pending' && row.status !== 'taken')) return false;
  return nowMs - startedMs < POLL_GIVE_UP_MS;
}

/** The newest row is shown while it is open, or finished within the last hour; older than that is a closed matter. */
export function relevantRow(rows: RescanRow[], nowMs: number): RescanRow | null {
  const r = rows[0];
  if (!r) return null;
  if (r.status === 'pending' || r.status === 'taken') return r;
  const at = Date.parse(r.done_at ?? r.requested_at);
  return Number.isFinite(at) && nowMs - at < 3600_000 ? r : null;
}
