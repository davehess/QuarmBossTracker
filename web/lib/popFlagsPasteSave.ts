// Saving a `#popflags` paste for one of YOUR characters. Same shape as the Seer paste's save
// (web/lib/popRecitalSave.ts): every outside thing is passed in, so the ownership check, the idempotency and the
// rate limit can be tested without a database or a session (test/pop-flags-paste.test.js).
//
// What is stored: pop_flags rows the paste proves, tagged source 'popflags_paste' so they can be told apart from
// the server's own flag message ('event'), a Seer recital ('recital'), and a Mimic read of `#popflags` from the
// log ('popflags'). pop_flags.source is free text (supabase/migrations/20260610180000_pop_flags.sql), so no
// migration. The paste itself is never stored: the browser sends the recognised lines only, and the server
// reads those again with the same parser rather than trust key names the browser worked out.
//
// Not wired into the readers: /pop/latest (VERIFIED_SOURCES), the alt-group "newly flagged" count
// (popAltGroups) and the hail board's proof set (PROOF_SOURCES) list sources by name and will not count
// 'popflags_paste' until someone adds it there. /pop's matrix, the guide and the raid pre-flag check read every
// source and do count it.

import { parsePopFlags } from './popFlagsPaste';
import { STAGE_IMPLIES } from './popRecital';

export const PASTE_SOURCE = 'popflags_paste';
export const MAX_LINES = 120;
export const MAX_LINE_LEN = 400;

export type PasteRow = {
  guild_id: string; character: string; flag_key: string; zone: null; boss: null;
  source: typeof PASTE_SOURCE; earned_at: string; stage: string; npc: null;
};

/** The step itself, then each catalog flag it implies, one row per flag key, all at one time (as recitalRows). */
export function pasteRows(guildId: string, character: string, flags: Iterable<string>, earnedAt: string): PasteRow[] {
  const rows: PasteRow[] = [];
  const seen = new Set<string>();
  const push = (flag_key: string, stage: string) => {
    if (seen.has(flag_key)) return;
    seen.add(flag_key);
    rows.push({ guild_id: guildId, character, flag_key, zone: null, boss: null, source: PASTE_SOURCE, earned_at: earnedAt, stage, npc: null });
  };
  for (const s of flags) {
    push(s, s);
    for (const k of STAGE_IMPLIES[s] ?? []) push(k, s);
  }
  return rows;
}

export type PasteDeps = {
  guildId: string;
  userId: () => Promise<string | null>;
  /** The names of the characters on the signed-in member's account (ownedCharacters). */
  owned: (userId: string) => Promise<string[]>;
  /** Of these flag keys, the ones this character already has a 'popflags_paste' row for. null = could not check. */
  heldKeys: (character: string, keys: string[]) => Promise<string[] | null>;
  /** Insert rows, ignoring collisions on (guild_id, character, flag_key, earned_at). Returns an error message or null. */
  insert: (rows: PasteRow[]) => Promise<string | null>;
  now: () => Date;
  allow: (userId: string) => boolean;
};

export type PasteResult =
  | { ok: true; written: number; already: number; steps: number }
  | { ok: false; error: string };

export async function savePopFlags(deps: PasteDeps, character: unknown, lines: unknown): Promise<PasteResult> {
  if (typeof character !== 'string' || !character.trim() || character.length > 64) return { ok: false, error: 'bad request' };
  if (!Array.isArray(lines) || lines.length === 0 || lines.length > MAX_LINES
      || lines.some(s => typeof s !== 'string' || s.length > MAX_LINE_LEN)) {
    return { ok: false, error: 'bad request' };
  }

  const userId = await deps.userId();
  if (!userId) return { ok: false, error: 'not signed in' };
  if (!deps.allow(userId)) return { ok: false, error: 'You saved a lot just now. Give it a few minutes.' };

  // Ownership before anything else is read: the character must be on this member's account, under its real casing.
  const name = (await deps.owned(userId)).find(n => n.toLowerCase() === character.trim().toLowerCase());
  if (!name) return { ok: false, error: 'not your character' };

  const parsed = parsePopFlags((lines as string[]).join('\n'));
  if (parsed.flags.length === 0) return { ok: false, error: 'No #popflags line we can read in that. Nothing to save.' };

  const rows = pasteRows(deps.guildId, name, parsed.flags, deps.now().toISOString());
  const have = await deps.heldKeys(name, rows.map(r => r.flag_key));
  if (have === null) return { ok: false, error: 'Could not check what is already saved. Try again.' };
  const haveSet = new Set(have);
  const fresh = rows.filter(r => !haveSet.has(r.flag_key));
  if (fresh.length > 0) {
    const err = await deps.insert(fresh);
    if (err) return { ok: false, error: 'Could not save. Try again.' };
  }
  return { ok: true, written: fresh.length, already: rows.length - fresh.length, steps: parsed.flags.length };
}
