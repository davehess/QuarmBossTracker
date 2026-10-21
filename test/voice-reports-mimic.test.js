// test/voice-reports.test.js — "Voice unclear": report a callout nobody could understand, with the voice that said it
// (the guild lead, 2026-10-19: "B for voice"; the Mimic half of slice 1 — the bot route and the officer page are built
// on another branch to this contract).
//
//   POST /api/agent/voice-report  { spoken, original, engine, voice, rate, pitch, agent_version, trigger_id,
//                                   trigger_name, suggested_say?, note?, character }
//   201 {ok,id} · 400 bad body · 429 over the rate limit · 503 the table is not set up
//
// Four pieces, each driven from the SHIPPED source:
//   · triggers.html — the ring of what was actually spoken (engine + voice, the Windows fallback recorded as Windows),
//     and the 🔊 Voice unclear button under a spoken callout
//   · the agent — POST /api/voice-spoken (keeps the voice on the Recent fires entry) and POST /api/voice-report
//     (the relay: adds version + character, never a Discord id; 503 → "not switched on yet")
//   · dashboard.html — the 🔊 on a Recent fires row: what was spoken, ▶ replay, the Say line, Suggest
//
// Run: npx vitest run test/voice-reports.test.js

import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import { Readable } from 'node:stream';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const require_ = createRequire(import.meta.url);
const WPVoice = require_('../apps/mimic/voice.js');
const triggersHtml = readSource(path.join(ROOT, 'apps/mimic/triggers.html'));
const dash = readSource(path.join(ROOT, 'packages/wolfpack-logsync/dashboard.html'));
const agentSrc = readSource(path.join(ROOT, 'packages/wolfpack-logsync/index.js'));

// The contract's fields. A report carries these and nothing else.
const CONTRACT = ['spoken', 'original', 'engine', 'voice', 'rate', 'pitch', 'agent_version', 'trigger_id', 'trigger_name',
  'suggested_say', 'note', 'character'];
