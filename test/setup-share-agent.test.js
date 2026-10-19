// test/setup-share-agent.test.js — Share a whole setup, the AGENT half (the guild lead, 2026-10-19, DECISIONS §383:
// "file + share code"). Mimic collects and applies a bundle's personal triggers and "What you hear" rules through three
// local routes; the REAL agent is driven (require), as in test/personal-trigger-sync-agent.test.js. Files go to a temp dir:
// the two save functions write beside logsync.stats.json, so the test redirects those writes (and nothing else).
//
// Run: npx vitest run test/setup-share-agent.test.js
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { readSource, stripJs, AGENT_INDEX } from './_source-slice.js';

let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

const AGENT_DIR = path.dirname(AGENT_INDEX);
let tmp;
const realWrite = fs.writeFileSync, realRename = fs.renameSync;
const inTmp = (p) => (typeof p === 'string' && path.dirname(p) === AGENT_DIR && /^(personal_triggers|trigger_rules)\.json/.test(path.basename(p)))
  ? path.join(tmp, path.basename(p)) : p;

const row = (id, name, over = {}) => ({
  id, name, pattern: 'pat ' + name, pattern_flags: 'i', use_regex: true, enabled: true,
  actions: [{ type: 'text_overlay', text: name, color: 'red', duration_ms: 4000 }], ...over,
});
const compile = (r) => agent._compilePersonalTrigger({ cooldown_seconds: 0, timer_duration_sec: 0, end_use_regex: true, zeal_condition: null, end_early_pattern: null, ...r });
const setLocal = (rows) => agent._setPersonalTriggersForTest(rows.map(compile));
const names = () => agent._getPersonalTriggersForTest().map(t => t.name);
const clearRules = () => { for (const k of Object.keys(agent._triggerRules)) delete agent._triggerRules[k]; };
const setRules = (o) => { clearRules(); Object.assign(agent._triggerRules, o); };
const readJson = (f) => JSON.parse(fs.readFileSync(path.join(tmp, f), 'utf8'));
const baks = () => fs.readdirSync(tmp).filter(f => f.includes('.bak-')).sort();

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wp-setupshare-'));
  vi.spyOn(fs, 'writeFileSync').mockImplementation((p, ...a) => (/logsync\.queue\.json/.test(String(p)) ? undefined : realWrite.call(fs, inTmp(p), ...a)));
  vi.spyOn(fs, 'renameSync').mockImplementation((a, b) => (/logsync\.queue\.json/.test(String(a)) ? undefined : realRename.call(fs, inTmp(a), inTmp(b))));
  agent._setPersonalTriggersForTest([]);
  agent._setWatchedLogsForTest([]);
  clearRules();
});
afterEach(() => { vi.restoreAllMocks(); fs.rmSync(tmp, { recursive: true, force: true }); });

describe('export: what Mimic reads', () => {
  it('the personal triggers as plain rows (no compiled bits), the rules, and the characters this PC watches', () => {
    setLocal([row('p_1', 'One', { characters: ['aldenmar'] }), row('p_2', 'Two')]);
    setRules({ 'personal:p_1': { '*': 'off', aldenmar: 'overlay' } });
    agent._setWatchedLogsForTest([{ character: 'Aldenmar' }, { character: 'Brackwyn' }]);
    const out = agent._setupShareExport();
    expect(out.ok).toBe(true);
    expect(out.triggers.map(t => t.name)).toEqual(['One', 'Two']);
    expect(out.triggers[0].characters).toEqual(['aldenmar']);
    expect(out.triggers.every(t => Object.keys(t).every(k => !k.startsWith('_')))).toBe(true);
    expect(JSON.stringify(out.triggers)).not.toContain('"_regex"');
    expect(out.rules).toEqual({ 'personal:p_1': { '*': 'off', aldenmar: 'overlay' } });
    expect(out.chars).toEqual(['Aldenmar', 'Brackwyn']);
  });

  it('is a copy: changing the answer changes nothing in the agent', () => {
    setLocal([row('p_1', 'One')]);
    setRules({ 'guild:1': { '*': 'off' } });
    const out = agent._setupShareExport();
    out.triggers[0].name = 'Changed';
    out.rules['guild:1']['*'] = 'speak';
    expect(names()).toEqual(['One']);
    expect(agent._triggerRules['guild:1']).toEqual({ '*': 'off' });
  });
});

