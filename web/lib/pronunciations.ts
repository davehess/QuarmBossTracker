// How a character's name is spoken by Mimic's voice callouts: the website side of it (the guild lead, 2026-10-17,
// picked option A: "a website place to set and HEAR how a name is said, and officers can set anyone's").
// Table: name_pronunciations (supabase/migrations/20261014120000_name_pronunciations.sql), one row per
// (guild, lower-cased character). Writes are service-role only, so every write here is done by the caller's
// service client AFTER the rule below has said yes.
//
// The rule is the bot's (index.js _handleAgentPronunciationSet), in two halves:
//   - the OWNER of a character may set or clear it. Here "owner" is the list ownedCharacters() returns for the
//     signed-in person (their household plus its alts), which is what every /me page uses;
//   - an OFFICER may set or clear any character that exists in the roster.
// Validation is the bot's too: the character is letters only (2-32), the spelling is 1-60 letters, spaces,
// hyphens and apostrophes with a leading letter (validSay, from ./pronounce, the shared pure port).
//
// Everything takes the database client and the actor as arguments and imports only the two pure helpers, so the
// rules run against a fake client in test/pronunciations-web.test.js. Clearing deletes the row; "said as
// spelled" is simply the absence of one.

import { suggestPronunciations, validSay } from './pronounce';
import { GUILD_TAG } from './guild';

// The slice of the Supabase client this file uses (loose, so tests can hand in a fake).
export type Db = { from(table: string): any };

/** Port of the bot's _PRON_NAME_RE (index.js): character names are letters only. */
export const NAME_RE = /^[A-Za-z]{2,32}$/;

export type OwnedLike = { name: string };
/** Who is asking: their OWN Discord id (recorded as set_by) and whether they are an officer. */
export type Actor = { discordId: string; officer: boolean };

export type PronEntry = {
  name: string;
  say: string | null;
  /** Display name of whoever saved it, when the member row is found. */
  setBy: string | null;
  updatedAt: string | null;
};
export type Result = { ok: boolean; error?: string; say?: string | null; updatedAt?: string | null };

type Row = { display_name: string; character_lc: string; say: string; set_by_discord_id: string | null; updated_at: string | null };

/** Trim, collapse runs of spaces, then check the shape the database accepts. */
export function cleanSay(raw: unknown): { ok: true; say: string } | { ok: false; error: string } {
  const say = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!validSay(say)) {
    return { ok: false, error: 'use 1 to 60 letters, spaces, hyphens or apostrophes, starting with a letter' };
  }
  return { ok: true, say };
}

/** The signed-in person's own Discord id (not the household root), for the set_by column. null if not a member. */
export async function memberDiscordId(db: Db, userId: string): Promise<string | null> {
  const { data } = await db.from('wolfpack_members').select('discord_id').eq('user_id', userId).maybeSingle();
  return (data as { discord_id: string | null } | null)?.discord_id ?? null;
}

/** The owner's characters joined with whatever is saved for them (saved say, or null for "said as spelled"). */
export async function myPronunciations(db: Db, owned: OwnedLike[]): Promise<PronEntry[]> {
  const names = owned.map(c => c.name).filter(n => NAME_RE.test(n));
  if (!names.length) return [];
  const { data, error } = await db.from('name_pronunciations')
    .select('display_name, character_lc, say, set_by_discord_id, updated_at')
    .eq('guild_id', GUILD_TAG).in('character_lc', names.map(n => n.toLowerCase()));
  if (error) throw new Error(error.message);
  const byLc = new Map(((data ?? []) as Row[]).map(r => [r.character_lc, r]));
  return names.map(name => {
    const r = byLc.get(name.toLowerCase());
    return { name, say: r?.say ?? null, setBy: null, updatedAt: r?.updated_at ?? null };
  });
}

/** Every saved pronunciation, newest first, each with the display name of whoever set it when that is known. */
export async function allPronunciations(db: Db): Promise<PronEntry[]> {
  const { data, error } = await db.from('name_pronunciations')
    .select('display_name, character_lc, say, set_by_discord_id, updated_at')
    .eq('guild_id', GUILD_TAG).order('updated_at', { ascending: false });
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as Row[];
  const ids = [...new Set(rows.map(r => r.set_by_discord_id).filter((x): x is string => !!x))];
  const who = new Map<string, string>();
  if (ids.length) {
    const m = await db.from('wolfpack_members').select('discord_id, nickname, global_name').in('discord_id', ids);
    for (const p of ((m.data ?? []) as { discord_id: string; nickname: string | null; global_name: string | null }[])) {
      const label = p.nickname || p.global_name;
      if (label) who.set(p.discord_id, label);
    }
  }
  return rows.map(r => ({
    name: r.display_name,
    say: r.say,
    setBy: r.set_by_discord_id ? (who.get(r.set_by_discord_id) ?? null) : null,
    updatedAt: r.updated_at,
  }));
}

// Who may touch this character, and what is its canonical spelling? An officer: any character in the roster
// (looked up, so a typo cannot create a row for nobody). Anyone else: only one in `owned`.
async function authorize(
  db: Db, actor: Actor, owned: OwnedLike[], character: unknown,
): Promise<{ ok: true; name: string } | { ok: false; error: string }> {
  const want = String(character ?? '').trim();
  if (!NAME_RE.test(want)) return { ok: false, error: 'that is not a character name' };
  const mine = owned.find(c => c.name.toLowerCase() === want.toLowerCase());
  if (mine) return { ok: true, name: mine.name };
  if (!actor.officer) return { ok: false, error: 'not your character' };
  const { data } = await db.from('characters')
    .select('name').eq('guild_id', GUILD_TAG).ilike('name', want).maybeSingle();
  const row = data as { name: string } | null;
  return row ? { ok: true, name: row.name } : { ok: false, error: 'no character by that name' };
}

/** Save how a name is said. Records the actor as set_by and keeps the other suggestions as alternates, like the bot. */
export async function savePronunciation(
  db: Db, actor: Actor, owned: OwnedLike[], character: unknown, rawSay: unknown,
): Promise<Result> {
  const s = cleanSay(rawSay);
  if (!s.ok) return { ok: false, error: s.error };
  const who = await authorize(db, actor, owned, character);
  if (!who.ok) return { ok: false, error: who.error };
  const updatedAt = new Date().toISOString();
  const alternates = suggestPronunciations(who.name).filter(x => x.toLowerCase() !== s.say.toLowerCase()).slice(0, 4);
  const { error } = await db.from('name_pronunciations').upsert({
    guild_id: GUILD_TAG,
    character_lc: who.name.toLowerCase(),
    display_name: who.name,
    say: s.say,
    alternates,
    set_by_discord_id: actor.discordId,
    updated_at: updatedAt,
  }, { onConflict: 'guild_id,character_lc' });
  if (error) return { ok: false, error: 'could not save' };
  return { ok: true, say: s.say, updatedAt };
}

/** Back to "said as spelled": the row is deleted. */
export async function clearPronunciation(
  db: Db, actor: Actor, owned: OwnedLike[], character: unknown,
): Promise<Result> {
  const who = await authorize(db, actor, owned, character);
  if (!who.ok) return { ok: false, error: who.error };
  const { error } = await db.from('name_pronunciations')
    .delete().eq('guild_id', GUILD_TAG).eq('character_lc', who.name.toLowerCase());
  if (error) return { ok: false, error: 'could not clear' };
  return { ok: true, say: null, updatedAt: null };
}
