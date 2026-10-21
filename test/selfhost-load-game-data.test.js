// test/selfhost-load-game-data.test.js — the self-host "load game data" wizard step.
//
// It wraps the weekly catalog import for a guild's OWN Supabase project and must
// (1) never run against Wolf Pack's production project, (2) verify what landed rather
// than trust the sync's exit code, (3) leave selfhost-bootstrap-db.sh alone except for
// the pointer line. The flow runs for real with the sync steps and the count query
// stubbed, so a comment cannot satisfy these.
//
// Run: npx vitest run test/selfhost-load-game-data.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const SCRIPT = path.join(ROOT, 'scripts', 'selfhost-load-game-data.js');
const { checkEnv, verifyCounts, run, WOLFPACK_PROJECT_REF } = require(SCRIPT);

const GUILD = { SUPABASE_URL: 'https://guildproject.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_x' };
const TABLES = ['eqemu_zone', 'eqemu_items', 'eqemu_spells'];

describe('guard', () => {
  it('refuses Wolf Pack\'s production project by URL', () => {
    expect(() => checkEnv({ ...GUILD, SUPABASE_URL: `https://${WOLFPACK_PROJECT_REF}.supabase.co` })).toThrow(/REFUSED/);
    expect(() => checkEnv({ ...GUILD, SUPABASE_URL: `https://${WOLFPACK_PROJECT_REF.toUpperCase()}.supabase.co/` })).toThrow(/REFUSED/);
  });

  it('refuses a service-role key minted for the production project', () => {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    const jwt = `${b64({ alg: 'HS256' })}.${b64({ role: 'service_role', ref: WOLFPACK_PROJECT_REF })}.sig`;
    expect(() => checkEnv({ ...GUILD, SUPABASE_SERVICE_ROLE_KEY: jwt })).toThrow(/REFUSED/);
  });

  it('refuses missing or malformed env', () => {
    expect(() => checkEnv({})).toThrow(/required/);
    expect(() => checkEnv({ SUPABASE_URL: GUILD.SUPABASE_URL })).toThrow(/required/);
    expect(() => checkEnv({ ...GUILD, SUPABASE_URL: 'not-a-url' })).toThrow(/URL/);
  });

  it('accepts a guild project (hosted or local stack)', () => {
    expect(checkEnv(GUILD).url).toBe('https://guildproject.supabase.co');
    expect(checkEnv({ ...GUILD, SUPABASE_URL: 'http://localhost:54321/' }).url).toBe('http://localhost:54321');
  });

  it('the CLI exits 1 before doing anything when env is missing or points at production', () => {
    const go = (env) => spawnSync(process.execPath, [SCRIPT], { env: { PATH: process.env.PATH, ...env }, encoding: 'utf8', timeout: 20000 });
    const none = go({});
    expect(none.status).toBe(1);
    expect(none.stderr).toMatch(/required/);
    const prod = go({ SUPABASE_URL: `https://${WOLFPACK_PROJECT_REF}.supabase.co`, SUPABASE_SERVICE_ROLE_KEY: 'k' });
    expect(prod.status).toBe(1);
    expect(prod.stderr).toMatch(/REFUSED/);
  });
});

