// test/guild-triggers-route.test.js — the guild trigger list is off the /api/state poll (the guild lead, 2026-10-20).
//
// The agent's /api/state carried every enabled guild trigger: 487 rows were ~675 KB of a ~0.8 MB body, re-read
// by every overlay about ten times a second, and the dashboard's Guild triggers card was the only reader. The
// list now lives at GET /api/guild-triggers?rev=<rev>; /api/state keeps the count and `guildTriggersRev`, and
// the dashboard asks only while the Triggers tab is on screen and only when that revision moved.
//
// The agent runs for real (the real endpoints, the real serializer); the dashboard's fetch runs as a slice.
// Names are invented. Run: npx vitest run test/guild-triggers-route.test.js

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, evalBlock, ROOT, AGENT_INDEX } from './_source-slice.js';

const agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js');
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const agentSrc = readSource(AGENT_INDEX);

// A row the way the agent holds it after _applyGuildTriggersResponse: the bot's `select *` columns (a good
// third of them null or empty) plus the compiled internals the serializer has to leave behind.
function row(i, extra = {}) {
  return {
    id: '5b1c0a7e-' + String(i).padStart(4, '0') + '-4c1d-9a55-2f7d3e8b6a10', guild_id: 'wolfpack',
    name: 'Callout ' + i + ' — Aldenmar', category: i % 5 === 0 ? 'mechanic' : 'callout',
    pattern: '^\\[.+?\\]\\s+Brackwyn begins to cast a spell\\. <Wave of Corvale ' + i + '>',
    pattern_flags: 'i', use_regex: true, enabled: true, default_enabled: true, default_scope: 'broadcast',
    cooldown_seconds: 8, timer_duration_sec: i % 3 === 0 ? 90 : null, warning_seconds: null, warning_text: null,
    timer_loop: false, timer_loop_max: null, end_early_pattern: null, end_text: null, bar_color: null,
    zeal_condition: null, exclude_patterns: [], characters: [], applies_to_classes: [], timer_warnings: [],
    tags: i % 7 === 0 ? ['potime'] : [], catalog_match: null, voice_pack: null,
    notes: i % 4 === 0 ? 'Rethlan asked for this one after the Nyssara wipe; fires on the cast, not the land.' : null,
    created_by: '123456789012345678', created_at: '2026-08-02T21:10:01.000Z', updated_at: '2026-10-01T02:11:45.000Z',
    actions: [{ type: 'text_overlay', text: 'WAVE ' + i, color: 'red', duration_ms: 5000, tts: 'wave ' + i, sound: null, sound_volume: null, sound_mode: null }],
    _regex: /Brackwyn begins to cast/i, _conditions: [], _aliases: [], _excludes: [], _endRegex: null,
    _scope: 'guild', _ruleKey: 'guild:5b1c0a7e-' + i,
    ...extra,
  };
}
const rows = (n) => Array.from({ length: n }, (_, i) => row(i + 1));

