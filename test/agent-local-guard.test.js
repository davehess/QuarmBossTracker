// test/agent-local-guard.test.js — the agent's local port refuses web pages, DNS rebinding and a spoofed "null" origin.
//
// The guild lead, 2026-10-17: any web page a member visits while Mimic runs can POST "simple" requests
// (text/plain, no-cors) to http://127.0.0.1:<port>/api/... — /api/dkp/tick, /api/mimic-session (replaces the
// login token), /api/shutdown, /api/update, /api/backups/restore and ~60 more had no Host, Origin or token
// check. One guard now sits at the top of the router; Mimic hands the agent a per-launch secret that its own
// file:// pages (Origin: "null", which a sandboxed iframe on any site can also send) must present.
//
// The pure rule is exercised by running the real source block; the wiring (router order, Mimic env + header)
// is asserted on comment-stripped text, per CLAUDE.md "comments satisfy text assertions".
//
// Run: npx vitest run test/agent-local-guard.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(
  src,
  'const _LOCAL_SECRET =',
  'function _localOriginOk(req) { return _localRequestGuard(req, _LOCAL_SECRET) === null; }',
);
function load(envSecret) {
  const prev = process.env.WOLFPACK_LOCAL_SECRET;
  if (envSecret === undefined) delete process.env.WOLFPACK_LOCAL_SECRET; else process.env.WOLFPACK_LOCAL_SECRET = envSecret;
  try { return evalBlock(block, ['_localRequestGuard', '_localOriginOk', '_LOCAL_SECRET']); }
  finally { if (prev === undefined) delete process.env.WOLFPACK_LOCAL_SECRET; else process.env.WOLFPACK_LOCAL_SECRET = prev; }
}
const { _localRequestGuard: guard } = load(undefined);
const req = (headers) => ({ headers });
const SECRET = 'a'.repeat(64);

describe('_localRequestGuard — Host', () => {
  it('rejects a foreign Host (DNS rebinding)', () => {
    expect(guard(req({ host: 'evil.example' }), '')).toBe('host');
    expect(guard(req({ host: 'evil.example:7777' }), '')).toBe('host');
    expect(guard(req({ host: '127.0.0.1.evil.example:7777' }), '')).toBe('host');
    expect(guard(req({ host: 'localhost.evil.example' }), '')).toBe('host');
    expect(guard(req({ host: '192.168.1.5:7777' }), '')).toBe('host');
  });
  it('accepts loopback Hosts, any port, any case', () => {
    expect(guard(req({ host: '127.0.0.1:7777' }), '')).toBeNull();
    expect(guard(req({ host: 'localhost:7779' }), '')).toBeNull();
    expect(guard(req({ host: 'LOCALHOST:7779' }), '')).toBeNull();
    expect(guard(req({ host: '[::1]:7777' }), '')).toBeNull();
    expect(guard(req({ host: '127.0.0.1' }), '')).toBeNull();
  });
  it('accepts a missing Host', () => {
    expect(guard(req({}), '')).toBeNull();
  });
  it('checks Host before Origin', () => {
    expect(guard(req({ host: 'evil.example', origin: 'http://127.0.0.1:7777' }), '')).toBe('host');
  });
});

describe('_localRequestGuard — Origin', () => {
  it('rejects a cross-site Origin', () => {
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'https://evil.example' }), '')).toBe('origin');
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'http://localhost.evil.example' }), '')).toBe('origin');
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1.evil.example:7777' }), '')).toBe('origin');
  });
  it('rejects an unparseable Origin', () => {
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'not a url' }), '')).toBe('origin');
  });
  it('accepts a loopback Origin', () => {
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'http://127.0.0.1:7777' }), SECRET)).toBeNull();
    expect(guard(req({ host: 'localhost:7777', origin: 'http://localhost:7777' }), SECRET)).toBeNull();
    expect(guard(req({ host: '[::1]:7777', origin: 'http://[::1]:7777' }), SECRET)).toBeNull();
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'https://localhost:3000' }), SECRET)).toBeNull();
  });
  it('accepts a file:// Origin', () => {
    expect(guard(req({ host: '127.0.0.1:7777', origin: 'file://' }), SECRET)).toBeNull();
  });
  it('accepts no Origin (Mimic main, zealPipe, the takeover call, curl)', () => {
    expect(guard(req({ host: '127.0.0.1:7777' }), SECRET)).toBeNull();
    expect(guard(req({ host: '127.0.0.1:7777' }), '')).toBeNull();
  });
});

