// test/mimic-alpha-channel.test.js — the Mimic 3.0 alpha update track.
//
// The guild lead, 2026-09-29: "can we make an alpha channel for 3.0 testing as well? I'm sure we're
// going to do more beta releases before that, but I think I should test out the overlay builder soon
// after this new round of beta elements."
// Alpha builds (3.0.0-alpha.N, from the `alpha` branch) live on ONE rolling release, tag `mimic-alpha`,
// read from its fixed download address — never through GitHub's 10-entry release feed, which a day of
// beta pushes would push an alpha out of. The track logic, the feed swap, the header, the dashboard
// button and the tray/IPC wiring run as real code here.
//
// Run: npx vitest run test/mimic-alpha-channel.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const preload = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'preload.js')));
const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));

const trackSrc = sliceBlock(main, 'const _ALPHA_FEED  = {', '  return wantBeta;\n}');
// `platform` shadows the real `process` inside the evaluated block: the Linux/Deck
// branch of _applyUpdaterChannel (#156) returns early, so the Windows track logic
// under test here must run as win32 no matter what host runs the suite (CI is Linux).
function updater(cfg, version, alphaFeedSet = false, platform = 'win32') {
  const au = { feeds: [], allowPrerelease: null, channel: null, allowDowngrade: null, setFeedURL(o) { this.feeds.push(o); } };
  // eslint-disable-next-line no-new-func
  const api = new Function('autoUpdater', 'loadConfig', 'app', 'process',
    trackSrc + `\n_alphaFeedSet = ${alphaFeedSet};\nreturn { _updateTrack, _applyUpdaterChannel };`)(
    au, () => cfg, { getVersion: () => version }, { platform });
  return { au, api };
}

describe('which update track a Mimic is on', () => {
  const { api } = updater({}, '2.7.4');
  const t = (cfg, v) => api._updateTrack(cfg, v);
  it('stable stays stable; the beta opt-in or a beta build is beta', () => {
    expect(t({}, '2.7.4')).toBe('stable');
    expect(t({ betaChannel: true }, '2.7.4')).toBe('beta');
    expect(t({}, '2.7.5-beta.3')).toBe('beta');
  });
  it('an alpha build stays on alpha until the raider leaves it; then it is a beta', () => {
    expect(t({}, '3.0.0-alpha.840')).toBe('alpha');
    expect(t({ alphaChannel: false }, '3.0.0-alpha.840')).toBe('beta');
  });
  it('anyone can opt into the alpha; revert-to-stable beats everything', () => {
    expect(t({ alphaChannel: true }, '2.7.4')).toBe('alpha');
    expect(t({ alphaChannel: true }, '2.7.5-beta.3')).toBe('alpha');
    expect(t({ alphaChannel: true, forceStable: true }, '3.0.0-alpha.840')).toBe('stable');
  });
});

describe('the updater follows the track', () => {
  it('alpha reads the rolling mimic-alpha release directly, as channel alpha', () => {
    const { au, api } = updater({ alphaChannel: true }, '2.7.5-beta.3');
    api._applyUpdaterChannel();
    expect(au.feeds).toEqual([{ provider: 'generic', url: 'https://github.com/davehess/QuarmBossTracker/releases/download/mimic-alpha/', channel: 'alpha' }]);
    expect(au.channel).toBe('alpha');
    expect(au.allowDowngrade).toBe(false);
  });
  it('leaving an alpha build goes back to GitHub releases on beta, and may step down from 3.0.0', () => {
    const { au, api } = updater({ alphaChannel: false }, '3.0.0-alpha.840', true);
    api._applyUpdaterChannel();
    expect(au.feeds).toEqual([{ provider: 'github', owner: 'davehess', repo: 'QuarmBossTracker' }]);
    expect(au.channel).toBe('beta');
    expect(au.allowDowngrade).toBe(true);
  });
  it('a beta or stable install that never touched the alpha keeps its built-in feed', () => {
    for (const [cfg, v, ch] of [[{}, '2.7.4', 'latest'], [{ betaChannel: true }, '2.7.4', 'beta'], [{}, '2.7.5-beta.3', 'beta']]) {
      const { au, api } = updater(cfg, v);
      api._applyUpdaterChannel();
      expect(au.feeds).toEqual([]);
      expect(au.channel).toBe(ch);
      expect(au.allowDowngrade).toBe(false);
    }
  });
  it('Linux / Steam Deck stays on its own linux channel, even with the alpha opted into', () => {
    const { au, api } = updater({ alphaChannel: true }, '2.7.10-linux.4', false, 'linux');
    api._applyUpdaterChannel();
    expect(au.feeds).toEqual([]);
    expect(au.channel).toBe('linux');
    expect(au.allowPrerelease).toBe(true);
    expect(au.allowDowngrade).toBe(false);
  });
  it('revert to stable also clears the alpha opt-in, or the stable install would climb straight back', () => {
    const fn = stripJs(sliceBlock(main, 'async function revertToStable(source) {', '\n}'));
    expect(fn).toMatch(/cfg\.alphaChannel = false;/);
  });
});

