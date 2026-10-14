// Saving a Seer recital for one of YOUR characters (web/app/pop/guide/actions.ts saveSeerRecital). The rules live
// here with every outside thing passed in, so the ownership check, the idempotency and the rate limit can be
// tested without a database or a session (test/pop-seer-paste.test.js).
//
// What is stored, and what is not: only the pop_flags rows the recital proves, the same rows the agent writes
// when Mimic sees the Seer (source 'recital'). The paste itself is never stored. The browser sends the matched
// sentences and nothing else of what was pasted, and the server reads those again with the same table rather
// than trust the stage names the browser worked out.

import { parseRecital, recitalRows, type PopFlagRow } from './popRecital';

export const MAX_SENTENCES = 60;
export const MAX_SENTENCE_LEN = 400;

export type SaveDeps = {
  guildId: string;
  userId: () => Promise<string | null>;
  /** The names of the characters on the signed-in member's account (ownedCharacters). */
  owned: (userId: string) => Promise<string[]>;
  /** Of these flag keys, the ones this character already has a 'recital' row for. */
  recitalKeys: (character: string, keys: string[]) => Promise<string[] | null>;
  /** Insert rows, ignoring any that collide on (guild_id, character, flag_key, earned_at). Returns an error message or null. */
  insert: (rows: PopFlagRow[]) => Promise<string | null>;
  now: () => Date;
  allow: (userId: string) => boolean;
};

export type SaveResult =
  | { ok: true; written: number; already: number; stages: number }
  | { ok: false; error: string };

export async function saveRecital(deps: SaveDeps, character: unknown, sentences: unknown): Promise<SaveResult> {
  if (typeof character !== 'string' || !character.trim() || character.length > 64) return { ok: false, error: 'bad request' };
  if (!Array.isArray(sentences) || sentences.length === 0 || sentences.length > MAX_SENTENCES
      || sentences.some(s => typeof s !== 'string' || s.length > MAX_SENTENCE_LEN)) {
    return { ok: false, error: 'bad request' };
  }

  const userId = await deps.userId();
  if (!userId) return { ok: false, error: 'not signed in' };
  if (!deps.allow(userId)) return { ok: false, error: 'You saved a lot just now. Give it a few minutes.' };

  // Ownership, before anything else is read: the character must be on this member's account, under its real casing.
  const name = (await deps.owned(userId)).find(n => n.toLowerCase() === character.trim().toLowerCase());
  if (!name) return { ok: false, error: 'not your character' };

  const parsed = parseRecital((sentences as string[]).join('\n'));
  if (parsed.stages.length === 0) return { ok: false, error: 'No Seer sentence in that. Nothing to save.' };

  // One time for the whole paste. A re-paste gets a new time, so what is already on record is left out rather
  // than written twice; the table's own key (guild, character, flag, time) is only the backstop.
  const rows = recitalRows(deps.guildId, name, parsed.stages, deps.now().toISOString());
  const have = await deps.recitalKeys(name, rows.map(r => r.flag_key));
  if (have === null) return { ok: false, error: 'Could not check what is already saved. Try again.' };
  const haveSet = new Set(have);
  const fresh = rows.filter(r => !haveSet.has(r.flag_key));
  if (fresh.length > 0) {
    const err = await deps.insert(fresh);
    if (err) return { ok: false, error: 'Could not save. Try again.' };
  }
  return { ok: true, written: fresh.length, already: rows.length - fresh.length, stages: parsed.stages.length };
}

/** A small per-process limiter: at most `max` saves per `windowMs` for one member. A serverless instance keeps its
 *  own count, so it is a speed bump and not a wall; the idempotency above is what bounds the table. */
export function makeLimiter(max: number, windowMs: number, now: () => number = Date.now) {
  const hits = new Map<string, number[]>();
  return (key: string): boolean => {
    const t = now();
    const recent = (hits.get(key) ?? []).filter(x => t - x < windowMs);
    if (recent.length >= max) { hits.set(key, recent); return false; }
    recent.push(t);
    hits.set(key, recent);
    if (hits.size > 2000) for (const [k, v] of hits) if (v.every(x => t - x >= windowMs)) hits.delete(k);
    return true;
  };
}
