// The guild's co-leader's feedback batch (2026-09-27 00:22–00:47 UTC, Mimic feedback) and the
// guild lead's follow-ups the same evening:
//   · "i closed mimic with task manager and it seems none of settings were saved"
//   · "right clicking it [the tray] does nothing for some reason. no exit, no nothing"
//   · the charm break "seems to be about a second off"
//   · "The server tick function within the HUD … as a standalone timer"
//   · the guild lead: "saving potential settings changes as drafts … and give them a reminder to
//     save before exiting the page"
//
// Run: npx vitest run test/coleader-feedback-batch.test.js

import { describe, it, expect, beforeAll } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { readSource, sliceBlock, stripJs, ROOT } from './_source-slice.js';

const main = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));
const mainJs = stripJs(main);
let agent;
beforeAll(() => { agent = createRequire(import.meta.url)('../packages/wolfpack-logsync/index.js'); });

describe('config survives being killed mid-write', () => {
  const block = sliceBlock(main, 'function _readConfigRaw() {', "    fs.writeFileSync(file, text);\n  }");
  function harness(dir) {
    const file = path.join(dir, 'mimic.config.json');
    return new Function('fs', 'path', 'CONFIG_FILE', block + '\n}\nreturn { read: _readConfigRaw, save: saveConfig };')(
      fs, path, () => file);
  }
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wpcfg-'));
  it('writes through a temp file, leaves no temp behind, and keeps the last good copy', () => {
    const dir = tmp(), h = harness(dir);
    h.save({ a: 1 }); h.save({ a: 2 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mimic.config.json'), 'utf8'))).toEqual({ a: 2 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mimic.config.json.bak'), 'utf8'))).toEqual({ a: 1 });
    expect(fs.existsSync(path.join(dir, 'mimic.config.json.tmp'))).toBe(false);
  });
  it('a torn file falls back to the last good copy instead of resetting everything', () => {
    const dir = tmp(), h = harness(dir);
    h.save({ showCharm: true }); h.save({ showCharm: true, who: 1 });
    fs.writeFileSync(path.join(dir, 'mimic.config.json'), '{"showCharm": tr');   // killed mid-write
    expect(h.read()).toEqual({ showCharm: true });
  });
  it('a torn file never overwrites the good backup', () => {
    const dir = tmp(), h = harness(dir);
    h.save({ a: 1 });
    fs.writeFileSync(path.join(dir, 'mimic.config.json'), '{"a":');
    fs.writeFileSync(path.join(dir, 'mimic.config.json.bak'), '{"a":1}');
    h.save({ a: 3 });
    expect(JSON.parse(fs.readFileSync(path.join(dir, 'mimic.config.json.bak'), 'utf8'))).toEqual({ a: 1 });
  });
  it('nothing at all → nothing (defaults), not a throw', () => {
    expect(harness(tmp()).read()).toBe(null);
  });
});

describe('the tray menu always opens', () => {
  it('right-click builds the menu then pops it up (Windows/macOS)', () => {
    expect(mainJs).toContain("tray.on('right-click', () => {");
    expect(mainJs).toContain('tray.popUpContextMenu(_trayMenu || _trayFallbackMenu());');
  });
  it('only Linux keeps a set context menu, so nothing replaces an open menu elsewhere', () => {
    expect(mainJs).toContain("if (process.platform === 'linux') tray.setContextMenu(menu);");
    expect(mainJs.match(/tray\.setContextMenu\(/g)).toHaveLength(1);
  });
  it('a menu that fails to build still offers Quit', () => {
    const fb = sliceBlock(main, 'function _trayFallbackMenu() {', '\n}');
    expect(fb).toContain("{ label: 'Quit Mimic', click: _quitMimic }");
  });
  it('the dashboard has Quit too, through the same routine (tray ↔ dashboard parity)', () => {
    expect(mainJs).toContain("ipcMain.handle('quit-app', () => { setImmediate(_quitMimic); return true; });");
    const dash = stripJs(readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));
    expect(dash).toContain('window.mimic.quitApp()');
  });
  it('quitting never waits on an unsaved Settings window', () => {
    const bq = sliceBlock(main, "app.on('before-quit', () => {", '\n});');
    expect(bq).toContain('settingsWindow.destroy()');
  });
});