describe('dashboard header', () => {
  const open = '<span id="wpUpdSlot"></span>{{WP:';
  const start = dash.indexOf(open) + open.length;
  const expr = dash.slice(start, dash.indexOf('}}<span id="wpTopRight">', start));
  // eslint-disable-next-line no-new-func
  const render = (env) => new Function('process', 'return (' + expr + ');')({ env });
  it('an alpha build says ALPHA, not BETA, and still offers ↩ stable', () => {
    const h = render({ WOLFPACK_APP_VERSION: '3.0.0-alpha.840' });
    expect(h).toContain('>ALPHA</span>');
    expect(h).not.toContain('>BETA</span>');
    expect(h).toContain('wpRevertStable');
  });
  it('every Mimic build carries the α alpha button, hidden until the shell answers', () => {
    for (const v of ['2.7.4', '2.7.5-beta.3', '3.0.0-alpha.840']) {
      expect(render({ WOLFPACK_APP_VERSION: v })).toMatch(/<button id="wpAlpha"[^>]*style="display:none;/);
    }
    expect(render({ WOLFPACK_APP_VERSION: '2.7.5-beta.3' })).toContain('>BETA</span>');
    expect(render({})).toBe('');
  });
});

describe('α alpha button', () => {
  const iife = sliceBlock(dash, "(function () {\n  var ab = document.getElementById('wpAlpha');",
    "window.addEventListener('focus', read);\n})();");
  const flush = () => new Promise((r) => setTimeout(r, 0));
  function run(bridge) {
    const ab = { style: { display: 'none' }, dataset: {}, textContent: 'α alpha', title: '', disabled: false, onclick: null };
    const win = { mimic: bridge, addEventListener: () => {} };
    // eslint-disable-next-line no-new-func
    new Function('document', 'window', iife)({ getElementById: (id) => (id === 'wpAlpha' ? ab : null) }, win);
    return ab;
  }
  it('stays hidden without the bridge or without an updater', async () => {
    expect((await (async () => { const b = run({}); await flush(); return b; })()).style.display).toBe('none');
    const b = run({ getAlphaChannel: async () => ({ available: false }), setAlphaChannel: async () => true });
    await flush();
    expect(b.style.display).toBe('none');
  });
  it('joins after the confirm, and says when it lands', async () => {
    const calls = [];
    const b = run({ getAlphaChannel: async () => ({ optedIn: false, running: false, available: true }), setAlphaChannel: async (on) => { calls.push(on); return true; } });
    await flush();
    expect(b.style.display).toBe('');
    expect(b.textContent).toBe('α alpha');
    b.onclick(); await flush();
    expect(calls).toEqual([true]);
    expect(b.textContent).toBe('✓ alpha on next restart');
  });
  it('on an alpha build it is the way out', async () => {
    const calls = [];
    const b = run({ getAlphaChannel: async () => ({ optedIn: true, running: true, available: true }), setAlphaChannel: async (on) => { calls.push(on); return true; } });
    await flush();
    expect(b.textContent).toBe('↩ leave alpha');
    b.onclick(); await flush();
    expect(calls).toEqual([false]);
  });
});

describe('shell: one function behind the tray and the dashboard', () => {
  it('the tray checkbox and the dashboard IPC both call setAlphaChannel', () => {
    const tray = stripJs(sliceBlock(main, 'const alphaChannelItem = {', '\n  };'));
    expect(tray).toMatch(/click:\s*\(mi\)\s*=>\s*setAlphaChannel\(!!mi\.checked,\s*'tray'\)/);
    expect(stripJs(main)).toMatch(/betaChannelItem,\s*\n\s*alphaChannelItem,/);
    const ipc = stripJs(sliceBlock(main, "ipcMain.handle('set-alpha-channel'", '\n});'));
    expect(ipc).toMatch(/setAlphaChannel\(join, 'dashboard'\);/);
  });
  it('setAlphaChannel saves the choice, lifts a stable pin, applies the track and checks now', () => {
    const fnBlock = sliceBlock(main, 'function setAlphaChannel(on, source) {', '  pushStatus();\n}');
    let cfg = { forceStable: true, other: 1 };
    const log = { applied: 0, checks: 0 };
    // eslint-disable-next-line no-new-func
    const set = new Function('loadConfig', 'saveConfig', 'autoUpdater', '_applyUpdaterChannel', 'appendAgentLog', 'safeCheckForUpdates', 'pushStatus',
      fnBlock + '\nreturn setAlphaChannel;')(() => ({ ...cfg }), (c) => { cfg = c; }, {}, () => { log.applied++; }, () => {}, (v) => { if (v) log.checks++; }, () => {});
    set(true, 'dashboard');
    expect(cfg).toEqual({ alphaChannel: true, other: 1 });
    expect(log).toEqual({ applied: 1, checks: 1 });
  });
  it('preload exposes both calls on the channels main.js handles', () => {
    expect(preload).toMatch(/getAlphaChannel:\s*\(\)\s*=>\s*ipcRenderer\.invoke\('get-alpha-channel'\)/);
    expect(preload).toMatch(/setAlphaChannel:\s*\(on\)\s*=>\s*ipcRenderer\.invoke\('set-alpha-channel',\s*!!on\)/);
    expect(main).toContain("ipcMain.handle('get-alpha-channel'");
  });
});