describe('apply: a bundle\'s triggers and rules are MERGED in, safely', () => {
  it('keeps yours, adds theirs, replaces the one with the same name, and writes both files compiled', () => {
    setLocal([row('p_1', 'Mine'), row('p_2', 'Shared name', { pattern: 'old' })]);
    setRules({ 'guild:a': { '*': 'off' } });
    const r = agent._setupShareApply({ triggers: [row('x_9', 'Shared name', { pattern: 'new \\d+' }), row('x_10', 'Theirs')],
      rules: { 'guild:a': { dunmore: 'overlay' }, 'builtin:blind': { '*': 'off' } } }, tmp);
    expect(r).toMatchObject({ ok: true, added: 1, updated: 1, kept: 1 });
    expect(names()).toEqual(['Mine', 'Shared name', 'Theirs']);
    expect(agent._getPersonalTriggersForTest()[1].pattern).toBe('new \\d+');
    expect(agent._triggerRules).toEqual({ 'guild:a': { '*': 'off', dunmore: 'overlay' }, 'builtin:blind': { '*': 'off' } });
    expect(readJson('personal_triggers.json').triggers.map(t => t.name)).toEqual(['Mine', 'Shared name', 'Theirs']);
    expect(readJson('trigger_rules.json').rules['builtin:blind']).toEqual({ '*': 'off' });
  });

  it('backs both files up first and reports their names (the import\'s Undo needs them)', () => {
    setLocal([row('p_1', 'Mine')]);
    agent._setupShareApply({ triggers: [], rules: { 'guild:a': { '*': 'off' } } }, tmp);   // writes both files
    expect(baks()).toEqual([]);                                                           // nothing existed yet: nothing to copy
    const r = agent._setupShareApply({ triggers: [row('x', 'New')], rules: {} }, tmp);
    expect(r.backups).toHaveLength(2);
    expect(r.backups.every(n => /^(?:personal_triggers|trigger_rules)\.json\.bak-/.test(n))).toBe(true);
    expect(baks()).toEqual([...r.backups].sort());
  });

  it('a Discord post arrives switched off, and a sound that is a file on the sender\'s PC is dropped', () => {
    const r = agent._setupShareApply({ triggers: [row('x', 'Boss up', { actions: [
      { type: 'text_overlay', text: 'up' }, { type: 'discord', message: 'boss is up' },
      { type: 'tts', text: 'up', sound: 'custom:theirs.wav', sound_volume: 0.4, sound_mode: 'replace' }, { type: 'tts', text: 'bell', sound: 'bell' }], sound: 'CUSTOM:top.wav' })], rules: {} }, tmp);
    expect(r).toMatchObject({ ok: true, added: 1, discord_off: 1 });
    const t = agent._getPersonalTriggersForTest()[0];
    expect(t.actions.find(a => a.type === 'discord').enabled).toBe(false);
    expect(JSON.stringify(t)).not.toMatch(/custom:/i);
    expect(t.actions[3].sound).toBe('bell');
    expect(t).not.toHaveProperty('sound');
  });

  it('a malformed rule key, a bad mode and a prototype key are dropped, not stored', () => {
    const rules = JSON.parse('{"nonsense":{"*":"off"},"guild:ok":{"*":"loud"},"__proto__":{"*":"off"},"guild:fine":{"*":"off","c1":"banana"}}');
    agent._setupShareApply({ triggers: [], rules }, tmp);
    expect(agent._triggerRules).toEqual({ 'guild:fine': { '*': 'off' } });
    expect(({}).polluted).toBeUndefined();
  });

  it('refuses too many triggers, and a body that is not an object, touching nothing', () => {
    setLocal([row('p_1', 'Mine')]);
    expect(agent._setupShareApply({ triggers: Array.from({ length: 1001 }, (_, i) => row('t' + i, 'n' + i)), rules: {} }, tmp)).toEqual({ ok: false, error: 'too many triggers' });
    expect(agent._setupShareApply(null, tmp).ok).toBe(false);
    expect(agent._setupShareApply([], tmp).ok).toBe(false);
    expect(names()).toEqual(['Mine']);
    expect(fs.readdirSync(tmp)).toEqual([]);
  });

  it('a backup that cannot be made stops the apply before anything changes', () => {
    setLocal([row('p_1', 'Mine')]);
    realWrite.call(fs, path.join(tmp, 'personal_triggers.json'), '{"triggers":[]}');
    vi.spyOn(fs, 'copyFileSync').mockImplementation(() => { throw new Error('disk full'); });
    const r = agent._setupShareApply({ triggers: [row('x', 'New')], rules: {} }, tmp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/back up/);
    expect(names()).toEqual(['Mine']);
  });
});