describe('fires reach the trigger window the moment they happen', () => {
  it('a waiting request answers as soon as a fire is pushed', async () => {
    const after = Date.now();
    const t0 = Date.now();
    const p = agent._waitForFires(after, 5000);
    setTimeout(() => agent._pushOverlay({ text: 'CHARM BREAK', firedAt: after + 1, trigger: 'tf-longpoll' }), 30);
    const fires = await p;
    expect(Date.now() - t0).toBeLessThan(1000);
    expect(fires.map(f => f.text)).toContain('CHARM BREAK');
  });
  it('answers straight away when a newer fire already exists, and [] after the wait', async () => {
    agent._pushOverlay({ text: 'NOW', firedAt: Date.now() + 5, trigger: 'tf-now' });
    expect((await agent._waitForFires(Date.now() - 1000, 50)).some(f => f.text === 'NOW')).toBe(true);
    expect(await agent._waitForFires(Date.now() + 60_000, 20)).toEqual([]);
  });
  it('the log is read every 150 ms while it is being written, 500 ms when idle', () => {
    const now = Date.now();
    expect(agent._tailDelayMs(now - 5_000, now)).toBe(150);
    expect(agent._tailDelayMs(now - 120_000, now)).toBe(500);
  });
  it('the trigger window long-polls, stops on an older agent, and shares the spoken cursor', () => {
    const t = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'triggers.html')));
    expect(t).toContain("'/api/fires/wait?after=' + encodeURIComponent(lastTs)");
    expect(t).toContain('if (r.status === 404) return;');
    expect(t).toMatch(/if \(\(f\.ts\|\|0\) > lastTs\)\{ lastTs = f\.ts; fire\(f\); \}[\s\S]*\/api\/fires\/wait/);
  });
  it('the Charm overlay waits 600 ms, not 1500, before calling a break', () => {
    const c = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'charm.html')));
    expect(c).toMatch(/speak\('charm break'\);\s*pendingRecharm\.delete\(key\);\s*\}, 600\);/);
  });
});

describe('server tick as its own bar', () => {
  it('the switch gives a 6s cycling bar off the Zeal tick', () => {
    const now = Date.now();
    agent._setZealStateForTest('Rethlan', { updatedAt: now, gauges: [{ slot: 24, hp_pct: 50, text: '3' }] });
    const tpl = agent.SUGGESTED_TRIGGERS.find(t => t.id === 'timer_server_tick');
    agent._setPersonalTriggersForTest([agent._compilePersonalTrigger(agent._templateToPersonalRow(tpl))]);
    const row = agent._builtinTimerRows(now).find(r => r.id === 'bt|servertick');
    agent._setZealStateForTest('Rethlan', null);
    agent._setPersonalTriggersForTest([]);
    expect(row).toMatchObject({ remaining_ms: 3000, cycle_ms: 6000, effect: 'Server tick', pinned: true });
  });
});

describe('Settings keeps a draft and asks before closing', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'settings.html'));
  const draft = sliceBlock(html, "  const DRAFT_KEY = 'wp:settings:draft';",
    '    } catch (e) { /* storage unavailable: the close reminder still works */ }\n  }');
  function run(sig, clean) {
    const store = {};
    const localStorage = { setItem: (k, v) => { store[k] = v; }, removeItem: (k) => { delete store[k]; }, getItem: (k) => store[k] || null };
    const h = new Function('localStorage', '_settingsSig', '_cleanSig', draft + '\nreturn { save: _saveDraftNow };')(
      localStorage, () => sig, clean);
    h.save();
    return store;
  }
  it('an edit is kept as a draft — without the token', () => {
    const store = run(JSON.stringify({ quietMode: true, tokenTyped: true }), JSON.stringify({ quietMode: false, tokenTyped: false }));
    const d = JSON.parse(store['wp:settings:draft']);
    expect(d.form).toEqual({ quietMode: true });
  });
  it('no draft when nothing differs from what is saved', () => {
    const same = JSON.stringify({ quietMode: false });
    expect(run(same, same)).toEqual({});
  });
  it('closing with unsaved edits asks; the draft comes back on open', () => {
    const s = stripJs(html);
    expect(s).toMatch(/window\.addEventListener\('beforeunload', \(e\) => \{[\s\S]*_showBar\('closing'\);[\s\S]*e\.returnValue = false;/);
    expect(s).toMatch(/_markClean\(\);\s*_offerDraft\(\);/);
  });
});
