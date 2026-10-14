// Game accounts: which of a member's characters sit on which EverQuest game account (the guild lead,
// 2026-10-13). Tables: game_accounts + character_accounts (supabase/migrations/20261013120000_game_accounts.sql).
//
// Server rules this encodes: a forum account holds up to 10 game logins ("accounts"); a game account holds up to
// 8 characters; #charactertransfer moves a character between accounts of the same forum account only, and only
// if the target has room. The reason the page exists: the shared bank belongs to the account, so
// /me/inventory has to know who shares one before it can count a shared stack once.
//
// Everything here takes the database client and the owner as arguments, and imports only the guild tag. The
// callers (the /me/accounts page and its server actions) resolve the signed-in person and the characters they
// own (ownedCharacters), which keeps the rules testable against a fake client.
//
// Membership rows are HISTORY: a move closes the character's open row (valid_to) and opens a new one, and
// account_id is never updated in place. Owner key = the household ROOT Discord id, so merged members share
// their accounts the way they share their characters.

import { GUILD_TAG } from './guild';

export const MAX_ACCOUNTS = 10;
export const MAX_PER_ACCOUNT = 8;
export const LABEL_MAX = 40;
const GUILD = GUILD_TAG;

// The slice of the Supabase client this file uses (kept loose so tests can hand in a fake).
export type Db = { from(table: string): any };

export type OwnedLike = { name: string; class: string | null };

export type PlacedChar = {
  name: string;
  cls: string | null;
  /** Display name of the account this character was last moved out of, when that is a different one. */
  movedFrom: string | null;
  movedAt: string | null;
};
export type AccountView = { slot: number; label: string | null; members: PlacedChar[] };
export type GameAccountsState = { accounts: AccountView[]; unplaced: PlacedChar[] };
export type Result = { ok: boolean; error?: string; state?: GameAccountsState };

type AccountRow = { id: string; slot: number; label: string | null };
type MemberRow = {
  id: number; character_name: string; account_id: string;
  valid_from: string; valid_to: string | null;
};

export function accountName(slot: number, label: string | null): string {
  return label && label.trim() ? label : `Account ${slot}`;
}

/** Trim; empty becomes null; over the limit is refused (null return + error text from the caller). */
export function cleanLabel(raw: string | null | undefined): { ok: true; label: string | null } | { ok: false; error: string } {
  const t = (raw ?? '').trim();
  if (!t) return { ok: true, label: null };
  if (t.length > LABEL_MAX) return { ok: false, error: `name is too long (${LABEL_MAX} characters at most)` };
  return { ok: true, label: t };
}

const validSlot = (s: unknown): s is number => Number.isInteger(s) && (s as number) >= 1 && (s as number) <= MAX_ACCOUNTS;

/**
 * The household root Discord id for a signed-in auth user: wolfpack_members.merged_into_discord_id, else the
 * member's own discord_id. null when the user is not a linked member.
 */
export async function ownerDiscordId(db: Db, userId: string): Promise<string | null> {
  const { data } = await db.from('wolfpack_members')
    .select('discord_id, merged_into_discord_id').eq('user_id', userId).maybeSingle();
  const row = data as { discord_id: string | null; merged_into_discord_id: string | null } | null;
  return row?.merged_into_discord_id || row?.discord_id || null;
}

// Make sure the owner has all ten account rows (created the first time the page is used).
async function ensureAccounts(db: Db, owner: string): Promise<AccountRow[]> {
  const read = async () => {
    const { data, error } = await db.from('game_accounts')
      .select('id, slot, label').eq('guild_id', GUILD).eq('owner_discord_id', owner).order('slot');
    if (error) throw new Error(error.message);
    return (data ?? []) as AccountRow[];
  };
  let rows = await read();
  if (rows.length < MAX_ACCOUNTS) {
    const have = new Set(rows.map(r => r.slot));
    const missing = [];
    for (let slot = 1; slot <= MAX_ACCOUNTS; slot++) {
      if (!have.has(slot)) missing.push({ guild_id: GUILD, owner_discord_id: owner, slot });
    }
    const { error } = await db.from('game_accounts')
      .upsert(missing, { onConflict: 'guild_id,owner_discord_id,slot', ignoreDuplicates: true });
    if (error) throw new Error(error.message);
    rows = await read();
  }
  return rows;
}

async function readMembers(db: Db, accountIds: string[]): Promise<MemberRow[]> {
  const { data, error } = await db.from('character_accounts')
    .select('id, character_name, account_id, valid_from, valid_to')
    .eq('guild_id', GUILD).in('account_id', accountIds).order('valid_from');
  if (error) throw new Error(error.message);
  return (data ?? []) as MemberRow[];
}

