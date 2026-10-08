// The Mimic half of feedback screenshots (the guild lead, 2026-09-26: "feedback and suggestion
// needs to be able to take screenshots..top priority"): the 📸 capture, the dashboard card, and the
// agent route that forwards what the reporter chose.
//
// Run: npx vitest run test/feedback-screenshots-mimic.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT, AGENT_INDEX } from './_source-slice.js';

const agentSrc = readSource(AGENT_INDEX);
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

describe('agent /api/feedback-send forwards the chosen screenshots', () => {
  const handler = sliceBlock(agentSrc, "if (req.url === '/api/feedback-send' && req.method === 'POST') {",
    '\n      // Mimic pushes Zeal update status here');
  async function send(body, botReply) {
    const sent = [];
    const res = { writeHead() {}, end(b) { this.body = b; return b; } };
    const run = new Function('req', 'res', '_readBody', '_uploadOpts', 'buildFeedbackLogSlice', 'AGENT_VERSION',
      '_primaryCharacter', 'fetch', 'process',
      'return (async () => { ' + handler.replace(/\n      \/\/ Mimic pushes Zeal update status here$/, '') + ' })();');
    await run({ url: '/api/feedback-send', method: 'POST' }, res, async () => JSON.stringify(body),
      { botUrl: 'http://bot.test/api/agent/encounter', token: 't' }, () => ({ ok: false }), '3.7.26',
      () => 'Aldenmar', async (url, opts) => { sent.push({ url, body: JSON.parse(opts.body) }); return { ok: true, json: async () => botReply }; },
      { env: {}, platform: 'win32' });
    return { sent, out: JSON.parse(res.body) };
  }
  const jpeg = 'data:image/jpeg;base64,' + Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]).toString('base64');
  it('passes up to three image data URLs to the bot, and drops anything else', async () => {
    const { sent } = await send({ category: 'bug', message: 'the charm window froze', screenshots:
      ['data:text/html;base64,PGgxPg==', jpeg, 42, jpeg, jpeg, jpeg] }, { ok: true, screenshots: 3 });
    expect(sent[0].url).toBe('http://bot.test/api/agent/feedback');
    expect(sent[0].body.screenshots).toEqual([jpeg, jpeg, jpeg]);
  });
  it('sends no screenshots key at all when none were chosen', async () => {
    const { sent } = await send({ category: 'idea', message: 'a dark mode please' }, { ok: true });
    expect('screenshots' in sent[0].body).toBe(false);
  });
  it('reports how many the bot kept', async () => {
    const { out } = await send({ category: 'bug', message: 'the charm window froze', screenshots: [jpeg] }, { ok: true, screenshots: 1 });
    expect(out).toMatchObject({ ok: true, attached_shots: 1 });
  });
  it('accepts a body big enough for three screenshots', () => {
    expect(stripJs(handler)).toContain('await _readBody(req, 16 * 1024 * 1024)');
  });
});

describe('dashboard card: screenshots are chosen, never swept up', () => {
  const block = sliceBlock(dash, 'var _wpFbShots = [];', '\n  else { _wpFbCands = shots; _wpFbRenderShots(); }   // several monitors: the reporter picks\n}');
  function harness(captured) {
    const env = {
      window: { mimic: { captureScreens: async () => captured } },
      document: {
        getElementById: () => null,
        createElement: () => ({ getContext: () => ({ drawImage() {} }), toDataURL: () => 'data:image/jpeg;base64,SMALL' }),
      },
      Image: class { set src(v) { this._s = v; this.naturalWidth = 3000; this.naturalHeight = 1500; setTimeout(() => this.onload && this.onload(), 0); } },
      esc: (s) => String(s),
    };
    return new Function('window', 'document', 'Image', 'esc', 'FileReader',
      block + '\nreturn { snap: _wpFbSnap, add: _wpFbAddShots, shots: () => _wpFbShots, cands: () => _wpFbCands };')(
      env.window, env.document, env.Image, env.esc, class {});
  }
  it('one monitor: the shot is attached (shrunk), ready to review', async () => {
    const h = harness([{ name: 'Screen 1', dataUrl: 'data:image/jpeg;base64,BIG' }]);
    await h.snap();
    expect(h.shots()).toEqual(['data:image/jpeg;base64,SMALL']);
    expect(h.cands()).toEqual([]);
  });
  it('several monitors: nothing is attached until the reporter picks a screen', async () => {
    const h = harness([{ name: 'Screen 1', dataUrl: 'a' }, { name: 'Screen 2', dataUrl: 'b' }]);
    await h.snap();
    expect(h.shots()).toEqual([]);
    expect(h.cands().map(c => c.name)).toEqual(['Screen 1', 'Screen 2']);
  });
  it('never holds more than three', async () => {
    const h = harness([]);
    await h.add(['a', 'b', 'c', 'd', 'e']);
    expect(h.shots()).toHaveLength(3);
  });
  it('📸 only appears inside Mimic; the send carries what was chosen', () => {
    const s = stripJs(dash);
    expect(s).toContain("if (snapBtn && window.mimic && window.mimic.captureScreens) snapBtn.style.display = '';");
    expect(s).toContain('screenshots: _wpFbShots.slice(0, WP_FB_MAX_SHOTS),');
  });
});

describe('Mimic capture-screens', () => {
  const h = stripJs(sliceBlock(main, "ipcMain.handle('capture-screens', async (e) => {", '\n});'));
  it('hides the asking window for the shot and always brings it back', () => {
    expect(h).toContain('if (live) win.setOpacity(0);');
    expect(h).toMatch(/finally \{\s*if \(live && !win\.isDestroyed\(\)\) win\.setOpacity\(prevOpacity\);/);
  });
  it('returns JPEGs no wider than 1920 px and writes nothing to disk', () => {
    expect(h).toContain('img.resize({ width: 1920');
    expect(h).toContain('toJPEG(82)');
    expect(h).not.toMatch(/writeFile|fs\./);
  });
});