describe('/api/state no longer carries the guild trigger list; /api/guild-triggers does', () => {
  let server, port;
  const getRaw = (p) => new Promise((res, rej) => http.get({ host: '127.0.0.1', port, path: p }, r => {
    let d = ''; r.on('data', c => { d += c; }); r.on('end', () => res({ status: r.statusCode, text: d, headers: r.headers }));
  }).on('error', rej));
  const get = async (p) => { const r = await getRaw(p); return { status: r.status, body: JSON.parse(r.text) }; };
  // /api/state is cached for 400 ms; wait past it so the next read re-serialises.
  const pastStateCache = () => new Promise(r => setTimeout(r, 450));

  beforeAll(async () => {
    const orig = http.createServer;
    http.createServer = function (...a) { server = orig.apply(this, a); return server; };
    try { agent.startWebDashboard(0); } finally { http.createServer = orig; }
    await new Promise(r => server.once('listening', r));
    port = server.address().port;
  });
  afterAll(() => new Promise(r => server.close(r)));

  it('the state keeps the count and a revision, and the 500-row list is gone from it', async () => {
    agent._setGuildTriggersForTest(rows(500));
    await pastStateCache();
    const { status, body } = await get('/api/state');
    expect(status).toBe(200);
    expect(body._serializeError, 'the state really serialised — not the last-good stub').toBeUndefined();
    expect(body.guildTriggerCount).toBe(500);
    expect(body.guildTriggersRev).toMatch(/^500\.[0-9a-f]{10}$/);
    expect('guildTriggers' in body).toBe(false);
  });

  it('the state body is a fraction of what it was with 500 rows on it', async () => {
    agent._setGuildTriggersForTest([]);
    await pastStateCache();
    const slim = (await getRaw('/api/state')).text.length;
    agent._setGuildTriggersForTest(rows(500));
    await pastStateCache();
    const withList = (await getRaw('/api/state')).text.length;
    const list = (await getRaw('/api/guild-triggers')).text.length;
    // the list is not in the state: 500 rows add a revision string, not hundreds of KB
    expect(withList - slim).toBeLessThan(100);
    // and the route is where the bytes went
    expect(list).toBeGreaterThan(100_000);
  });

  it('the revision does not move between polls, only when the list changes', async () => {
    agent._setGuildTriggersForTest(rows(40));
    await pastStateCache();
    const a = (await get('/api/state')).body.guildTriggersRev;
    await pastStateCache();
    const b = (await get('/api/state')).body.guildTriggersRev;
    expect(b).toBe(a);
    // a recompile that changed nothing (an older bot sends no version, so the agent recompiles every poll)
    agent._setGuildTriggersForTest(rows(40));
    await pastStateCache();
    expect((await get('/api/state')).body.guildTriggersRev).toBe(a);
    // an edit to one trigger
    const edited = rows(40); edited[7].pattern = 'something else entirely';
    agent._setGuildTriggersForTest(edited);
    await pastStateCache();
    expect((await get('/api/state')).body.guildTriggersRev).not.toBe(a);
  });

  it('/api/guild-triggers answers {rev, unchanged} to the revision held, else the rows', async () => {
    agent._setGuildTriggersForTest(rows(12));
    const first = await getRaw('/api/guild-triggers');
    expect(first.status).toBe(200);
    expect(first.headers['cache-control']).toBe('no-store');
    const full = JSON.parse(first.text);
    expect(full.unchanged).toBeUndefined();
    expect(full.triggers).toHaveLength(12);
    expect(typeof full.rev).toBe('string');

    const same = (await get('/api/guild-triggers?rev=' + encodeURIComponent(full.rev))).body;
    expect(same).toEqual({ rev: full.rev, unchanged: true });

    agent._setGuildTriggersForTest(rows(13));
    const next = (await get('/api/guild-triggers?rev=' + encodeURIComponent(full.rev))).body;
    expect(next.rev).not.toBe(full.rev);
    expect(next.triggers).toHaveLength(13);
    // a revision the route never issued is just a miss
    expect((await get('/api/guild-triggers?rev=nope')).body.triggers).toHaveLength(13);
  });

  it('the state and the route agree on the revision', async () => {
    agent._setGuildTriggersForTest(rows(9));
    await pastStateCache();
    const st = (await get('/api/state')).body.guildTriggersRev;
    expect((await get('/api/guild-triggers')).body.rev).toBe(st);
  });

  it('a row keeps what the card reads and drops the compiled internals and the empty columns', async () => {
    agent._setGuildTriggersForTest([row(7)]);   // tags: ['potime'] — a zone trigger
    const r = (await get('/api/guild-triggers')).body.triggers[0];
    for (const k of Object.keys(r)) expect(k.charAt(0), 'no underscore internals: ' + k).not.toBe('_');
    for (const k of Object.keys(r)) {
      const v = r[k];
      expect(v == null || v === '' || (Array.isArray(v) && v.length === 0), 'no empty column: ' + k).toBe(false);
    }
    // what the card and its settings panel read, all still there
    expect(r).toMatchObject({ name: 'Callout 7 — Aldenmar', category: 'callout', cooldown_seconds: 8, default_scope: 'broadcast',
      tags: ['potime'], rule_group: 'zone:potime', rule_group_label: 'Plane of Time' });
    expect(r.actions[0]).toMatchObject({ type: 'text_overlay', text: 'WAVE 7', tts: 'wave 7' });
    expect(r.pattern).toContain('Wave of Corvale 7');
    expect(r.id).toBeTruthy();
  });

  it('no list at all is an empty answer, not an error', async () => {
    agent._setGuildTriggersForTest([]);
    const e = (await get('/api/guild-triggers')).body;
    expect(e.triggers).toEqual([]);
    expect(e.rev).toMatch(/^0\./);
  });
});

describe('nothing but the card reads the list off the state', () => {
  it('no source in the agent package, Mimic or the overlays reads `guildTriggers` off a state object', () => {
    const dir = (p) => fs.readdirSync(p).filter(f => f.endsWith('.html')).map(f => path.join(p, f));
    const files = [...dir(path.join(ROOT, 'apps', 'mimic')), ...dir(path.join(ROOT, 'packages', 'wolfpack-logsync')),
      path.join(ROOT, 'apps', 'mimic', 'main.js'), path.join(ROOT, 'apps', 'mimic', 'preload.js')];
    for (const f of files) expect(/\.guildTriggers\b/.test(stripJs(readSource(f))), f).toBe(false);
  });
});