function build(accounts: AccountRow[], members: MemberRow[], owned: OwnedLike[]): GameAccountsState {
  const bySlot = new Map(accounts.map(a => [a.id, a]));
  const open = new Map<string, MemberRow>();             // lower(name) -> open row
  const lastClosed = new Map<string, MemberRow>();       // lower(name) -> latest closed row
  for (const m of members) {
    const k = m.character_name.toLowerCase();
    if (m.valid_to == null) open.set(k, m);
    else {
      const prev = lastClosed.get(k);
      if (!prev || (prev.valid_to ?? '') < m.valid_to) lastClosed.set(k, m);
    }
  }
  const place = (c: OwnedLike): PlacedChar => {
    const k = c.name.toLowerCase();
    const closed = lastClosed.get(k);
    const now = open.get(k);
    const from = closed && closed.account_id !== now?.account_id ? bySlot.get(closed.account_id) : null;
    return {
      name: c.name,
      cls: c.class ?? null,
      movedFrom: from ? accountName(from.slot, from.label) : null,
      movedAt: from ? closed!.valid_to : null,
    };
  };
  const views: AccountView[] = accounts.map(a => ({ slot: a.slot, label: a.label, members: [] }));
  const viewById = new Map(accounts.map((a, i) => [a.id, views[i]]));
  const unplaced: PlacedChar[] = [];
  for (const c of owned) {
    const o = open.get(c.name.toLowerCase());
    const view = o ? viewById.get(o.account_id) : undefined;
    if (view) view.members.push(place(c)); else unplaced.push(place(c));
  }
  return { accounts: views, unplaced };
}

/** The signed-in owner's ten accounts, who is on each, and the owned characters not yet placed. */
export async function loadGameAccounts(db: Db, owner: string, owned: OwnedLike[]): Promise<GameAccountsState> {
  const accounts = await ensureAccounts(db, owner);
  const members = await readMembers(db, accounts.map(a => a.id));
  return build(accounts, members, owned);
}

/**
 * Move one of the owner's characters to `slot`, or unplace it (slot null). `owned` is the caller's own list
 * (ownedCharacters); a name not in it is refused. A full target (8 open members) refuses the move. A move closes
 * the open row and opens a new one; moving to where it already is changes nothing.
 */
export async function moveCharacter(
  db: Db, owner: string, owned: OwnedLike[], character: string, slot: number | null,
): Promise<Result> {
  const who = owned.find(c => c.name.toLowerCase() === String(character ?? '').trim().toLowerCase());
  if (!who) return { ok: false, error: 'that is not one of your characters' };
  if (slot !== null && !validSlot(slot)) return { ok: false, error: 'pick an account from 1 to 10' };

  try {
    const accounts = await ensureAccounts(db, owner);
    const members = await readMembers(db, accounts.map(a => a.id));
    const open = members.filter(m => m.valid_to == null);
    const current = open.find(m => m.character_name.toLowerCase() === who.name.toLowerCase());
    const target = slot === null ? null : accounts.find(a => a.slot === slot) ?? null;
    if (slot !== null && !target) return { ok: false, error: 'that account does not exist' };

    const unchanged = (current?.account_id ?? null) === (target?.id ?? null);
    if (!unchanged) {
      if (target) {
        const n = open.filter(m => m.account_id === target.id).length;
        if (n >= MAX_PER_ACCOUNT) {
          return { ok: false, error: `${accountName(target.slot, target.label)} is full (${MAX_PER_ACCOUNT} characters)` };
        }
      }
      const now = new Date().toISOString();
      if (current) {
        const { error } = await db.from('character_accounts').update({ valid_to: now }).eq('id', current.id).is('valid_to', null);
        if (error) return { ok: false, error: error.message };
      }
      if (target) {
        const { error } = await db.from('character_accounts').insert({
          guild_id: GUILD, character_name: who.name, account_id: target.id, valid_from: now, source: 'owner',
        });
        if (error) {
          // Put the old membership back so a failed move never leaves the character unplaced.
          if (current) await db.from('character_accounts').update({ valid_to: null }).eq('id', current.id);
          return { ok: false, error: error.message };
        }
      }
    }
    return { ok: true, state: await loadGameAccounts(db, owner, owned) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'could not save' };
  }
}

/** Give an account an alternate name (null or empty puts "Account N" back). */
export async function renameAccount(
  db: Db, owner: string, owned: OwnedLike[], slot: number, label: string | null,
): Promise<Result> {
  if (!validSlot(slot)) return { ok: false, error: 'pick an account from 1 to 10' };
  const clean = cleanLabel(label);
  if (!clean.ok) return { ok: false, error: clean.error };
  try {
    await ensureAccounts(db, owner);
    const { error } = await db.from('game_accounts').update({ label: clean.label })
      .eq('guild_id', GUILD).eq('owner_discord_id', owner).eq('slot', slot);
    if (error) return { ok: false, error: error.message };
    return { ok: true, state: await loadGameAccounts(db, owner, owned) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : 'could not save' };
  }
}