const READY = { piper: { ready: true, voices: ['en_US-kristin-medium'] }, kokoro: { ready: false, voices: [] } };
const FIRE = { trigger: 'Slow landed', original: '🐌 Slow landed on the boss', trigger_id: 'g-12', ts: 1760900000123 };

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('triggers.html: the ring of what was actually spoken', () => {
  const block = sliceBlock(triggersHtml, '  var _speakQ = [];', "  // A trigger's `sound` is a library NAME");

  // The real speech queue, with the browser, Mimic's bridge and the voice engine stubbed. `synth` decides whether a
  // downloaded voice produces audio: true → it plays, false → null (the Windows voice must take over).
  function harness({ status = READY, cfg = {}, synth = true, voiceName = null } = {}) {
    const posts = [], uttered = [];
    class Utt { constructor(t) { this.text = t; this.voice = null; } }
    const win = {
      WPVoice: {
        chooseEngine: WPVoice.chooseEngine, pick: WPVoice.pick,
        neuralAudio: () => Promise.resolve(synth ? { addEventListener() {}, play: () => Promise.resolve(), pause() {} } : null),
      },
      speechSynthesis: { speak: (u) => uttered.push(u), cancel() {}, getVoices: () => [{ name: 'Microsoft Zira Desktop' }] },
      mimic: {},
    };
    const ctx = { win, Utt, posts, status, cfg: voiceName ? { ...cfg, voiceName } : cfg };
    const prelude = `
      var PART = ''; var PORT = 7779;
      var window = ctx.win; var SpeechSynthesisUtterance = ctx.Utt;
      var _voiceCfg = ctx.cfg, _voicePacks = [], _voiceStatus = ctx.status;
      function reportPlayback() {}
      function fetch(url, init) { ctx.posts.push({ url: url, body: JSON.parse(init.body) }); return Promise.resolve({ ok: true }); }
    `;
    const api = new Function('ctx', [prelude, block, 'return { speak: speak, noteSpoken: _noteSpoken, spokenFor: _spokenFor, log: _spokenLog };'].join('\n'))(ctx);
    return { ...api, posts, uttered };
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const settle = () => vi.advanceTimersByTimeAsync(0);

  it('a downloaded voice that plays is recorded with ITS engine and voice', async () => {
    const h = harness();
    h.speak('Slow landed', FIRE); await settle();
    expect(h.log).toHaveLength(1);
    expect(h.log[0]).toMatchObject({
      spoken: 'Slow landed', original: FIRE.original, engine: 'piper', voice: 'en_US-kristin-medium',
      rate: 1.05, trigger_id: 'g-12', trigger_name: 'Slow landed', ts: FIRE.ts,
    });
    expect(h.uttered).toHaveLength(0);
  });

  it('a downloaded voice that falls back to the Windows voice is recorded as Windows, once', async () => {
    const h = harness({ synth: false, voiceName: 'Microsoft Zira Desktop', cfg: { rate: 1.3, pitch: 0.8 } });
    h.speak('Slow landed', FIRE); await settle();
    expect(h.uttered).toHaveLength(1);
    expect(h.log).toHaveLength(1);
    expect(h.log[0]).toMatchObject({ engine: 'windows', voice: 'Microsoft Zira Desktop', rate: 1.3, pitch: 0.8, ts: FIRE.ts });
  });

  it('the Windows voice with no named voice is recorded as the default', async () => {
    const h = harness({ status: null });
    h.speak('Slow landed', FIRE); await settle();
    expect(h.log[0]).toMatchObject({ engine: 'windows', voice: 'default', rate: 1.05, pitch: 1 });
  });

  it('keeps the last 20, newest last', () => {
    const h = harness();
    for (let i = 0; i < 25; i++) h.noteSpoken({ text: 'line ' + i, meta: { ts: 1000 + i } }, 'windows', 'v', 1, 1);
    expect(h.log).toHaveLength(20);
    expect(h.log[0].spoken).toBe('line 5');
    expect(h.log[19].spoken).toBe('line 24');
  });

  it('each entry is also handed to the agent (POST /api/voice-spoken) so the dashboard can show it', async () => {
    const h = harness();
    h.speak('Slow landed', FIRE); await settle();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].url).toBe('http://127.0.0.1:7779/api/voice-spoken');
    expect(h.posts[0].body).toEqual({ ...h.log[0] });
  });

  it('spokenFor finds the line for a fire by its timestamp, newest first; null when nothing played', () => {
    const h = harness();
    h.noteSpoken({ text: 'first', meta: { ts: 5 } }, 'windows', 'v', 1, 1);
    h.noteSpoken({ text: 'again', meta: { ts: 5 } }, 'windows', 'v', 1, 1);
    h.noteSpoken({ text: 'other', meta: { ts: 6 } }, 'windows', 'v', 1, 1);
    expect(h.spokenFor({ ts: 5 }).spoken).toBe('again');
    expect(h.spokenFor({ ts: 99 })).toBeNull();
  });

  it('fire() hands the speech queue the original text, trigger id and fire timestamp', () => {
    const s = stripJs(triggersHtml);
    expect(s).toMatch(/const speakMeta = \{[^}]*original: t\.text \|\| ''[^}]*trigger_id: t\.trigger_id \|\| null[^}]*ts: t\.ts \|\| 0/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('triggers.html: the 🔊 Voice unclear button', () => {
  const block = sliceBlock(triggersHtml, '  let _voiceFire = null;', "voiceBtn.addEventListener('click', voiceClick);\n  }");

  function harness({ spoken = { spoken: 'Slow landed', original: FIRE.original, engine: 'piper', voice: 'en_US-kristin-medium', rate: 1.05, pitch: 1,
    trigger_id: 'g-12', trigger_name: 'Slow landed', ts: 77, at: 1 }, reply = { status: 201, json: { ok: true, id: 9 } }, part = '', votesOn = true, muteFire = null } = {}) {
    const mk = (set) => ({ add: c => set.add(c), remove: c => set.delete(c), contains: c => set.has(c),
      toggle: (c, on) => { const v = on === undefined ? !set.has(c) : on; if (v) set.add(c); else set.delete(c); } });
    const fbCls = new Set(), btnCls = new Set(), listeners = {}, hover = [], posts = [];
    const btn = { textContent: '', classList: mk(btnCls), addEventListener: (ev, fn) => { listeners[ev] = fn; } };
    const ctx = { btn, fbCls, fbList: mk(fbCls), posts, hover, spoken, reply, part, votesOn, muteFire };
    const prelude = `
      const PORT = 7779; const PART = ctx.part; let _votesOn = ctx.votesOn; let _muteFire = ctx.muteFire;
      const document = { getElementById: () => ctx.btn };
      const window = { mimic: { overlayHoverInteractive: (on) => ctx.hover.push(on) } };
      const fbWrap = { classList: ctx.fbList };
      function offerMute() {} function showFeedback() {}
      function _spokenFor(f) { return f && f.ts === ctx.spoken.ts ? ctx.spoken : null; }
      function fetch(url, init) {
        ctx.posts.push({ url: url, body: JSON.parse(init.body) });
        return Promise.resolve({ ok: ctx.reply.status < 300, status: ctx.reply.status, json: () => Promise.resolve(ctx.reply.json) });
      }
    `;
    const api = new Function('ctx', [prelude, block, 'return { offerVoice, voiceClick };'].join('\n'))(ctx);
    return { ...api, btn, btnCls, fbCls, posts, hover, listeners };
  }
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  const fire = { ts: 77, text: FIRE.original, trigger: 'Slow landed', trigger_id: 'g-12', mute: false };
  const flush = () => vi.advanceTimersByTimeAsync(0);

  it('a spoken callout offers it; a click sends the contract fields and confirms "Reported"', async () => {
    const h = harness(); h.offerVoice(fire);
    expect(h.fbCls.has('canvoice')).toBe(true);
    expect(h.fbCls.has('show')).toBe(true);
    h.listeners.click(); await flush();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].url).toBe('http://127.0.0.1:7779/api/voice-report');
    expect(h.posts[0].body).toEqual({ spoken: 'Slow landed', original: FIRE.original, engine: 'piper', voice: 'en_US-kristin-medium',
      rate: 1.05, pitch: 1, trigger_id: 'g-12', trigger_name: 'Slow landed' });
    expect(h.btn.textContent).toBe('Reported');
    expect(h.btnCls.has('done')).toBe(true);
  });

  it('the payload never carries a Discord id, and only fields the contract names', async () => {
    const h = harness(); h.offerVoice(fire); h.listeners.click(); await flush();
    const body = h.posts[0].body;
    expect(JSON.stringify(body)).not.toMatch(/discord/i);
    for (const k of Object.keys(body)) expect(CONTRACT).toContain(k);
  });

  it('a second click after "Reported" sends nothing more', async () => {
    const h = harness(); h.offerVoice(fire); h.listeners.click(); await flush(); h.listeners.click(); await flush();
    expect(h.posts).toHaveLength(1);
  });

  it('503: says reports are not switched on yet, and the button stays clickable (nothing is lost, nothing is queued)', async () => {
    const h = harness({ reply: { status: 503, json: { ok: false, unavailable: true } } }); h.offerVoice(fire);
    h.listeners.click(); await flush();
    expect(h.btn.textContent).toBe('Voice reports are not switched on yet');
    expect(h.btnCls.has('done')).toBe(false);
    h.listeners.click(); await flush();
    expect(h.posts).toHaveLength(2);
  });

  it('429 and a failed request each say so', async () => {
    const a = harness({ reply: { status: 429, json: { ok: false } } }); a.offerVoice(fire); a.listeners.click(); await flush();
    expect(a.btn.textContent).toBe('Too many reports, try again soon');
    const b = harness({ reply: { status: 502, json: { ok: false } } }); b.offerVoice(fire); b.listeners.click(); await flush();
    expect(b.btn.textContent).toBe('Could not send');
  });

  it('nothing spoken for this fire: no request, and it says so', async () => {
    const h = harness({ spoken: { ts: 1 } }); h.offerVoice(fire); h.listeners.click(); await flush();
    expect(h.posts).toHaveLength(0);
    expect(h.btn.textContent).toBe('Nothing was spoken');
  });

  it('a muted, test, rehearsal or replay fire, and a canvas panel, offer nothing', () => {
    for (const f of [{ ...fire, mute: true }, { ...fire, test: true }, { ...fire, rehearsal: true }, { ...fire, replay: true }]) {
      const h = harness(); h.offerVoice(f);
      expect(h.fbCls.has('canvoice')).toBe(false);
      expect(h.fbCls.has('show')).toBe(false);
    }
    const p = harness({ part: 'callouts' }); p.offerVoice(fire);
    expect(p.fbCls.has('canvoice')).toBe(false);
  });

  it('with timing votes off the row shows this button alone', () => {
    const h = harness({ votesOn: false }); h.offerVoice(fire);
    expect(h.fbCls.has('mute-only')).toBe(true);
    expect(h.fbCls.has('show')).toBe(true);
  });

  it('asks for the hover handshake (a locked overlay is click-through)', () => {
    const h = harness();
    h.listeners.mouseenter(); h.listeners.mouseleave();
    expect(h.hover).toEqual([true, false]);
  });

  it('markup: a real <button> in the vote row, hidden until a spoken callout, and hidden while the enrage choices are open', () => {
    const s = stripJs(triggersHtml);
    expect(s).toMatch(/<button id="voiceBtn" class="voice-btn"[^>]*>🔊 Voice unclear<\/button>/);
    expect(s).toMatch(/#feedback\.canvoice \.voice-btn\s*\{\s*display:inline-block/);
    expect(s).toMatch(/#feedback\.enragemenu \.voice-btn\s*\{\s*display:none/);
    expect(s).toMatch(/if \(visual\) offerVoice\(t\)/);
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('the agent: /api/voice-spoken and /api/voice-report', () => {
  let agent;
  const realFetch = globalThis.fetch;
  beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });
  afterEach(() => { globalThis.fetch = realFetch; agent._activeOverlays.length = 0; agent._setUploadOptsForTest({}); });

  const OPTS = { botUrl: 'https://bot.example/api/agent/encounter', token: 'tok' };
  const spokenBody = { spoken: 'Slow landed', original: '🐌 Slow landed on the boss', engine: 'windows', voice: 'Microsoft Zira Desktop',
    rate: 1.05, pitch: 1, trigger_id: 'g-12', trigger_name: 'Slow landed' };
  // A request the way the router hands it over: a readable body, local host headers.
  const reqOf = (obj, headers = {}) => Object.assign(Readable.from([Buffer.from(typeof obj === 'string' ? obj : JSON.stringify(obj))]),
    { headers: { host: '127.0.0.1:7777', ...headers }, url: '/x', method: 'POST' });
  const resOf = () => { const r = { code: 0, body: null, writeHead(c) { r.code = c; }, end(b) { r.body = b ? JSON.parse(b) : null; } }; return r; };
  const call = async (fn, body, headers) => { const res = resOf(); await fn(reqOf(body, headers), res); return res; };
  function botReplies(status, json) {
    const calls = [];
    globalThis.fetch = async (url, init) => { calls.push({ url: String(url), init }); return { ok: status < 300, status, json: async () => json }; };
    return calls;
  }

  describe('the report body', () => {
    it('carries exactly the contract fields, with the agent version and the character added', () => {
      const out = agent._voiceReportBody({ ...spokenBody, suggested_say: 'Slow is on the boss', note: 'too fast' }, 'Fenrisk');
      expect(Object.keys(out).sort()).toEqual([...CONTRACT].sort());
      expect(out).toMatchObject({ spoken: 'Slow landed', engine: 'windows', voice: 'Microsoft Zira Desktop', rate: 1.05, pitch: 1,
        trigger_id: 'g-12', trigger_name: 'Slow landed', suggested_say: 'Slow is on the boss', note: 'too fast', character: 'Fenrisk' });
      expect(out.agent_version).toBe(require_('../packages/wolfpack-logsync/package.json').version);
    });
    it('suggested_say and note are left out when not given', () => {
      const out = agent._voiceReportBody(spokenBody, 'Fenrisk');
      expect('suggested_say' in out).toBe(false);
      expect('note' in out).toBe(false);
    });
    it('never includes a Discord id, whatever the caller sends', () => {
      const out = agent._voiceReportBody({ ...spokenBody, discord_id: '123456789012345678', uploaded_by_discord_id: '1', user: { discord: 'x' } }, 'Fenrisk');
      expect(JSON.stringify(out)).not.toMatch(/discord|123456789012345678/i);
      for (const k of Object.keys(out)) expect(CONTRACT).toContain(k);
    });
    it('holds the contract\'s length limits', () => {
      const long = 'x'.repeat(900);
      const out = agent._voiceReportBody({ spoken: long, original: long, engine: long, voice: long, suggested_say: long, note: long, trigger_name: long }, long);
      expect(out.spoken).toHaveLength(300); expect(out.original).toHaveLength(300); expect(out.suggested_say).toHaveLength(300);
      expect(out.engine).toHaveLength(20); expect(out.voice).toHaveLength(80); expect(out.note).toHaveLength(280); expect(out.character).toHaveLength(40);
    });
    it('nothing spoken, nothing to report', () => {
      expect(agent._voiceReportBody({ spoken: '   ' }, 'Fenrisk')).toBeNull();
      expect(agent._voiceReportBody(null, 'Fenrisk')).toBeNull();
    });
  });

  describe('POST /api/voice-report (the relay)', () => {
    beforeEach(() => agent._setUploadOptsForTest({ ...OPTS }));

    it('relays to the bot\'s /api/agent/voice-report with the token, and answers {ok,id} on a 201', async () => {
      const calls = botReplies(201, { ok: true, id: 41 });
      const res = await call(agent._handleVoiceReport, spokenBody);
      expect(res.code).toBe(200);
      expect(res.body).toEqual({ ok: true, id: 41 });
      expect(calls).toHaveLength(1);
      expect(calls[0].url).toBe('https://bot.example/api/agent/voice-report');
      expect(calls[0].init.method).toBe('POST');
      expect(calls[0].init.headers.Authorization).toBe('Bearer tok');
      const sent = JSON.parse(calls[0].init.body);
      expect(sent).toMatchObject({ spoken: 'Slow landed', engine: 'windows', voice: 'Microsoft Zira Desktop', trigger_id: 'g-12' });
      expect(sent.agent_version).toBeTruthy();
      expect(JSON.stringify(sent)).not.toMatch(/discord/i);
    });
    it('a Suggest carries suggested_say through', async () => {
      const calls = botReplies(201, { ok: true, id: 2 });
      await call(agent._handleVoiceReport, { ...spokenBody, suggested_say: 'Slow is on the boss' });
      expect(JSON.parse(calls[0].init.body).suggested_say).toBe('Slow is on the boss');
    });
    it('503 from the bot → 503 "not switched on yet" (the caller keeps its text)', async () => {
      botReplies(503, { error: 'table missing' });
      const res = await call(agent._handleVoiceReport, spokenBody);
      expect(res.code).toBe(503);
      expect(res.body).toMatchObject({ ok: false, unavailable: true });
      expect(res.body.error).toMatch(/aren't switched on yet/);
    });
    it('404 (an older bot without the route) reads the same way', async () => {
      botReplies(404, {});
      const res = await call(agent._handleVoiceReport, spokenBody);
      expect(res.code).toBe(503);
      expect(res.body.unavailable).toBe(true);
    });
    it('429 → 429, 400 → 400, a dead network → 502', async () => {
      botReplies(429, { error: 'slow down' });
      expect((await call(agent._handleVoiceReport, spokenBody)).code).toBe(429);
      botReplies(400, { error: 'bad body' });
      expect((await call(agent._handleVoiceReport, spokenBody)).code).toBe(400);
      globalThis.fetch = async () => { throw new Error('offline'); };
      expect((await call(agent._handleVoiceReport, spokenBody)).code).toBe(502);
    });
    it('local mode (no token) makes no request and says why', async () => {
      agent._setUploadOptsForTest({ botUrl: OPTS.botUrl, token: '' });
      const calls = botReplies(201, { ok: true });
      const res = await call(agent._handleVoiceReport, spokenBody);
      expect(res.code).toBe(409);
      expect(calls).toHaveLength(0);
    });
    it('an empty report is refused locally, a foreign origin is refused, a bad body is a 400', async () => {
      const calls = botReplies(201, { ok: true });
      expect((await call(agent._handleVoiceReport, { spoken: '' })).code).toBe(400);
      expect((await call(agent._handleVoiceReport, spokenBody, { origin: 'https://evil.example' })).code).toBe(403);
      expect((await call(agent._handleVoiceReport, '{not json')).code).toBe(400);
      expect(calls).toHaveLength(0);
    });
    it('is routed in the shipped agent', () => {
      const s = stripJs(agentSrc);
      expect(s).toMatch(/'\/api\/voice-report' && req\.method === 'POST'\) return _handleVoiceReport/);
      expect(s).toMatch(/'\/api\/voice-spoken' && req\.method === 'POST'\) return _handleVoiceSpoken/);
    });
  });

  describe('POST /api/voice-spoken (what the trigger window played)', () => {
    const fireAt = (ts, text) => agent._activeOverlays.unshift({ text, trigger: 'Slow landed', trigger_id: 'g-12', firedAt: ts, shownAt: ts });

    it('keeps the voice on the matching Recent fires entry, where /api/state already carries it to the dashboard', async () => {
      fireAt(5000, '🐌 Slow landed on the boss');
      const res = await call(agent._handleVoiceSpoken, { ...spokenBody, ts: 5000 });
      expect(res.body).toEqual({ ok: true, matched: true });
      expect(agent._activeOverlays[0].voice).toEqual({ spoken: 'Slow landed', original: '🐌 Slow landed on the boss', engine: 'windows',
        voice: 'Microsoft Zira Desktop', rate: 1.05, pitch: 1 });
    });
    it('two fires in the same millisecond are told apart by the text shown', async () => {
      fireAt(5000, 'Mez broke'); fireAt(5000, '🐌 Slow landed on the boss');
      await call(agent._handleVoiceSpoken, { ...spokenBody, ts: 5000 });
      expect(agent._activeOverlays.find(o => o.text === 'Mez broke').voice).toBeUndefined();
      expect(agent._activeOverlays.find(o => o.text.startsWith('🐌')).voice.spoken).toBe('Slow landed');
    });
    it('a fire that has aged out of the list matches nothing, quietly', async () => {
      const res = await call(agent._handleVoiceSpoken, { ...spokenBody, ts: 123 });
      expect(res.body).toEqual({ ok: true, matched: false });
    });
    it('a foreign origin is refused', async () => {
      fireAt(5000, 'x');
      expect((await call(agent._handleVoiceSpoken, { ...spokenBody, ts: 5000 }, { origin: 'https://evil.example' })).code).toBe(403);
      expect(agent._activeOverlays[0].voice).toBeUndefined();
    });
  });
});

// ───────────────────────────────────────────────────────────────────────────────────────────────
describe('dashboard.html: the 🔊 on a Recent fires row', () => {
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const block = sliceBlock(dash, 'var _wpVfDraft = {}, _wpVfMsg = {};', "_wpVfDraft[t.getAttribute('data-vf-draft')] = t.value;\n});");

  function harness({ overlays, reply = { status: 200, json: { ok: true, id: 1 } } } = {}) {
    const posts = [], replays = [], says = [], repaints = [];
    let inputHandler = null;
    const state = { activeOverlays: overlays };
    const ctx = { posts, replays, says, repaints, reply, state, esc, set: (fn) => { inputHandler = fn; } };
    const prelude = `
      const window = { __wpLastState: ctx.state, _wpVoiceNames: { replay: (s) => ctx.replays.push(s), say: (t) => ctx.says.push(t) } };
      const document = { addEventListener: (ev, fn) => { if (ev === 'input') ctx.set(fn); } };
      const esc = ctx.esc;
      function wpKeep(k) { return 'data-keep="' + esc(k) + '"'; }
      function renderRecentFires(s) { ctx.repaints.push(s); }
      function fetch(url, init) {
        ctx.posts.push({ url: url, body: JSON.parse(init.body) });
        return Promise.resolve({ status: ctx.reply.status, json: () => Promise.resolve(ctx.reply.json) });
      }
    `;
    const api = new Function('ctx', [prelude, block, 'return { voiceFireCell, wpVfAct, drafts: _wpVfDraft, msgs: _wpVfMsg };'].join('\n'))(ctx);
    return { ...api, posts, replays, says, repaints, typeInto: (k, v) => inputHandler({ target: { getAttribute: () => k, hasAttribute: () => true, value: v } }) };
  }
  const voice = { spoken: 'Slow landed', original: '🐌 Slow landed on the boss', engine: 'piper', voice: 'en_US-kristin-medium', rate: 1.05, pitch: 1 };
  const row = { text: '🐌 Slow landed on the boss', trigger: 'Slow landed', trigger_id: 'g-12', shownAt: 9000, firedAt: 9000, voice };
  const flush = () => new Promise(r => setTimeout(r, 0));

  it('a row that spoke renders the 🔊, what was spoken, engine / voice / speed, the ▶ replay and the Say line', () => {
    const { voiceFireCell } = harness({ overlays: [row] });
    const html = voiceFireCell(row);
    expect(html).toContain('<details data-keep="vfire|9000"');
    expect(html).toContain('🔊');
    expect(html).toContain('spoke: <span style="color:var(--text)">Slow landed</span> · piper / en_US-kristin-medium · 1.05×');
    expect(html).toContain('data-vf-play="9000"');
    expect(html).toContain('<input type="text" data-vf-draft="9000"');
    expect(html).toContain('value="Slow landed"');       // pre-filled with the spoken text
    expect(html).toContain('data-vf-say="9000"');
    expect(html).toContain('data-vf-suggest="9000"');
  });
  it('a row that did not speak gets nothing', () => {
    const { voiceFireCell } = harness({ overlays: [row] });
    expect(voiceFireCell({ ...row, voice: undefined })).toBe('');
    expect(voiceFireCell({ text: 'x' })).toBe('');
  });
  it('is byte-stable for the same state, and escapes what was spoken', () => {
    const { voiceFireCell } = harness({ overlays: [row] });
    expect(voiceFireCell(row)).toBe(voiceFireCell({ ...row }));
    expect(voiceFireCell({ ...row, voice: { ...voice, spoken: 'a "b" <i>' } })).toContain('a &quot;b&quot; &lt;i&gt;');
  });
  it('a typed draft survives a repaint and shows instead of the spoken text', () => {
    const h = harness({ overlays: [row] });
    h.typeInto('9000', 'Slow is on the boss');
    expect(h.drafts['9000']).toBe('Slow is on the boss');
    expect(h.voiceFireCell(row)).toContain('value="Slow is on the boss"');
  });
  it('▶ replays with the SAME engine, voice, speed and pitch', () => {
    const h = harness({ overlays: [row] });
    h.wpVfAct('play', '9000');
    expect(h.replays).toEqual([{ text: 'Slow landed', engine: 'piper', voice: 'en_US-kristin-medium', rate: 1.05, pitch: 1 }]);
  });
  it('the Say ▶ plays the typed wording in the CURRENT voice (no engine or pack passed)', () => {
    const h = harness({ overlays: [row] });
    h.wpVfAct('say', '9000');                                // untouched: the spoken text
    h.typeInto('9000', 'Slow is on the boss'); h.wpVfAct('say', '9000');
    expect(h.says).toEqual(['Slow landed', 'Slow is on the boss']);
    expect(h.replays).toEqual([]);
  });
  it('Suggest sends the report with suggested_say, and says thank you', async () => {
    const h = harness({ overlays: [row] });
    h.typeInto('9000', 'Slow is on the boss'); h.wpVfAct('suggest', '9000'); await flush();
    expect(h.posts).toHaveLength(1);
    expect(h.posts[0].url).toBe('/api/voice-report');
    expect(h.posts[0].body).toEqual({ spoken: 'Slow landed', original: '🐌 Slow landed on the boss', engine: 'piper', voice: 'en_US-kristin-medium',
      rate: 1.05, pitch: 1, trigger_id: 'g-12', trigger_name: 'Slow landed', suggested_say: 'Slow is on the boss' });
    expect(JSON.stringify(h.posts[0].body)).not.toMatch(/discord/i);
    expect(h.msgs['9000']).toBe('Sent. Thank you.');
    expect(h.repaints.length).toBeGreaterThan(0);
  });
  it('Suggest with the wording unchanged sends nothing and asks for a change', async () => {
    const h = harness({ overlays: [row] });
    h.wpVfAct('suggest', '9000'); await flush();
    expect(h.posts).toHaveLength(0);
    expect(h.msgs['9000']).toMatch(/Change the wording first/);
  });
  it('503: "not switched on yet", and the typed wording is kept', async () => {
    const h = harness({ overlays: [row], reply: { status: 503, json: { ok: false, unavailable: true } } });
    h.typeInto('9000', 'Slow is on the boss'); h.wpVfAct('suggest', '9000'); await flush();
    expect(h.msgs['9000']).toBe("Voice reports aren't switched on yet. Your wording stays here.");
    expect(h.drafts['9000']).toBe('Slow is on the boss');
    expect(h.voiceFireCell(row)).toContain('value="Slow is on the boss"');
    expect(h.voiceFireCell(row)).toContain('switched on yet');
  });
  it('429 and a dead agent each get their own message', async () => {
    const a = harness({ overlays: [row], reply: { status: 429, json: { ok: false } } });
    a.typeInto('9000', 'x'); a.wpVfAct('suggest', '9000'); await flush();
    expect(a.msgs['9000']).toMatch(/Too many reports/);
    const b = harness({ overlays: [row], reply: { status: 0, json: {} } });
    b.typeInto('9000', 'x'); b.wpVfAct('suggest', '9000'); await flush();
    expect(b.msgs['9000']).toBe('Could not send it.');
  });
  it('a row that has aged out of the list does nothing', () => {
    const h = harness({ overlays: [] });
    h.wpVfAct('play', '9000');
    expect(h.replays).toEqual([]);
  });

  it('wiring: the Text cell calls it, the card holds still while a Say box has focus, and the click delegation routes all three', () => {
    const s = stripJs(dash);
    expect(s).toMatch(/esc\(o\.text \|\| ''\) \+ voiceFireCell\(o\) \+ '<\/td>'/);
    expect(s).toMatch(/ae\.tagName === 'INPUT' && el\.contains\(ae\)\) return;/);
    expect(s).toMatch(/closest\('\[data-vf-play\],\[data-vf-say\],\[data-vf-suggest\]'\)/);
  });
  it('the shipped agent embeds the same dashboard (npm run sync:dashboard)', () => {
    expect(agentSrc).toContain('data-vf-suggest');
    expect(agentSrc).toContain("fetch('/api/voice-report'");
  });
});

describe('dashboard.html: replaying a past line in its own voice', () => {
  const win = { name: 'Microsoft Zira Desktop' }, other = { name: 'Microsoft David Desktop' };
  function replayHarness({ neuralOk }) {
    const calls = { neural: [], win: [] };
    const block = sliceBlock(dash, 'async function replay(s){', 'speakWin(text, null, s);\n  }');
    const replay = new Function('calls', 'neuralOk', `
      async function playNeural(ch, text, packId, test, rate){ calls.neural.push({ ch: ch, text: text, packId: packId, test: test, rate: rate }); return neuralOk; }
      function speakWin(text, packId, over){ calls.win.push({ text: text, packId: packId, over: over }); }
      ${block}
      return replay;`)(calls, neuralOk);
    return { replay, calls };
  }
  it('a downloaded voice is asked for by name, with its speed; if it plays, the Windows voice is not used', async () => {
    const { replay, calls } = replayHarness({ neuralOk: true });
    await replay({ text: 'Slow landed', engine: 'piper', voice: 'en_US-kristin-medium', rate: 1.2, pitch: 1 });
    expect(calls.neural).toEqual([{ ch: { engine: 'piper', voice: 'en_US-kristin-medium' }, text: 'Slow landed', packId: null, test: true, rate: 1.2 }]);
    expect(calls.win).toEqual([]);
  });
  it('a downloaded voice that will not play falls back to the Windows voice, with the line\'s own settings', async () => {
    const { replay, calls } = replayHarness({ neuralOk: false });
    const s = { text: 'Slow landed', engine: 'kokoro', voice: 'af_heart', rate: 1.2, pitch: 1 };
    await replay(s);
    expect(calls.win).toEqual([{ text: 'Slow landed', packId: null, over: s }]);
  });
  it('a Windows line goes straight to the Windows voice, named, with its rate and pitch', async () => {
    const { replay, calls } = replayHarness({ neuralOk: true });
    const s = { text: 'Slow landed', engine: 'windows', voice: win.name, rate: 0.9, pitch: 1.4 };
    await replay(s);
    expect(calls.neural).toEqual([]);
    expect(calls.win).toEqual([{ text: 'Slow landed', packId: null, over: s }]);
  });
  it('speakWin applies the line\'s voice, rate and pitch over the pack\'s; an unknown voice keeps the pack\'s', () => {
    const block = sliceBlock(dash, 'function speakWin(text, packId, over){', 'window.speechSynthesis.speak(u);\n  }');
    const run = (over) => {
      const spoken = [];
      class Utt { constructor(t) { this.text = t; } }
      const fn = new Function('window', 'SpeechSynthesisUtterance', 'pick', 'voices', block + '\nreturn speakWin;')(
        { speechSynthesis: { speak: (u) => spoken.push(u), cancel() {} } }, Utt,
        () => ({ voice: other, rate: 1.05, pitch: 1 }), () => [win, other]);
      fn('Slow landed', null, over);
      return spoken[0];
    };
    expect(run({ voice: win.name, rate: 0.9, pitch: 1.4 })).toMatchObject({ voice: win, rate: 0.9, pitch: 1.4 });
    expect(run({ voice: 'gone', rate: 0, pitch: 0 })).toMatchObject({ voice: other, rate: 1.05, pitch: 1 });
    expect(run(undefined)).toMatchObject({ voice: other, rate: 1.05, pitch: 1 });
  });
});