describe('restore: the import\'s Undo', () => {
  it('puts both files back as they were before the apply', () => {
    setLocal([row('p_1', 'Mine')]);
    setRules({ 'guild:a': { '*': 'off' } });
    agent._setupShareApply({ triggers: [], rules: {} }, tmp);                      // writes both files
    const applied = agent._setupShareApply({ triggers: [row('x', 'Theirs')], rules: { 'guild:a': { '*': 'speak' }, 'builtin:blind': { '*': 'off' } } }, tmp);
    expect(names()).toEqual(['Mine', 'Theirs']);
    const r = agent._setupShareRestore({ backups: applied.backups }, tmp);
    expect(r).toMatchObject({ ok: true, triggers: 1 });
    expect(names()).toEqual(['Mine']);
    expect(agent._triggerRules).toEqual({ 'guild:a': { '*': 'off' } });
    expect(readJson('personal_triggers.json').triggers.map(t => t.name)).toEqual(['Mine']);
    expect(readJson('trigger_rules.json').rules).toEqual({ 'guild:a': { '*': 'off' } });
  });

  it('a file that did not exist before the apply goes back to empty', () => {
    const applied = agent._setupShareApply({ triggers: [row('x', 'Theirs')], rules: { 'builtin:blind': { '*': 'off' } } }, tmp);
    expect(applied.backups).toEqual([]);
    expect(names()).toEqual(['Theirs']);
    expect(agent._setupShareRestore({ backups: [] }, tmp).ok).toBe(true);
    expect(names()).toEqual([]);
    expect(agent._triggerRules).toEqual({});
  });

  it('takes a fresh backup before it restores, so the Undo itself can be undone by hand', () => {
    setLocal([row('p_1', 'Mine')]);
    agent._setupShareApply({ triggers: [], rules: {} }, tmp);
    const applied = agent._setupShareApply({ triggers: [row('x', 'Theirs')], rules: {} }, tmp);
    const before = baks().length;
    agent._setupShareRestore({ backups: applied.backups }, tmp);
    expect(baks().length).toBeGreaterThanOrEqual(before);
    expect(baks().some(f => fs.readFileSync(path.join(tmp, f), 'utf8').includes('Theirs'))).toBe(true);
  });

  it('refuses anything that is not a backup this agent made: a path, a traversal, another file, too many', () => {
    setLocal([row('p_1', 'Mine')]);
    for (const bad of [['../personal_triggers.json'], ['personal_triggers.json'], ['personal_triggers.json.bak-'], ['/etc/passwd'], ['logsync.stats.json.bak-2026-10-19T12-00-00-000Z'],
      ['personal_triggers.json.bak-2026-10-19T12-00-00-000Z/../x'], [5], 'x', null]) {
      expect(agent._setupShareRestore({ backups: bad }, tmp), JSON.stringify(bad)).toEqual({ ok: false, error: 'bad backup name' });
    }
    const three = ['personal_triggers.json.bak-2026-10-19T12-00-00-000Z', 'trigger_rules.json.bak-2026-10-19T12-00-00-000Z', 'trigger_rules.json.bak-2026-10-19T12-00-01-000Z'];
    expect(agent._setupShareRestore({ backups: three }, tmp).ok).toBe(false);
    expect(agent._setupShareRestore(null, tmp).ok).toBe(false);
    expect(names()).toEqual(['Mine']);
  });

  it('a backup that is gone is an error and changes nothing', () => {
    setLocal([row('p_1', 'Mine')]);
    const r = agent._setupShareRestore({ backups: ['personal_triggers.json.bak-2026-10-19T12-00-00-000Z'] }, tmp);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/could not read/);
    expect(names()).toEqual(['Mine']);
  });
});

