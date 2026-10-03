// Local mode (the guild lead, 2026-10-01: "can we make a purely local version
// work?", option A; DECISIONS §118). A Mimic with no token is a finished setup,
// sends NOTHING to the guild server, and still has spell and item data because
// the installer carries a snapshot.
//
// The parts that can be run are run (the local-mode check, the seeding, the
// build's snapshot fetch). The rest are text checks with comments stripped,
// because this file's own comments describe each gate in the words a text
// check would look for.
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { spawn } from 'node:child_process';
import { AGENT_INDEX, ROOT, readSource, sliceBlock, stripJs } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const agent = stripJs(agentSrc);
const MIMIC = path.join(ROOT, 'apps', 'mimic');
const mainSrc = readSource(path.join(MIMIC, 'main.js'));
const main = stripJs(mainSrc);
const preload = stripJs(readSource(path.join(MIMIC, 'preload.js')));

describe('agent: no token sends nothing', () => {
  const block = sliceBlock(agentSrc, 'function _localOnly()', '\n');
  const localOnlyWith = (opts) => new Function('_uploadOpts', `${block}\nreturn _localOnly();`)(opts);

  it('is local only when started with no token, and not before main() has run', () => {
    expect(localOnlyWith({ botUrl: 'https://x/api/agent/encounter', token: null })).toBe(true);
    expect(localOnlyWith({ botUrl: 'https://x/api/agent/encounter', token: 'abc' })).toBe(false);
    expect(localOnlyWith(null)).toBe(false);
  });

  it('queues no upload in local mode', () => {
    const fn = sliceBlock(agent, 'function enqueueUpload(kind, payload) {', '\n');
    const body = agent.slice(agent.indexOf(fn) + fn.length, agent.indexOf(fn) + fn.length + 200);
    expect(body.trim().startsWith('if (_localOnly()) return null;')).toBe(true);
  });

  it('never posts live state without a token', () => {
    const at = agent.indexOf('function _postLiveState(targetUrl, token, payload) {');
    expect(at).toBeGreaterThan(0);
    expect(agent.slice(at, at + 120)).toMatch(/\{\s*if \(!token\) return;/);
  });

  it('starts neither the upload drain nor the version poll without a token', () => {
    expect(agent).toMatch(/if \(!dryRun && token\) startUploadQueueDrain\(\{ botUrl, token \}\);/);
    expect(agent).not.toMatch(/if \(!dryRun\) startUploadQueueDrain/);
    expect(agent).toMatch(/if \(token\) \{\s*pollLatestVersion\(\{ botUrl \}\);/);
  });

  it('tells the dashboard it is local only', () => {
    expect(agent).toMatch(/localOnly:\s+_localOnly\(\),/);
  });

  it('labels the two raid-wide overlays instead of loading forever', () => {
    expect(agent).toMatch(/_localOnly\(\) \? \{ buff_queue: \[\], debuff_queue: \[\], local_only: true \}/);
    expect(agent).toMatch(/_localOnly\(\) \? \{ targets: \[\], local_only: true \}/);
    for (const f of ['buffqueue.html', 'extarget.html']) {
      const html = readSource(path.join(MIMIC, f));
      expect(html).toMatch(/payload\.local_only\)\s*\?\s*'guild feature/);
    }
  });
});

describe('Mimic: local mode is a choice, not a missing step', () => {
  it('a saved local-mode choice is a finished setup', () => {
    expect(main).toMatch(/if \(!resolveUploadToken\(cfg\) && !cfg\.localOnly\) return 'Not signed in to Discord';/);
  });

  it('signing in clears the choice', () => {
    const at = main.indexOf('function storeUploadToken');
    expect(at).toBeGreaterThan(0);
    expect(main.slice(at, at + 1500)).toMatch(/delete cfg\.localOnly;/);
  });

  it('the setup screens and the banner save it through one IPC', () => {
    expect(main).toMatch(/ipcMain\.handle\('set-local-only'/);
    expect(preload).toMatch(/setLocalOnly:\s+\(on\)\s+=> ipcRenderer\.invoke\('set-local-only', !!on\)/);
    expect(preload).toMatch(/s\.localOnly && !s\.localModeChosen/);
    expect(readSource(path.join(MIMIC, 'loading.html'))).toMatch(/window\.mimic\.setLocalOnly\(true\)/);
    expect(readSource(path.join(MIMIC, 'welcome.html'))).toMatch(/M\.setLocalOnly\(true\)/);
  });

  it('does not ask the guild server for agent updates without a token', () => {
    const at = main.indexOf('async function checkAgentUpdate(opts) {');
    const gate = main.indexOf('if (!resolveUploadToken(loadConfig())) {', at);
    const ask = main.indexOf('/api/agent/latest-version', at);
    expect(gate).toBeGreaterThan(at);
    expect(gate).toBeLessThan(ask);
  });
});

describe('Mimic: the installer snapshot seeds the agent folder', () => {
  const block = sliceBlock(mainSrc, 'function _catalogFetchedAt(file) {', '\n}\n')
    + sliceBlock(mainSrc, 'function seedBundledCatalog(catalogDir, agentDir) {', '\n}\n');
  const seed = new Function('fs', 'path', 'appendAgentLog', `${block}\nreturn seedBundledCatalog;`)(
    fs, path, () => {});
  const write = (dir, f, at, tag) => fs.writeFileSync(path.join(dir, f),
    JSON.stringify({ fetched_at: at, etag: null, entries: [{ name: tag }] }));
  const read = (dir, f) => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8')).entries[0].name;

  it('is called every time the agent is prepared', () => {
    const at = main.indexOf('function ensureWritableAgent() {');
    const end = main.indexOf("return path.join(dst, 'index.js');", at);
    expect(main.slice(at, end)).toMatch(/seedBundledCatalog\(path\.join\(src, 'catalog'\), dst\);/);
  });

  it('copies when missing, replaces an older copy, keeps a newer one', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    const cat = path.join(tmp, 'catalog'); const dst = path.join(tmp, 'agent');
    fs.mkdirSync(cat); fs.mkdirSync(dst);
    write(cat, 'logsync.spell-catalog.json', '2026-10-01T00:00:00.000Z', 'bundled');
    write(cat, 'logsync.item-catalog.json',  '2026-10-01T00:00:00.000Z', 'bundled');
    write(cat, 'logsync.item-clickies.json', '2026-10-01T00:00:00.000Z', 'bundled');
    write(cat, 'notes.json', '2026-10-01T00:00:00.000Z', 'not a catalog');
    write(dst, 'logsync.item-catalog.json',  '2026-09-01T00:00:00.000Z', 'older');
    write(dst, 'logsync.item-clickies.json', '2026-10-05T00:00:00.000Z', 'fetched');
    seed(cat, dst);
    expect(read(dst, 'logsync.spell-catalog.json')).toBe('bundled');   // missing → copied
    expect(read(dst, 'logsync.item-catalog.json')).toBe('bundled');    // older → replaced
    expect(read(dst, 'logsync.item-clickies.json')).toBe('fetched');   // newer → kept
    expect(fs.existsSync(path.join(dst, 'notes.json'))).toBe(false);   // only the agent's cache names
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('does nothing when the installer has no snapshot', () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seed-'));
    expect(() => seed(path.join(tmp, 'nope'), tmp)).not.toThrow();
    expect(fs.readdirSync(tmp)).toEqual([]);
    fs.rmSync(tmp, { recursive: true, force: true });
  });
});

describe('build: the snapshot fetch', () => {
  let server; let base; let out;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url.endsWith('/spell-catalog')) {
        res.writeHead(200, { 'Content-Type': 'application/json', ETag: '"s1"' });
        return res.end(JSON.stringify({ version: 8, fetched_at: '2026-10-01T00:00:00.000Z', count: 1, entries: [{ id: 1, name: 'Concussion' }] }));
      }
      if (req.url.endsWith('/item-clickies')) {   // empty: must not ship
        res.writeHead(200, { 'Content-Type': 'application/json' });
        return res.end(JSON.stringify({ version: 1, fetched_at: 'x', count: 0, entries: [] }));
      }
      res.writeHead(401); res.end();               // item-catalog refused: must not fail the build
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}/api/public/catalog/`;
    out = fs.mkdtempSync(path.join(os.tmpdir(), 'stage-'));
  });
  afterAll(() => { server.close(); fs.rmSync(out, { recursive: true, force: true }); });

  it('runs before every installer build', () => {
    const pkg = JSON.parse(readSource(path.join(MIMIC, 'package.json')));
    expect(pkg.scripts.predist).toBe('node scripts/stage-catalog.js');
  });

  it('writes the agent cache shape, skips empty or refused catalogs, and never fails the build', async () => {
    const r = await new Promise((resolve) => {
      const p = spawn(process.execPath, [path.join(MIMIC, 'scripts', 'stage-catalog.js')], {
        env: { ...process.env, WOLFPACK_CATALOG_URL: base, WOLFPACK_CATALOG_OUT: out },
      });
      p.on('close', code => resolve(code));
    });
    expect(r).toBe(0);
    expect(fs.readdirSync(out)).toEqual(['logsync.spell-catalog.json']);
    const spell = JSON.parse(fs.readFileSync(path.join(out, 'logsync.spell-catalog.json'), 'utf8'));
    expect(Object.keys(spell)).toEqual(['fetched_at', 'etag', 'entries']);   // fetched_at first: the seeder reads 256 bytes
    expect(spell.etag).toBe('"s1"');
    expect(spell.entries[0].name).toBe('Concussion');
  });
});
