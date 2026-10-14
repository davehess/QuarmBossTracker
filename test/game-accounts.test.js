// test/game-accounts.test.js: which character is on which game account (the guild lead, 2026-10-13).
//
// The rules in web/lib/gameAccounts.ts are run for real against a small in-memory stand-in for the Supabase
// client (the stand-in also holds the migration's "one open membership per character" index, so a racing
// double insert fails the way the database would). Invented names only; nothing here is anybody's account.
//
//   - a full account (8 open members) refuses a move
//   - a move closes the old row and opens a new one: history stays, account_id is never updated in place
//   - unplace closes the open row
//   - a rename is trimmed, empty puts the default back, over 40 is refused
//   - a character the caller does not own is refused, and writes nothing
//   - the server actions hand the rules ownedCharacters' list and the session's owner, nothing from the client
//
// Run: npx vitest run test/game-accounts.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import {
  moveCharacter, renameAccount, loadGameAccounts, ownerDiscordId, cleanLabel, MAX_PER_ACCOUNT,
} from '../web/lib/gameAccounts.ts';

// ── a fake client with just the calls the module makes ─────────────────────────────────────────
function makeDb(seed = {}) {
  const t = {
    game_accounts: [], character_accounts: [], wolfpack_members: [],
    ...seed,
  };
  let uuid = 0; let ident = 0;
  const log = [];
  const from = (table) => {
    const q = { table, filters: [], op: 'select', payload: null, opts: null, ord: null };
    const rows = () => t[table].filter(r => q.filters.every(f => f(r)));
    const b = {
      select() { return b; },
      eq(k, v) { q.filters.push(r => r[k] === v); return b; },
      in(k, vs) { q.filters.push(r => vs.includes(r[k])); return b; },
      is(k, v) { q.filters.push(r => (v === null ? r[k] == null : r[k] === v)); return b; },
      order(k) { q.ord = k; return b; },
      insert(p) { q.op = 'insert'; q.payload = p; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      upsert(p, o) { q.op = 'upsert'; q.payload = p; q.opts = o; return b; },
      maybeSingle() { q.single = true; return b; },
      then(res, rej) {
        try { res(run()); } catch (e) { rej ? rej(e) : (() => { throw e; })(); }
      },
    };
    function run() {
      if (q.op === 'select') {
        let out = rows().map(r => ({ ...r }));
        if (q.ord) out.sort((a, b2) => (a[q.ord] < b2[q.ord] ? -1 : a[q.ord] > b2[q.ord] ? 1 : 0));
        return { data: q.single ? (out[0] ?? null) : out, error: null };
      }
      log.push({ table, op: q.op, payload: q.payload });
      if (q.op === 'update') {
        for (const r of rows()) Object.assign(r, q.payload);
        return { data: null, error: null };
      }
      const list = Array.isArray(q.payload) ? q.payload : [q.payload];
      for (const p of list) {
        if (table === 'game_accounts') {
          const dup = t.game_accounts.find(r => r.guild_id === p.guild_id && r.owner_discord_id === p.owner_discord_id && r.slot === p.slot);
          if (dup) { if (q.op === 'upsert') continue; return { error: { message: 'duplicate' } }; }
          t.game_accounts.push({ id: `acct-${++uuid}`, label: null, ...p });
        } else {
          const open = !p.valid_to;
          if (open && t.character_accounts.some(r => r.valid_to == null && r.character_name.toLowerCase() === p.character_name.toLowerCase())) {
            return { error: { message: 'duplicate key value violates unique constraint "character_accounts_one_open_idx"' } };
          }
          t.character_accounts.push({ id: ++ident, valid_to: null, ...p });
        }
      }
      return { data: null, error: null };
    }
    return b;
  };
  return { db: { from }, t, log };
}

const OWNER = 'owner-1';
const owned = ['Aldenmar', 'Brackwyn', 'Corvale', 'Rethlan', 'Nyssara', 'Zarrin', 'Quillon', 'Tavrek', 'Yelmoor', 'Ostrel']
  .map(name => ({ name, class: 'Cleric' }));

const openOf = (t, name) => t.character_accounts.filter(r => r.character_name === name && r.valid_to == null);
const slotOf = (t, accountId) => t.game_accounts.find(a => a.id === accountId)?.slot;

describe('first use', () => {
  it('creates all ten accounts for the owner, once, and lists every owned character as unplaced', async () => {
    const { db, t } = makeDb();
    const s = await loadGameAccounts(db, OWNER, owned);
    expect(t.game_accounts.map(a => a.slot).sort((a, b) => a - b)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
    expect(s.accounts).toHaveLength(10);
    expect(s.unplaced.map(c => c.name)).toEqual(owned.map(c => c.name));
    await loadGameAccounts(db, OWNER, owned);
    expect(t.game_accounts).toHaveLength(10);   // not created again
  });
});

describe('moving a character', () => {
  it('opens a membership on the target account, tagged as the owner\'s doing', async () => {
    const { db, t } = makeDb();
    const r = await moveCharacter(db, OWNER, owned, 'Aldenmar', 3);
    expect(r.ok).toBe(true);
    const rows = openOf(t, 'Aldenmar');
    expect(rows).toHaveLength(1);
    expect(slotOf(t, rows[0].account_id)).toBe(3);
    expect(rows[0].source).toBe('owner');
    expect(r.state.accounts.find(a => a.slot === 3).members.map(m => m.name)).toEqual(['Aldenmar']);
    expect(r.state.unplaced.map(c => c.name)).not.toContain('Aldenmar');
  });

  it('a move closes the old row and opens a new one; the old row keeps its account (history)', async () => {
    const { db, t } = makeDb();
    await moveCharacter(db, OWNER, owned, 'Aldenmar', 2);
    const first = openOf(t, 'Aldenmar')[0];
    const r = await moveCharacter(db, OWNER, owned, 'aldenmar', 5);   // case does not matter
    expect(r.ok).toBe(true);
    const all = t.character_accounts.filter(x => x.character_name === 'Aldenmar');
    expect(all).toHaveLength(2);
    const old = all.find(x => x.id === first.id);
    expect(old.valid_to).not.toBeNull();
    expect(slotOf(t, old.account_id)).toBe(2);                        // never rewritten in place
    const now = all.find(x => x.valid_to == null);
    expect(slotOf(t, now.account_id)).toBe(5);
    expect(now.id).not.toBe(first.id);
    // the page reads the closed row as "moved from Account 2"
    const view = r.state.accounts.find(a => a.slot === 5).members[0];
    expect(view.movedFrom).toBe('Account 2');
    expect(view.movedAt).toBe(old.valid_to);
  });

  it('moving to where it already is changes nothing', async () => {
    const { db, t } = makeDb();
    await moveCharacter(db, OWNER, owned, 'Brackwyn', 4);
    const before = JSON.stringify(t.character_accounts);
    const r = await moveCharacter(db, OWNER, owned, 'Brackwyn', 4);
    expect(r.ok).toBe(true);
    expect(JSON.stringify(t.character_accounts)).toBe(before);
  });

  it('refuses a move into an account that already has 8 open members, and changes nothing', async () => {
    const { db, t } = makeDb();
    for (const c of owned.slice(0, MAX_PER_ACCOUNT)) await moveCharacter(db, OWNER, owned, c.name, 1);
    expect(t.character_accounts.filter(r => r.valid_to == null)).toHaveLength(8);
    await moveCharacter(db, OWNER, owned, 'Ostrel', 2);
    const before = JSON.stringify(t.character_accounts);
    const r = await moveCharacter(db, OWNER, owned, 'Ostrel', 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/full/);
    expect(JSON.stringify(t.character_accounts)).toBe(before);       // Ostrel stays on Account 2, nothing closed
  });

  it('a full account still lets a seventh-or-eighth character in, and a closed row frees the space', async () => {
    const { db } = makeDb();
    for (const c of owned.slice(0, 7)) await moveCharacter(db, OWNER, owned, c.name, 1);
    expect((await moveCharacter(db, OWNER, owned, 'Tavrek', 1)).ok).toBe(true);        // the 8th
    expect((await moveCharacter(db, OWNER, owned, 'Yelmoor', 1)).ok).toBe(false);      // the 9th
    await moveCharacter(db, OWNER, owned, 'Aldenmar', 6);
    expect((await moveCharacter(db, OWNER, owned, 'Yelmoor', 1)).ok).toBe(true);
  });

  it('puts the old membership back when opening the new one fails', async () => {
    const { db, t } = makeDb();
    await moveCharacter(db, OWNER, owned, 'Corvale', 2);
    // A racing request opened a membership first: the unique index refuses the second open row.
    const realFrom = db.from;
    db.from = (table) => {
      const b = realFrom(table);
      if (table === 'character_accounts') {
        const ins = b.insert;
        b.insert = (p) => { if (p.account_id) return { then: (res) => res({ error: { message: 'duplicate key' } }) }; return ins(p); };
      }
      return b;
    };
    const r = await moveCharacter(db, OWNER, owned, 'Corvale', 7);
    expect(r.ok).toBe(false);
    const open = openOf(t, 'Corvale');
    expect(open).toHaveLength(1);
    expect(slotOf(t, open[0].account_id)).toBe(2);
  });

  it('refuses a slot outside 1..10', async () => {
    const { db, t } = makeDb();
    for (const bad of [0, 11, -1, 2.5, NaN]) {
      const r = await moveCharacter(db, OWNER, owned, 'Aldenmar', bad);
      expect(r.ok).toBe(false);
    }
    expect(t.character_accounts).toHaveLength(0);
  });
});

describe('unplacing', () => {
  it('closes the open row and leaves the character unplaced', async () => {
    const { db, t } = makeDb();
    await moveCharacter(db, OWNER, owned, 'Rethlan', 8);
    const r = await moveCharacter(db, OWNER, owned, 'Rethlan', null);
    expect(r.ok).toBe(true);
    expect(openOf(t, 'Rethlan')).toHaveLength(0);
    const closed = t.character_accounts.filter(x => x.character_name === 'Rethlan');
    expect(closed).toHaveLength(1);
    expect(closed[0].valid_to).not.toBeNull();
    expect(r.state.unplaced.map(c => c.name)).toContain('Rethlan');
  });

  it('unplacing a character that is not placed writes nothing', async () => {
    const { db, t, log } = makeDb();
    await loadGameAccounts(db, OWNER, owned);
    const writes = log.length;
    const r = await moveCharacter(db, OWNER, owned, 'Nyssara', null);
    expect(r.ok).toBe(true);
    expect(log.length).toBe(writes);
    expect(t.character_accounts).toHaveLength(0);
  });
});

describe('ownership', () => {
  it('refuses a character the caller does not own and writes nothing', async () => {
    const { db, t, log } = makeDb();
    const r = await moveCharacter(db, OWNER, owned, 'Strangerlin', 1);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/not one of your characters/);
    expect(t.character_accounts).toHaveLength(0);
    expect(t.game_accounts).toHaveLength(0);
    expect(log).toHaveLength(0);
  });

  it('keeps each owner\'s accounts apart', async () => {
    const { db, t } = makeDb();
    await moveCharacter(db, 'owner-1', owned, 'Aldenmar', 1);
    const other = [{ name: 'Quillon', class: null }];
    const s = await loadGameAccounts(db, 'owner-2', other);
    expect(s.accounts.every(a => a.members.length === 0)).toBe(true);
    expect(s.unplaced.map(c => c.name)).toEqual(['Quillon']);
    expect(t.game_accounts).toHaveLength(20);
  });

  it('the owner id is the household root: a merged member resolves to the root, others to their own', async () => {
    const { db } = makeDb({
      wolfpack_members: [
        { user_id: 'u-root', discord_id: 'd-root', merged_into_discord_id: null },
        { user_id: 'u-alias', discord_id: 'd-alias', merged_into_discord_id: 'd-root' },
      ],
    });
    expect(await ownerDiscordId(db, 'u-root')).toBe('d-root');
    expect(await ownerDiscordId(db, 'u-alias')).toBe('d-root');
    expect(await ownerDiscordId(db, 'nobody')).toBeNull();
  });
});

describe('renaming', () => {
  it('trims, and an empty name puts the default back', async () => {
    const { db, t } = makeDb();
    let r = await renameAccount(db, OWNER, owned, 4, '  Bank alts  ');
    expect(r.ok).toBe(true);
    expect(t.game_accounts.find(a => a.slot === 4).label).toBe('Bank alts');
    expect(r.state.accounts.find(a => a.slot === 4).label).toBe('Bank alts');
    r = await renameAccount(db, OWNER, owned, 4, '   ');
    expect(r.ok).toBe(true);
    expect(t.game_accounts.find(a => a.slot === 4).label).toBeNull();
    r = await renameAccount(db, OWNER, owned, 4, null);
    expect(t.game_accounts.find(a => a.slot === 4).label).toBeNull();
  });

  it('allows exactly 40 characters and refuses 41', async () => {
    const { db, t } = makeDb();
    expect((await renameAccount(db, OWNER, owned, 2, 'x'.repeat(40))).ok).toBe(true);
    const r = await renameAccount(db, OWNER, owned, 3, 'x'.repeat(41));
    expect(r.ok).toBe(false);
    expect(t.game_accounts.find(a => a.slot === 3).label).toBeNull();
    expect(cleanLabel('x'.repeat(41)).ok).toBe(false);
  });

  it('only renames the caller\'s own account in that slot', async () => {
    const { db, t } = makeDb();
    await loadGameAccounts(db, 'owner-2', []);
    await renameAccount(db, OWNER, owned, 1, 'Mine');
    expect(t.game_accounts.filter(a => a.label === 'Mine').map(a => a.owner_discord_id)).toEqual([OWNER]);
  });

  it('refuses a slot outside 1..10', async () => {
    const { db, t } = makeDb();
    expect((await renameAccount(db, OWNER, owned, 0, 'x')).ok).toBe(false);
    expect((await renameAccount(db, OWNER, owned, 11, 'x')).ok).toBe(false);
    expect(t.game_accounts).toHaveLength(0);
  });

  it('a renamed account names itself in the "moved from" line', async () => {
    const { db } = makeDb();
    await renameAccount(db, OWNER, owned, 2, 'Bank');
    await moveCharacter(db, OWNER, owned, 'Zarrin', 2);
    const r = await moveCharacter(db, OWNER, owned, 'Zarrin', 9);
    expect(r.state.accounts.find(a => a.slot === 9).members[0].movedFrom).toBe('Bank');
  });
});

describe('history display', () => {
  it('a character put back where it was shows no "moved from"', async () => {
    const { db } = makeDb();
    await moveCharacter(db, OWNER, owned, 'Quillon', 3);
    await moveCharacter(db, OWNER, owned, 'Quillon', null);
    const r = await moveCharacter(db, OWNER, owned, 'Quillon', 3);
    expect(r.state.accounts.find(a => a.slot === 3).members[0].movedFrom).toBeNull();
  });

  it('an unplaced character remembers the account it left', async () => {
    const { db } = makeDb();
    await moveCharacter(db, OWNER, owned, 'Tavrek', 6);
    const r = await moveCharacter(db, OWNER, owned, 'Tavrek', null);
    expect(r.state.unplaced.find(c => c.name === 'Tavrek').movedFrom).toBe('Account 6');
  });
});

describe('wiring', () => {
  const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
  const actions = stripJs(read('web/app/me/accounts/actions.ts'));

  it('the actions take the owner from the session and the characters from ownedCharacters', () => {
    expect(actions).toMatch(/supabaseServer\(\)\.auth\.getUser\(\)/);
    expect(actions).toMatch(/ownerDiscordId\(admin, user\.id\)/);
    expect(actions).toMatch(/await ownedCharacters\(user\.id\)/);
    expect(actions).toMatch(/moveRule\(me\.admin, me\.owner, me\.owned, character, slot\)/);
    expect(actions).toMatch(/renameRule\(me\.admin, me\.owner, me\.owned, slot, label\)/);
  });

  it('neither action accepts an owner id from the caller', () => {
    expect(actions).toMatch(/export async function moveCharacter\(character: string, slot: number \| null\)/);
    expect(actions).toMatch(/export async function renameAccount\(slot: number, label: string \| null\)/);
  });

  it('the migration keeps the tables service-role only and enforces one open membership', () => {
    const sql = stripSql(read('supabase/migrations/20261013120000_game_accounts.sql'));
    expect(sql).toMatch(/ALTER TABLE public\.game_accounts\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).toMatch(/ALTER TABLE public\.character_accounts\s+ENABLE ROW LEVEL SECURITY/);
    expect(sql).not.toMatch(/CREATE POLICY/i);
    expect(sql).toMatch(/CREATE UNIQUE INDEX IF NOT EXISTS character_accounts_one_open_idx[\s\S]*lower\(character_name\)[\s\S]*WHERE valid_to IS NULL/);
    expect(sql).toMatch(/CHECK \(slot BETWEEN 1 AND 10\)/);
    expect(sql).toMatch(/CHECK \(source IN \('owner', 'inferred', 'login'\)\)/);
  });

  it('the page carries the [beta] tag and is signed-in only', () => {
    const page = stripJs(read('web/app/me/accounts/page.tsx'));
    expect(page).toMatch(/<NewPageTag/);
    expect(page).toMatch(/redirect\('\/auth\/signin\?next=\/me\/accounts'\)/);
  });
});