describe('the dashboard fetches the list only while the card is on screen, and only when the revision moved', () => {
  function build() {
    return evalBlock([
      'var calls = []; var answer = null; var painted = 0; var down = false;',
      'function fetch(u) { calls.push(u); return down ? Promise.reject(new Error("offline")) : Promise.resolve({ json: function () { return Promise.resolve(answer(u)); } }); }',
      'function renderGuildTriggersCard() { painted++; }',
      'var window = { __wpLastState: {} };',
      sliceBlock(dash, 'var _wpGt = {', ';\n'),
      sliceBlock(dash, 'function wpGuildTriggersSync(s, el) {', '\n}\n'),
      'function setAnswer(f) { answer = f; }  function setDown(v) { down = v; }',
      'function info() { return { calls: calls, painted: painted }; }',
    ].join('\n'), ['wpGuildTriggersSync', '_wpGt', 'setAnswer', 'setDown', 'info']);
  }
  const shown = { getClientRects: () => [{}] };
  const hidden = { getClientRects: () => [] };
  const flush = () => new Promise(r => setTimeout(r, 0));
  const T = (n) => Array.from({ length: n }, (_, i) => ({ id: 'g' + i, name: 'T' + i }));

  it('a hidden Triggers tab asks for nothing, however often the revision moves', async () => {
    const h = build();
    h.setAnswer(() => ({ rev: 'r1', triggers: T(3) }));
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, hidden);
    h.wpGuildTriggersSync({ guildTriggersRev: 'r2' }, hidden);
    h.wpGuildTriggersSync({ guildTriggersRev: 'r2' }, null);
    await flush();
    expect(h.info().calls).toEqual([]);
    expect(h._wpGt.rows).toBe(null);
  });

  it('the first open fetches once (no revision held yet), holds the rows and repaints', async () => {
    const h = build();
    h.setAnswer(() => ({ rev: 'r1', triggers: T(3) }));
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);   // the next poll lands while the ask is out
    await flush();
    expect(h.info().calls).toEqual(['/api/guild-triggers']);
    expect(h._wpGt.rows).toHaveLength(3);
    expect(h._wpGt.rev).toBe('r1');
    expect(h.info().painted).toBe(1);
  });

  it('an unchanged revision is never asked about again; a moved one is, naming the revision held', async () => {
    const h = build();
    h.setAnswer(() => ({ rev: 'r1', triggers: T(3) }));
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);
    await flush();
    for (let i = 0; i < 5; i++) h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);   // five more polls
    await flush();
    expect(h.info().calls).toHaveLength(1);

    h.setAnswer(() => ({ rev: 'r2', triggers: T(4) }));
    h.wpGuildTriggersSync({ guildTriggersRev: 'r2' }, shown);
    await flush();
    expect(h.info().calls[1]).toBe('/api/guild-triggers?rev=r1');
    expect(h._wpGt.rows).toHaveLength(4);
    expect(h._wpGt.rev).toBe('r2');
  });

  it('{unchanged} keeps the rows held; a revision that moved while the tab was hidden is fetched on the next open', async () => {
    const h = build();
    h.setAnswer(() => ({ rev: 'r1', triggers: T(3) }));
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);
    await flush();
    h.wpGuildTriggersSync({ guildTriggersRev: 'r2' }, hidden);       // moved, but nobody is looking
    await flush();
    expect(h.info().calls).toHaveLength(1);
    h.setAnswer((u) => (u.indexOf('rev=r1') >= 0 ? { rev: 'r1', unchanged: true } : { rev: 'r1', triggers: [] }));
    h.wpGuildTriggersSync({ guildTriggersRev: 'r2' }, shown);        // the tab opens
    await flush();
    expect(h.info().calls).toHaveLength(2);
    expect(h._wpGt.rows).toHaveLength(3);                            // unchanged: the rows stay
    h.wpGuildTriggersSync({ guildTriggersRev: 'r2' }, shown);        // and it is not asked a third time
    await flush();
    expect(h.info().calls).toHaveLength(2);
  });

  it('an older agent (no revision on the state) and a failed ask are handled: nothing, then a retry', async () => {
    const h = build();
    h.setAnswer(() => ({ rev: 'r1', triggers: T(2) }));
    h.wpGuildTriggersSync({}, shown);
    h.wpGuildTriggersSync(null, shown);
    await flush();
    expect(h.info().calls).toEqual([]);
    h.setDown(true);
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);
    await flush();
    expect(h._wpGt.rows).toBe(null);
    h.setDown(false);
    h.wpGuildTriggersSync({ guildTriggersRev: 'r1' }, shown);        // the next poll retries
    await flush();
    expect(h.info().calls).toHaveLength(2);
    expect(h._wpGt.rows).toHaveLength(2);
  });

  it('the sync is called from the card render (so it runs on the poll) and the agent serves the route', () => {
    const code = stripJs(dash);
    expect(sliceBlock(code, 'function renderGuildTriggersCard(s) {', '\n}\n')).toMatch(/wpGuildTriggersSync\(s, el\)/);
    expect(stripJs(agentSrc)).toMatch(/req\.url === '\/api\/guild-triggers'/);
  });
});
