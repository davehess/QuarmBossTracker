// test/game-accounts-label-crypto.test.js: the account label on /me/accounts is encrypted at rest (the guild
// lead, 2026-10-16).
//
// web/lib/labelCrypto.ts is run for real (AES-256-GCM, bound to the row by its AAD). web/lib/gameAccounts.ts is
// run against a small in-memory stand-in for the Supabase client, to prove what reaches the table:
//   - with a key: a rename stores label_enc (never the text) and nulls label, and the page reads it back
//   - with no key: a rename writes label exactly as before
//   - a plaintext label left from before the key moves over on read; a value copied onto another row reads as null
// Invented labels only; nothing here is anybody's account.
//
// Run: npx vitest run test/game-accounts-label-crypto.test.js

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import { ROOT, stripJs, stripSql } from './_source-slice.js';
import { encryptLabel, decryptLabel, labelKeyReady } from '../web/lib/labelCrypto.ts';
import { renameAccount, loadGameAccounts } from '../web/lib/gameAccounts.ts';

const OWNER = '100000000000000001';
const OTHER = '100000000000000002';
const AAD = `${OWNER}:3`;
const KEY_VAR = 'GAME_ACCOUNT_LABEL_KEY';

let saved;
beforeEach(() => { saved = process.env[KEY_VAR]; });
afterEach(() => {
  if (saved === undefined) delete process.env[KEY_VAR]; else process.env[KEY_VAR] = saved;
});
const setKey = () => { process.env[KEY_VAR] = randomBytes(32).toString('base64'); };

// Just the calls gameAccounts.ts makes on game_accounts.
function makeDb(rows = []) {
  const t = { game_accounts: rows };
  let n = 0;
  const from = (table) => {
    if (table === 'character_accounts') {                  // membership is not under test: always empty
      const empty = { select: () => empty, eq: () => empty, in: () => empty, order: () => empty,
        then: (res) => res({ data: [], error: null }) };
      return empty;
    }
    if (table !== 'game_accounts') throw new Error('unexpected table ' + table);
    const q = { filters: [], op: 'select', payload: null, ord: null };
    const hit = () => t.game_accounts.filter(r => q.filters.every(f => f(r)));
    const b = {
      select() { return b; },
      eq(k, v) { q.filters.push(r => r[k] === v); return b; },
      is(k, v) { q.filters.push(r => (v === null ? r[k] == null : r[k] === v)); return b; },
      order(k) { q.ord = k; return b; },
      update(p) { q.op = 'update'; q.payload = p; return b; },
      upsert(p) { q.op = 'upsert'; q.payload = p; return b; },
      then(res) {
        if (q.op === 'select') {
          const out = hit().map(r => ({ label: null, label_enc: null, ...r }));
          if (q.ord) out.sort((a, c) => a[q.ord] - c[q.ord]);
          return res({ data: out, error: null });
        }
        if (q.op === 'update') { for (const r of hit()) Object.assign(r, q.payload); return res({ error: null }); }
        for (const p of q.payload) {
          if (!t.game_accounts.some(r => r.owner_discord_id === p.owner_discord_id && r.slot === p.slot)) {
            t.game_accounts.push({ id: `acct-${++n}`, label: null, label_enc: null, ...p });
          }
        }
        return res({ error: null });
      },
    };
    return b;
  };
  return { db: { from }, t };
}
const slot = (t, owner, s) => t.game_accounts.find(r => r.owner_discord_id === owner && r.slot === s);

describe('labelCrypto', () => {
  it('round-trips a label and uses the v1 format', () => {
    setKey();
    const enc = encryptLabel('Bank alts', AAD);
    expect(enc).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(enc).not.toContain('Bank alts');
    expect(decryptLabel(enc, AAD)).toBe('Bank alts');
  });

  it('uses a fresh IV each time', () => {
    setKey();
    expect(encryptLabel('Same', AAD)).not.toBe(encryptLabel('Same', AAD));
  });

  it('a different AAD (another row) decrypts to null', () => {
    setKey();
    const enc = encryptLabel('Bank alts', AAD);
    expect(decryptLabel(enc, `${OWNER}:4`)).toBeNull();
    expect(decryptLabel(enc, `${OTHER}:3`)).toBeNull();
  });

  it('a tampered value decrypts to null', () => {
    setKey();
    const [v, iv, body] = encryptLabel('Bank alts', AAD).split(':');
    const raw = Buffer.from(body, 'base64');
    raw[0] ^= 1;
    expect(decryptLabel(`${v}:${iv}:${raw.toString('base64')}`, AAD)).toBeNull();
    expect(decryptLabel(`v2:${iv}:${body}`, AAD)).toBeNull();
    expect(decryptLabel('not a ciphertext', AAD)).toBeNull();
    expect(decryptLabel('', AAD)).toBeNull();
  });

  it('a different key decrypts to null', () => {
    setKey();
    const enc = encryptLabel('Bank alts', AAD);
    setKey();
    expect(decryptLabel(enc, AAD)).toBeNull();
  });

  it('is not ready without a valid key, and never throws on read', () => {
    setKey();
    const enc = encryptLabel('Bank alts', AAD);
    delete process.env[KEY_VAR];
    expect(labelKeyReady()).toBe(false);
    expect(decryptLabel(enc, AAD)).toBeNull();
    expect(() => encryptLabel('x', AAD)).toThrow();
    process.env[KEY_VAR] = randomBytes(16).toString('base64');
    expect(labelKeyReady()).toBe(false);
    setKey();
    expect(labelKeyReady()).toBe(true);
  });
});