describe('_localRequestGuard — Origin: null', () => {
  const h = (extra) => req({ host: '127.0.0.1:7777', origin: 'null', ...extra });
  it('with a secret configured and no header: rejected', () => {
    expect(guard(h({}), SECRET)).toBe('null-origin');
  });
  it('with a secret configured and the wrong header: rejected', () => {
    expect(guard(h({ 'x-wolfpack-local': 'b'.repeat(64) }), SECRET)).toBe('null-origin');
    expect(guard(h({ 'x-wolfpack-local': SECRET.slice(0, 63) }), SECRET)).toBe('null-origin');
    expect(guard(h({ 'x-wolfpack-local': SECRET + 'a' }), SECRET)).toBe('null-origin');
    expect(guard(h({ 'x-wolfpack-local': '' }), SECRET)).toBe('null-origin');
  });
  it('with a secret configured and the right header: ok', () => {
    expect(guard(h({ 'x-wolfpack-local': SECRET }), SECRET)).toBeNull();
  });
  it('with NO secret configured: ok (older Mimic shell under a newer agent)', () => {
    expect(guard(h({}), '')).toBeNull();
    expect(guard(h({}), undefined)).toBeNull();
  });
});

describe('_localOriginOk follows the same rule, with the secret from WOLFPACK_LOCAL_SECRET', () => {
  it('no env secret: null origin ok, evil origin not', () => {
    const { _localOriginOk: ok, _LOCAL_SECRET } = load(undefined);
    expect(_LOCAL_SECRET).toBe('');
    expect(ok(req({ origin: 'null' }))).toBe(true);
    expect(ok(req({ origin: 'https://evil.example' }))).toBe(false);
    expect(ok(req({ host: 'evil.example' }))).toBe(false);
    expect(ok(req({}))).toBe(true);
  });
  it('env secret set: null origin needs the header', () => {
    const { _localOriginOk: ok, _LOCAL_SECRET } = load(SECRET);
    expect(_LOCAL_SECRET).toBe(SECRET);
    expect(ok(req({ origin: 'null' }))).toBe(false);
    expect(ok(req({ origin: 'null', 'x-wolfpack-local': SECRET }))).toBe(true);
    expect(ok(req({ origin: 'http://127.0.0.1:7777' }))).toBe(true);
  });
});

describe('wiring', () => {
  const agent = stripJs(src);
  it('the router calls the guard before its first route', () => {
    const start = agent.indexOf('function startWebDashboard(port) {');
    expect(start).toBeGreaterThan(0);
    const router = agent.slice(start, start + 4000);
    const g = router.indexOf('if (_localGuardBlock(req, res)) return;');
    const firstRoute = router.indexOf("req.url === '/'");
    expect(g).toBeGreaterThan(0);
    expect(firstRoute).toBeGreaterThan(g);
    // nothing but the try-open sits between the callback head and the guard
    expect(router.slice(0, g)).toMatch(/http\.createServer\(async \(req, res\) => \{\s*try \{\s*$/);
  });
  it('the guard answers 403 {error:forbidden} and rate-limits its log', () => {
    const blk = sliceBlock(agent, 'function _localGuardBlock(req, res) {', '\n}\n');
    expect(blk).toMatch(/_localRequestGuard\(req, _LOCAL_SECRET\)/);
    expect(blk).toMatch(/res\.writeHead\(403/);
    expect(blk).toMatch(/\{"error":"forbidden"\}/);
    expect(blk).toMatch(/> 60000/);
  });
  it('reads the secret from the environment once', () => {
    expect(agent).toMatch(/const _LOCAL_SECRET = String\(process\.env\.WOLFPACK_LOCAL_SECRET \|\| ''\);/);
  });

  const main = stripJs(fs.readFileSync(path.join(ROOT, 'apps', 'mimic', 'main.js'), 'utf8'));
  it('Mimic generates a per-launch secret and hands it to the agent in its env', () => {
    expect(main).toMatch(/const _LOCAL_SECRET = require\('crypto'\)\.randomBytes\(32\)\.toString\('hex'\);/);
    expect(main).toMatch(/WOLFPACK_LOCAL_SECRET:\s+_LOCAL_SECRET/);
    // the one spawn of the agent child passes that env
    expect((main.match(/spawn\(process\.execPath, args, \{\s*env,/g) || []).length).toBe(1);
  });
  // Any loopback port, not only the remembered agent port: a port change must never strip the header and 403 every
  // file:// overlay; a local service that could read it is already code on the PC.
  it('Mimic registers ONE onBeforeSendHeaders adding x-wolfpack-local, only on loopback http', () => {
    expect((main.match(/onBeforeSendHeaders\(/g) || []).length).toBe(1);
    const fn = sliceBlock(main, 'function _wireLocalSecretHeader() {', '\n}\n');
    expect(fn).toMatch(/headers\['x-wolfpack-local'\] = _LOCAL_SECRET;/);
    expect(fn).toMatch(/u\.hostname === '127\.0\.0\.1' \|\| u\.hostname === 'localhost'/);
    expect(fn).toMatch(/u\.protocol === 'http:'/);
  });
  it('the header is wired once the app is ready, before any window is created', () => {
    const ready = main.indexOf('app.whenReady().then(async () => {');
    const wire = main.indexOf('_wireLocalSecretHeader();', ready);
    const win = main.indexOf('createMainWindow();', ready);
    expect(wire).toBeGreaterThan(ready);
    expect(win).toBeGreaterThan(wire);
  });
  it('no window uses a partition (defaultSession covers them all)', () => {
    expect(main).not.toMatch(/partition\s*:/);
    expect(main).not.toMatch(/fromPartition/);
  });
});