describe('verifyCounts', () => {
  const reported = { eqemu_zone: 192, eqemu_items: 26972, eqemu_spells: 3933 };

  it('passes when every table matches what the sync wrote', () => {
    const v = verifyCounts(TABLES, reported, { ...reported });
    expect(v.ok).toBe(true);
    expect(v.rows.map((r) => r.status)).toEqual(['ok', 'ok', 'ok']);
  });

  it('fails on an empty table', () => {
    const v = verifyCounts(TABLES, reported, { ...reported, eqemu_items: 0 });
    expect(v.ok).toBe(false);
    expect(v.rows.find((r) => r.table === 'eqemu_items').status).toBe('EMPTY');
  });

  it('fails on a table the sync never wrote, even if it has rows', () => {
    const v = verifyCounts(TABLES, { eqemu_zone: 192, eqemu_items: 26972 }, { ...reported });
    expect(v.ok).toBe(false);
    expect(v.rows.find((r) => r.table === 'eqemu_spells').status).toMatch(/NOT WRITTEN/);
  });

  it('fails on fewer rows than the sync wrote', () => {
    const v = verifyCounts(TABLES, reported, { ...reported, eqemu_zone: 190 });
    expect(v.ok).toBe(false);
    expect(v.rows[0].status).toBe('MISSING 2');
  });

  it('fails on more rows than the sync wrote unless extras are allowed', () => {
    const more = { ...reported, eqemu_zone: 195 };
    expect(verifyCounts(TABLES, reported, more).ok).toBe(false);
    expect(verifyCounts(TABLES, reported, more, { allowExtra: true }).ok).toBe(true);
  });
});

// A fake guild database + fake sync steps, so run() executes its real flow.
function harness(over = {}) {
  const db = { ...(over.db || {}) };
  const wrote = over.wrote || { eqemu_zone: 192, eqemu_items: 26972, eqemu_spells: 3933 };
  const quests = over.quests ?? 5719;
  const calls = [];
  const out = [];
  const io = {
    expectedTables: TABLES,
    log: (m) => out.push(m),
    err: (m) => out.push(m),
    countTable: async (t) => (t === 'eqemu_quest_scripts' ? db.quests || 0 : db[t] || 0),
    readState: () => ({ counts: wrote }),
    runStep: (script, env) => {
      calls.push({ script, env });
      if (script === 'sync-from-eqmac.js') { if (over.catalogExit) return over.catalogExit; Object.assign(db, over.landed || wrote); }
      else { db.quests = quests; if (over.questExit) return over.questExit; }
      return 0;
    },
  };
  return { io, calls, out, db };
}

describe('run (the real flow, sync + count query stubbed)', () => {
  it('first run on an empty project: forces the import, verifies, passes', async () => {
    const h = harness();
    expect(await run(GUILD, h.io)).toBe(0);
    expect(h.calls.map((c) => c.script)).toEqual(['sync-from-eqmac.js', 'sync-quest-scripts.js']);
    expect(h.calls[0].env.FORCE_RESYNC).toBe('true');
    expect(h.out.join('\n')).toMatch(/VERIFIED/);
  });

  it('re-run on a populated project: does not force (the dump-sha skip stays in effect)', async () => {
    const h = harness({ db: { eqemu_zone: 192, eqemu_items: 26972, eqemu_spells: 3933, quests: 5719 } });
    expect(await run(GUILD, h.io)).toBe(0);
    expect(h.calls[0].env.FORCE_RESYNC).toBe('');
  });

  it('never points the sync at the repo\'s own data/sync_state.json', async () => {
    const h = harness();
    await run(GUILD, h.io);
    expect(h.calls[0].env.SYNC_STATE_FILE).toBeTruthy();
    expect(h.calls[0].env.SYNC_STATE_FILE).not.toMatch(/data[\\/]sync_state\.json$/);
    const own = harness();
    await run({ ...GUILD, SELFHOST_SYNC_STATE: '/some/own/state.json' }, own.io);
    expect(own.calls[0].env.SYNC_STATE_FILE).toBe('/some/own/state.json');
  });

  it('fails (1) when the sync exited 0 but a table is empty in the database', async () => {
    const h = harness({ landed: { eqemu_zone: 192, eqemu_items: 0, eqemu_spells: 3933 } });
    expect(await run(GUILD, h.io)).toBe(1);
    expect(h.out.join('\n')).toMatch(/NOT VERIFIED[\s\S]*eqemu_items/);
  });

  it('fails (1) when a count differs from what the sync wrote', async () => {
    const h = harness({ landed: { eqemu_zone: 192, eqemu_items: 26000, eqemu_spells: 3933 } });
    expect(await run(GUILD, h.io)).toBe(1);
    expect(h.out.join('\n')).toMatch(/MISSING 972/);
  });

  it('stops without verifying when the catalog sync itself fails', async () => {
    const h = harness({ catalogExit: 1 });
    expect(await run(GUILD, h.io)).toBe(1);
    expect(h.calls.map((c) => c.script)).toEqual(['sync-from-eqmac.js']);
  });

  it('a failed mob-script sync fails the step but the catalog is still verified', async () => {
    const h = harness({ questExit: 1 });
    expect(await run(GUILD, h.io)).toBe(1);
    expect(h.out.join('\n')).toMatch(/eqemu_zone\s+192\s+192\s+ok/);
  });

  it('fails when the sync reports no counts to verify against', async () => {
    const h = harness();
    h.io.readState = () => { throw new Error('ENOENT'); };
    expect(await run(GUILD, h.io)).toBe(1);
  });

  it('skips the (Quarm) mob scripts for a guild\'s own dump unless QUESTS_REPO is set', async () => {
    const own = harness();
    expect(await run({ ...GUILD, DUMP_URL: 'https://<dump-host>/own.tar.gz' }, own.io)).toBe(0);
    expect(own.calls.map((c) => c.script)).toEqual(['sync-from-eqmac.js']);
    expect(own.calls[0].env.DUMP_URL_OVERRIDE).toBe('https://<dump-host>/own.tar.gz');
    const fork = harness();
    await run({ ...GUILD, DUMP_URL: 'https://<dump-host>/own.tar.gz', QUESTS_REPO: 'myguild/quests' }, fork.io);
    expect(fork.calls.map((c) => c.script)).toEqual(['sync-from-eqmac.js', 'sync-quest-scripts.js']);
  });

  it('refuses production before running anything', async () => {
    const h = harness();
    expect(await run({ ...GUILD, SUPABASE_URL: `https://${WOLFPACK_PROJECT_REF}.supabase.co` }, h.io)).toBe(1);
    expect(h.calls).toEqual([]);
  });
});