describe('gameAccounts with the key set', () => {
  it('a rename stores ciphertext in label_enc, nulls label, and reads back', async () => {
    setKey();
    const { db, t } = makeDb();
    const r = await renameAccount(db, OWNER, [], 3, '  Bank alts ');
    expect(r.ok).toBe(true);
    const row = slot(t, OWNER, 3);
    expect(row.label).toBeNull();
    expect(row.label_enc).toMatch(/^v1:/);
    expect(JSON.stringify(t)).not.toContain('Bank alts');
    expect(decryptLabel(row.label_enc, AAD)).toBe('Bank alts');
    expect(r.state.accounts.find(a => a.slot === 3).label).toBe('Bank alts');
  });

  it('an empty rename clears both columns', async () => {
    setKey();
    const { db, t } = makeDb();
    await renameAccount(db, OWNER, [], 3, 'Bank alts');
    const r = await renameAccount(db, OWNER, [], 3, '   ');
    expect(r.ok).toBe(true);
    expect(slot(t, OWNER, 3).label).toBeNull();
    expect(slot(t, OWNER, 3).label_enc).toBeNull();
    expect(r.state.accounts.find(a => a.slot === 3).label).toBeNull();
  });

  it('moves a plaintext label over on read', async () => {
    const { db, t } = makeDb();
    await loadGameAccounts(db, OWNER, []);          // no key yet: creates the ten rows
    slot(t, OWNER, 5).label = 'Old name';
    setKey();
    const s = await loadGameAccounts(db, OWNER, []);
    expect(s.accounts.find(a => a.slot === 5).label).toBe('Old name');
    expect(slot(t, OWNER, 5).label).toBeNull();
    expect(decryptLabel(slot(t, OWNER, 5).label_enc, `${OWNER}:5`)).toBe('Old name');
  });

  it('a ciphertext copied onto another row reads as no label', async () => {
    setKey();
    const { db, t } = makeDb();
    await renameAccount(db, OWNER, [], 3, 'Bank alts');
    await loadGameAccounts(db, OTHER, []);
    slot(t, OTHER, 3).label_enc = slot(t, OWNER, 3).label_enc;
    const s = await loadGameAccounts(db, OTHER, []);
    expect(s.accounts.find(a => a.slot === 3).label).toBeNull();
  });
});

describe('gameAccounts with no key', () => {
  it('writes label exactly as before and touches no label_enc', async () => {
    delete process.env[KEY_VAR];
    const { db, t } = makeDb();
    const r = await renameAccount(db, OWNER, [], 3, 'Bank alts');
    expect(r.ok).toBe(true);
    expect(slot(t, OWNER, 3).label).toBe('Bank alts');
    expect(slot(t, OWNER, 3).label_enc).toBeNull();
    expect(r.state.accounts.find(a => a.slot === 3).label).toBe('Bank alts');
  });
});

describe('wiring', () => {
  const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/gameAccounts.ts'), 'utf8'));
  const crypto = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/labelCrypto.ts'), 'utf8'));

  it('the rename writes label_enc and nulls label when the key is ready', () => {
    expect(src).toMatch(/labelKeyReady\(\)\s*\?\s*\{\s*label: null,\s*label_enc:[^}]*encryptLabel\(/);
    // No key: plaintext, and any older ciphertext cleared so it cannot win on read.
    expect(src).toMatch(/:\s*\{ label: clean\.label, label_enc: null \}/);
  });

  it('the read selects label_enc and decrypts it', () => {
    expect(src).toMatch(/\.select\('id, slot, label, label_enc'\)/);
    expect(src).toMatch(/r\.label_enc \? decryptLabel\(r\.label_enc, aad\)/);
  });

  it('the lazy backfill is guarded against a racing rename', () => {
    expect(src).toMatch(/update\(\{ label_enc: encryptLabel\(r\.label, aad\), label: null \}\)[\s\S]*?\.is\('label_enc', null\)/);
  });

  it('the ciphertext is bound to the owner and slot', () => {
    expect(src).toMatch(/`\$\{owner\}:\$\{slot\}`/);
    expect(crypto).toMatch(/setAAD\(/);
    expect(crypto).toMatch(/aes-256-gcm/);
  });

  it('the migration adds the column and nothing destructive', () => {
    const sql = stripSql(fs.readFileSync(
      path.join(ROOT, 'supabase/migrations/20261016210000_game_accounts_label_enc.sql'), 'utf8'));
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS label_enc text/);
    expect(sql).not.toMatch(/DROP|DELETE|UPDATE\s/i);
  });
});
