// test/mimic-win7-build.test.js — the Windows 7 build of Mimic.
//
// The guild lead, 2026-11-04: "try a release on Electron 23 and Node 14 for him as a beta release for Windows 7
// specifically. He needs the charm stuff". Electron 22 is the last that starts on Windows 7; its Node is 16, so the
// agent gets node16-shim.js (fetch + AbortSignal.timeout) loaded first. The build reads only its own rolling release,
// `mimic-win7`, and must never take a normal (Electron 31) update.
//
// Run: npx vitest run test/mimic-win7-build.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import path from 'node:path';
import fs from 'node:fs';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const SHIM = path.join(ROOT, 'apps', 'mimic', 'node16-shim.js');
const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

const trackSrc = sliceBlock(main, 'const _ALPHA_FEED  = {', '  return wantBeta;\n}');
function updater(cfg, version, electron) {
  const au = { feeds: [], allowPrerelease: null, channel: null, allowDowngrade: null, setFeedURL(o) { this.feeds.push(o); } };
  // eslint-disable-next-line no-new-func
  const api = new Function('autoUpdater', 'loadConfig', 'app', 'process',
    trackSrc + '\nreturn { _applyUpdaterChannel };')(
    au, () => cfg, { getVersion: () => version }, { versions: { electron } });
  return { au, api };
}

describe('the Windows 7 build updates only from its own release', () => {
  it('an Electron 22 build reads mimic-win7/win7.yml, whatever the channel toggles say', () => {
    for (const cfg of [{}, { forceStable: true }, { alphaChannel: true }, { betaChannel: true }]) {
      const { au, api } = updater(cfg, '3.0.7-win7.4', '22.3.27');
      api._applyUpdaterChannel();
      expect(au.feeds).toEqual([{ provider: 'generic', url: 'https://github.com/davehess/raidmimic/releases/download/mimic-win7/', channel: 'win7' }]);
      expect(au.channel).toBe('win7');
      expect(au.allowDowngrade).toBe(false);
    }
  });
  it('every normal build (Electron 31) is untouched: beta stays beta on the GitHub feed', () => {
    const { au, api } = updater({}, '3.0.7-beta.11', '31.7.7');
    api._applyUpdaterChannel();
    expect(au.feeds).toEqual([]);
    expect(au.channel).toBe('beta');
  });
});

describe('the agent gets the Node 16 shim only on an old Node', () => {
  const fnSrc = sliceBlock(main, 'function _node16ShimArgs() {', '\n}\n');
  // eslint-disable-next-line no-new-func
  const make = node => new Function('process', 'path', 'fs', 'app', 'appendAgentLog', '__dirname',
    fnSrc + '\nreturn _node16ShimArgs;')(
    { versions: { node } }, path, { writeFileSync() {}, readFileSync() { return ''; } }, { getPath: () => '/ud' }, () => {}, '/app');
  it('Node 16 → --require the staged shim; Node 18+ → nothing', () => {
    expect(make('16.17.1')()).toEqual(['--require', path.join('/ud', 'node16-shim.js')]);
    expect(make('20.16.0')()).toEqual([]);
  });
  it('the spawn passes those arguments ahead of the agent', () => {
    expect(stripJs(main)).toMatch(/spawn\(process\.execPath, \[\.\.\._node16ShimArgs\(\), \.\.\.args\]/);
  });
});

// The shim, run for real in a Node with its fetch turned off.
describe('node16-shim.js', () => {
  let server; let base;
  beforeAll(async () => {
    server = http.createServer((req, res) => {
      if (req.url === '/hop') { res.writeHead(302, { location: '/json' }); res.end(); return; }
      if (req.url === '/slow') { setTimeout(() => res.end('late'), 2000); return; }
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        res.writeHead(req.url === '/missing' ? 404 : 200, { 'content-type': 'application/json', 'x-test': 'yes' });
        res.end(JSON.stringify({ method: req.method, body, auth: req.headers.authorization || null }));
      });
    });
    await new Promise(r => server.listen(0, '127.0.0.1', r));
    base = `http://127.0.0.1:${server.address().port}`;
  });
  afterAll(() => server && server.close());

  const run = code => new Promise((resolve) => {
    // spawnSync would block this process's server; run async.
    const p = spawn(process.execPath, ['--no-experimental-fetch', '-e',
      `delete AbortSignal.timeout; if (typeof fetch === 'function') { console.log('NATIVE'); process.exit(0); }
       require(${JSON.stringify(SHIM)});
       (async () => { ${code} })().catch(e => { console.log('ERR ' + e.name + ' ' + e.message); });`]);
    let out = '';
    p.stdout.on('data', d => { out += d; });
    p.stderr.on('data', d => { out += d; });
    p.on('close', () => resolve(out.trim()));
  });

  it('GET: ok, status, headers.get and json', async () => {
    const out = await run(`const r = await fetch('${base}/json', { headers: { Authorization: 'Bearer t' } });
      const j = await r.json(); console.log(r.ok, r.status, r.headers.get('X-Test'), j.method, j.auth);`);
    expect(out).toBe('true 200 yes GET Bearer t');
  });
  it('POST sends the body; a 404 is not ok; a redirect is followed', async () => {
    const out = await run(`const p = await (await fetch('${base}/x', { method: 'POST', body: JSON.stringify({ a: 1 }) })).json();
      const m = await fetch('${base}/missing'); const h = await fetch('${base}/hop');
      console.log(p.method, p.body, m.ok, m.status, h.status, h.redirected);`);
    expect(out).toBe('POST {"a":1} false 404 200 true');
  });
  it('AbortSignal.timeout aborts a slow request with a TimeoutError', async () => {
    const out = await run(`await fetch('${base}/slow', { signal: AbortSignal.timeout(200) });`);
    expect(out).toBe('ERR TimeoutError The operation was aborted due to timeout');
  });
  it('leaves a native fetch alone', () => {
    const r = spawnSync(process.execPath, ['-e', `const f = fetch; require(${JSON.stringify(SHIM)}); console.log(fetch === f, typeof AbortSignal.timeout);`]);
    expect(String(r.stdout).trim()).toBe('true function');
  });
});

describe('the build workflow', () => {
  const wf = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'build-mimic-win7.yml'), 'utf8');
  it('pins Electron 22 for this job and checks it before publishing', () => {
    expect(wf).toMatch(/\.devDependencies\.electron="22\.3\.27"/);
    expect(wf).toMatch(/case "\$ev" in 22\.\*\)/);
  });
  it('publishes win7.yml to the rolling mimic-win7 release, not a semver tag', () => {
    expect(wf).toMatch(/tag_name:\s+mimic-win7/);
    expect(wf).toMatch(/apps\/mimic\/dist\/win7\.yml/);
  });
  it('the normal build keeps Electron 31', () => {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'package.json'), 'utf8'));
    expect(pkg.devDependencies.electron).toMatch(/^\^?31\./);
  });
});