describe('over HTTP: three local routes, writes only from our own pages', () => {
  let server, port;
  beforeEach(async () => {
    const orig = http.createServer;
    http.createServer = function (...a) { server = orig.apply(this, a); return server; };
    try { agent.startWebDashboard(0); } finally { http.createServer = orig; }
    await new Promise(r => server.once('listening', r));
    port = server.address().port;
    // The apply backs up the agent's REAL files if they exist; on a developer machine they might. Say they do not.
    const realExists = fs.existsSync;
    vi.spyOn(fs, 'existsSync').mockImplementation((p) => (path.dirname(String(p)) === AGENT_DIR && /(?:personal_triggers|trigger_rules)\.json$/.test(String(p))) ? false : realExists.call(fs, p));
  });
  afterEach(async () => { await new Promise(r => server.close(r)); });
  const call = (method, p, headers = {}, body = '{}') => new Promise((res, rej) => {
    const req = http.request({ host: '127.0.0.1', port, path: p, method, headers: { 'Content-Type': 'application/json', ...headers } }, r => {
      let d = ''; r.on('data', c => { d += c; }); r.on('end', () => { let b = null; try { b = d ? JSON.parse(d) : null; } catch { b = d; } res({ status: r.statusCode, body: b }); });
    });
    req.on('error', rej); req.end(method === 'POST' ? body : undefined);
  });

  it('GET reads, POST applies, POST /restore undoes', async () => {
    setLocal([row('p_1', 'Mine')]);
    const got = await call('GET', '/api/setup-share/triggers');
    expect(got.status).toBe(200);
    expect(got.body.triggers.map(t => t.name)).toEqual(['Mine']);
    const posted = await call('POST', '/api/setup-share/triggers', {}, JSON.stringify({ triggers: [row('x', 'Theirs')], rules: {} }));
    expect(posted.status).toBe(200);
    expect(posted.body).toMatchObject({ ok: true, added: 1 });
    expect(names()).toEqual(['Mine', 'Theirs']);
    expect(posted.body.backups).toEqual([]);                    // no file existed to copy, so Undo empties them
    const undone = await call('POST', '/api/setup-share/triggers/restore', {}, JSON.stringify({ backups: posted.body.backups }));
    expect(undone.status).toBe(200);
    expect(names()).toEqual([]);
  });

  it('a web page that is not one of ours may not write', async () => {
    setLocal([row('p_1', 'Mine')]);
    expect((await call('POST', '/api/setup-share/triggers', { Origin: 'https://evil.example' }, JSON.stringify({ triggers: [row('x', 'Evil')], rules: {} }))).status).toBe(403);
    expect((await call('POST', '/api/setup-share/triggers/restore', { Origin: 'https://evil.example' }, JSON.stringify({ backups: [] }))).status).toBe(403);
    expect(names()).toEqual(['Mine']);
  });

  it('bad bodies are a 400, an unknown sub-route a 404, a PUT a 405', async () => {
    expect((await call('POST', '/api/setup-share/triggers', {}, 'not json')).status).toBe(400);
    expect((await call('POST', '/api/setup-share/triggers', {}, JSON.stringify({ triggers: 'x' }))).status).toBe(200);   // not a list = nothing to merge
    expect((await call('POST', '/api/setup-share/triggers/restore', {}, JSON.stringify({ backups: ['../x'] }))).status).toBe(400);
    expect((await call('GET', '/api/setup-share/triggers/other')).status).toBe(404);
    expect((await call('PUT', '/api/setup-share/triggers')).status).toBe(405);
  });
});

describe('wiring', () => {
  const src = stripJs(readSource(AGENT_INDEX));
  it('the router sends the three routes to the handler', () => {
    expect(src).toContain("/^\\/api\\/setup-share\\/triggers(?:\\/restore)?(?:\\?|$)/.test(req.url)) return _handleSetupShareTriggers(req, res)");
  });
  it('is local only: no network call anywhere in the section', () => {
    const a = src.indexOf('function _setupShareExport'), b = src.indexOf('async function _handleSetupShareTriggers') + 1400;
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a + 1400);
    const section = src.slice(a, b);
    expect(section).not.toMatch(/\bfetch\(|https?\.request|_tsCall|_uploadOpts/);
  });
});