describe('wiring', () => {
  it('verifies every table the catalog sync can write', () => {
    // The default expected set is the sync's own PK_MAP, so a table added to the sync
    // is verified here with no edit.
    const { PK_MAP } = require(path.join(ROOT, 'scripts', 'sync-from-eqmac.js'));
    expect(Object.keys(PK_MAP)).toContain('eqemu_npc_spells_entries');
    expect(Object.keys(PK_MAP).every((t) => t.startsWith('eqemu_'))).toBe(true);
  });

  it('the sync still defaults to the repo state file and honours SYNC_STATE_FILE', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'scripts', 'sync-from-eqmac.js'), 'utf8'));
    expect(src).toMatch(/STATE_FILE\s*=\s*process\.env\.SYNC_STATE_FILE\s*\|\|\s*path\.join\(__dirname,\s*'\.\.',\s*'data',\s*'sync_state\.json'\)/);
  });

  it('selfhost-bootstrap-db.sh still parses and its only addition is the closing pointer line', () => {
    const file = path.join(ROOT, 'scripts', 'selfhost-bootstrap-db.sh');
    expect(spawnSync('bash', ['-n', file]).status).toBe(0);
    const lines = fs.readFileSync(file, 'utf8').trimEnd().split('\n');
    const last = lines[lines.length - 1];
    expect(last).toMatch(/selfhost-load-game-data\.js/);
    // It sits on the success path: after the `fi` that closes the INCOMPLETE exit.
    const fi = lines.lastIndexOf('fi');
    const incomplete = lines.findIndex((l) => l.includes('INCOMPLETE'));
    expect(fi).toBeGreaterThan(incomplete);
    expect(lines.length - 1).toBeGreaterThan(fi);
    // And it is the only line that mentions the new step.
    expect(lines.filter((l) => l.includes('selfhost-load-game-data')).length).toBe(1);
  });
});
