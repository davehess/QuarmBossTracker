// "Bring your setup to this computer" (the guild lead, 2026-11-10/11): a member signed in on another PC could not
// reach his own UI backups, because every backup call starts from a character found on disk.
// Behaviour for the pure decisions and the bot's list shaping; stripped-source wiring for the route and the IPC.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import path from 'node:path';
import { readSource, stripJs, sliceBlock, ROOT } from './_source-slice.js';

const require = createRequire(import.meta.url);
const sync = require('../apps/mimic/uiSync.js');
const plan = require('../apps/mimic/uiRestorePlan.js');

describe('markOnThisPc', () => {
  const acct = [{ character: 'Aldenmar', backups: 3 }, { character: 'Brackwyn', backups: 1 }];
  it('marks a character with files here, ignoring case, and keeps the order', () => {
    const r = sync.markOnThisPc(acct, ['aldenmar', 'Zarrin']);
    expect(r.map(c => [c.character, c.onThisPc])).toEqual([['Aldenmar', true], ['Brackwyn', false]]);
    expect(r[0].backups).toBe(3);
  });
  it('a PC with no files marks everything as not here, and bad rows are dropped', () => {
    expect(sync.markOnThisPc(acct, []).every(c => c.onThisPc === false)).toBe(true);
    expect(sync.markOnThisPc([null, {}, { character: '' }], ['x'])).toEqual([]);
    expect(sync.markOnThisPc(undefined, ['x'])).toEqual([]);
  });
  it('otherCharsOnPc lists disk characters that are not the account\'s', () => {
    expect(sync.otherCharsOnPc(acct, ['aldenmar', 'Zarrin', 'Corvale'])).toEqual(['Zarrin', 'Corvale']);
    expect(sync.otherCharsOnPc(acct, ['Brackwyn'])).toEqual([]);
  });
});

describe('defaultParts', () => {
  it('brings everything on a PC with only this account', () => {
    expect(sync.defaultParts({ otherAccountsOnPc: false }).sort()).toEqual(plan.PARTS.map(p => p.key).concat('overlays').sort());
    expect(sync.defaultParts()).toContain('keybinds');
  });
  it('leaves keybinds and Zeal (shared by every character on the PC) off when another account is on the PC', () => {
    const p = sync.defaultParts({ otherAccountsOnPc: true });
    expect(p).not.toContain('keybinds');
    expect(p).not.toContain('zeal');
    expect(p).toEqual(expect.arrayContaining(['layout', 'hotkeys', 'socials', 'spellsets', 'other', 'overlays']));
  });
});

describe('a character with no files here is created by the restore', () => {
  it('buildRestore writes the character\'s files into an EQ folder that has none of them', () => {
    const backup = {
      'UI_Aldenmar_pq.proj.ini': '[Chat]\r\nXPos1920x1080=2400\r\nYPos1920x1080=10\r\n',
      'Aldenmar_pq.proj.ini': '[HotButtons]\r\nPage1Button1Name=A\r\n[Options]\r\nT=1\r\n',
      'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nKEY=1\r\n',
    };
    const r = plan.buildRestore({
      backupFiles: backup, localFiles: { 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\n[KeyMaps]\r\nKEY=9\r\n' },
      character: 'Aldenmar', parts: sync.defaultParts({ otherAccountsOnPc: true }), knownChars: ['Zarrin'], target: { w: 1920, h: 1080 },
    });
    expect(Object.keys(r.writes).sort()).toEqual(['Aldenmar_pq.proj.ini', 'UI_Aldenmar_pq.proj.ini']);
    expect(r.writes['UI_Aldenmar_pq.proj.ini']).toMatch(/XPos1920x1080=1840/);     // fitted onto this screen
    expect(r.writes['eqclient.ini']).toBeUndefined();                              // shared settings untouched
  });
});

describe('bot list of the account\'s characters', () => {
  const bot = readSource(path.join(ROOT, 'index.js'));
  const shapeSrc = sliceBlock(bot, 'function _shapeUiAccountCharacters(rows) {', '\n}\n');
  // eslint-disable-next-line no-new-func
  const shape = new Function('_UI_AUTO_LABEL', shapeSrc + '\nreturn _shapeUiAccountCharacters;')('Auto: after camp');
  const rows = [
    { id: 'a1', character_name: 'Aldenmar', label: 'Layout: raid', created_at: '2026-11-09T10:00:00Z', file_count: 1 },
    { id: 'a2', character_name: 'aldenmar', label: null, created_at: '2026-11-08T10:00:00Z', file_count: 18, source_width: 1920, source_height: 1080, machine_name: 'PC1' },
    { id: 'a3', character_name: 'Aldenmar', label: 'Auto: after camp', created_at: '2026-11-07T10:00:00Z', file_count: 17 },
    { id: 'b1', character_name: 'Brackwyn', label: 'Layout: x', created_at: '2026-11-10T10:00:00Z', file_count: 1 },
  ];
  it('groups per character, newest first, and picks the newest WHOLE bundle as latestFull', () => {
    const r = shape(rows);
    expect(r.map(c => c.character)).toEqual(['Brackwyn', 'Aldenmar']);
    const a = r[1];
    expect(a.backups).toBe(3);
    expect(a.latest.id).toBe('a1');
    expect(a.latestFull).toMatchObject({ id: 'a2', source_width: 1920, machine_name: 'PC1' });
    expect(r[0].latestFull).toBeNull();                  // only a named layout: not a setup to bring over
  });
  it('lists the newest whole bundle PER computer, most recently backed up computer first', () => {
    const r = shape([
      { id: 'p1', character_name: 'Aldenmar', label: null, machine_name: 'DESK', created_at: '2026-11-01T00:00:00Z' },
      { id: 'p2', character_name: 'Aldenmar', label: null, machine_name: 'DESK', created_at: '2026-11-03T00:00:00Z' },
      { id: 'l1', character_name: 'Aldenmar', label: 'Auto: after camp', machine_name: 'LAPTOP', created_at: '2026-11-05T00:00:00Z' },
      { id: 'n1', character_name: 'Aldenmar', label: 'Layout: raid', machine_name: 'NAMED', created_at: '2026-11-09T00:00:00Z' },
    ]);
    expect(r[0].machines.map(m => [m.machine_name, m.latestFull.id])).toEqual([['LAPTOP', 'l1'], ['DESK', 'p2']]);
    expect(r[0].machines[1].full_backups).toBe(2);
  });
  it('caps at 40 characters', () => {
    const many = Array.from({ length: 60 }, (_, i) => ({ id: 'i' + i, character_name: 'Char' + i, created_at: '2026-11-0' + (1 + (i % 9)) + 'T00:00:00Z' }));
    expect(shape(many)).toHaveLength(40);
  });
  it('reads no payload column and is routed ahead of the id download', () => {
    const src = stripJs(bot);
    const handler = sliceBlock(src, 'async function _handleAgentUiLayoutCharacters(req, res) {', '\n}\n');
    expect(handler).toMatch(/requireAgentAuth/);
    expect(handler).toMatch(/_householdDiscordIds\(identity\.discord_id\)/);
    expect(handler).not.toMatch(/payload_enc/);
    expect(handler).not.toMatch(/console\.warn/);
    const routeAt = src.indexOf('/api\\/agent\\/ui_layout\\/characters');
    expect(routeAt).toBeGreaterThan(0);
    expect(routeAt).toBeLessThan(src.indexOf("req.url.startsWith('/api/agent/ui_layout/')"));
  });
});

describe('Mimic wiring', () => {
  const main = stripJs(readSource(path.join(ROOT, 'apps/mimic/main.js')));
  it('ui-account-characters calls the new route with the sign-in token and marks onThisPc', () => {
    const b = sliceBlock(main, "ipcMain.handle('ui-account-characters'", '\n});\n');
    expect(b).toMatch(/resolveUploadToken\(cfg\)/);
    expect(b).toMatch(/\/api\/agent\/ui_layout\/characters/);
    expect(b).toMatch(/uiSync\.markOnThisPc/);
    expect(main).toMatch(/ipcMain\.handle\('ui-studio-list-characters', \(\) => _uiStudioDiskCharacters\(\)\)/);
  });
  it('is exposed to the renderer and used by Settings', () => {
    expect(readSource(path.join(ROOT, 'apps/mimic/preload.js'))).toMatch(/uiAccountCharacters:\s+\(\)\s+=> ipcRenderer\.invoke\('ui-account-characters'\)/);
    const html = readSource(path.join(ROOT, 'apps/mimic/settings.html'));
    expect(html).toContain('Other characters on this computer (');
    // One card, three pages: each includes the shared script and mounts it.
    expect(readSource(path.join(ROOT, 'apps/mimic/bring-setup.js'))).toContain('Bring your setup to this computer?');
    for (const p of ['settings.html', 'welcome.html', 'ui-studio.html']) {
      const s = readSource(path.join(ROOT, 'apps/mimic', p));
      expect(s).toContain('<script src="bring-setup.js"></script>');
      expect(s).toMatch(/wpBringSetup\.mount\(/);
    }
    expect(readSource(path.join(ROOT, 'apps/mimic/ui-studio.html'))).toMatch(/mount\([^;]*all: true/);
  });
  it('a restore takes the dated eqclient.ini / zeal.ini copies before it writes anything', () => {
    const w = sliceBlock(main, 'function _uiWriteRestore(entry, backupTag) {', '\n}\n');
    expect(w.indexOf('_uiSafetyCopies(entry.eqDir)')).toBeGreaterThan(-1);
    expect(w.indexOf('_uiSafetyCopies(entry.eqDir)')).toBeLessThan(w.indexOf('_backupAndWriteFile'));
    expect(sliceBlock(main, 'function _uiSafetyCopies(eqDir) {', '\n}\n')).toMatch(/eqclient\.ini[\s\S]*zeal\.ini/);
    expect(sliceBlock(main, 'function _backupAndWriteFile(', '\n}\n')).toMatch(/stampedCopy/);
  });
  it('the after-camp job keeps a local version first, and the upload carries the overlay layout', () => {
    const a = sliceBlock(main, 'async function _uiAutoBackup(character) {', '\n}\n');
    expect(a.indexOf('localVersions.saveVersion')).toBeGreaterThan(-1);
    expect(a.indexOf('localVersions.saveVersion')).toBeLessThan(a.indexOf('autoBackup'));
    expect(sliceBlock(main, 'async function _uiUploadBundle(', '\n}\n')).toMatch(/overlayBackup\.FILE/);
    expect(sliceBlock(main, 'async function _fetchUiSnapshot(', '\n}\n')).toMatch(/overlayBackup\.parse[\s\S]*filterRestorable/);
  });
});

// Overlay positions, local versions and the dated copies (the guild lead, 2026-11-11).
const ob = require('../apps/mimic/overlayBackup.js');
const lv = require('../apps/mimic/localVersions.js');
const fs = require('node:fs');
const os = require('node:os');

describe('overlay positions part', () => {
  const text = ob.build({
    rects: { hudBounds: { x: 3000, y: 20, width: 300, height: 200 }, triggerBounds: { x: 100, y: 100, width: 200, height: 100 }, 'bad key!': { x: 1, y: 1, width: 1, height: 1 } },
    flags: { showHud: true, showMap: false, notAFlag: true, showX: 'yes' }, sig: '0,0,1920x1080', machine: 'DESK',
  });
  it('round-trips only well-formed rects and show* flags', () => {
    const o = ob.parse(text);
    expect(Object.keys(o.rects).sort()).toEqual(['hudBounds', 'triggerBounds']);
    expect(o.flags).toEqual({ showHud: true, showMap: false });
    expect(ob.parse('{"v":2}')).toBeNull();
    expect(ob.parse('not json')).toBeNull();
    expect(ob.parse(JSON.stringify({ v: 1, rects: { hudBounds: { x: 'a', y: 1, width: 1, height: 1 } } }))).toBeNull();
  });
  it('an overlay off every screen comes to EverQuest\'s screen; one on a screen stays put', () => {
    const o = ob.parse(text);
    const screens = [{ x: 0, y: 0, width: 1920, height: 1040 }];
    const r = ob.landOnScreens(o.rects, screens, screens[0]);
    expect(r.triggerBounds).toEqual({ x: 100, y: 100, width: 200, height: 100 });
    expect(r.hudBounds.x).toBeLessThanOrEqual(1920 - 300);
    expect(r.hudBounds.x).toBeGreaterThanOrEqual(0);
  });
  it('is its own part in a backup but never an EQ file', () => {
    expect(require('../apps/mimic/uiRestoreGuard.js').restorableName(ob.FILE)).toBe(false);
  });
});

describe('local versions and dated copies', () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'wp-lv-'));
  it('stampedCopy names the copy next to the file, dedups within a second, keeps the newest 10', () => {
    const d = tmp();
    fs.writeFileSync(path.join(d, 'eqclient.ini'), 'a');
    expect(lv.stampedCopy(d, 'zeal.ini')).toBeNull();                               // nothing to protect
    for (let i = 0; i < 13; i++) lv.stampedCopy(d, 'eqclient.ini', new Date(2026, 10, 11, 5, 0, i));
    const names = fs.readdirSync(d).filter(f => f.startsWith('eqclient.ini.mimic-'));
    expect(names).toHaveLength(10);
    expect(names[0]).toMatch(/^eqclient\.ini\.mimic-20261111-0500\d\d\.bak$/);
    expect(names.sort()[0]).toContain('050003');                                      // the oldest three went
    expect(lv.stampedCopy(d, 'eqclient.ini', new Date(2026, 10, 11, 5, 0, 12))).toMatch(/050012/);
    expect(fs.readdirSync(d).filter(f => f.includes('050012'))).toHaveLength(1);
  });
  it('saveVersion keeps the newest 5, skips an unchanged set, and reads back', () => {
    const root = tmp();
    for (let i = 0; i < 7; i++) lv.saveVersion(root, 'Aldenmar', { 'UI_Aldenmar_pq.proj.ini': 'v' + i }, new Date(2026, 10, 11, 5, i, 0));
    const list = lv.listVersions(root, 'aldenmar');
    expect(list).toHaveLength(5);
    expect(list[0].id).toBe('local-20261111-050600');
    expect(lv.saveVersion(root, 'Aldenmar', { 'UI_Aldenmar_pq.proj.ini': 'v6' }, new Date(2026, 10, 11, 6, 0, 0))).toBeNull();   // unchanged
    expect(lv.readVersion(root, 'Aldenmar', list[0].id)).toEqual({ 'UI_Aldenmar_pq.proj.ini': 'v6' });
    expect(lv.readVersion(root, '../x', list[0].id)).toBeNull();
    expect(lv.isLocalId('local-20261111-050600')).toBe(true);
    expect(lv.isLocalId('0e6b0c1e-0000-0000-0000-000000000000')).toBe(false);
  });
});

// ---- the 2026-11-11 member report: FB-123 / 124 / 125 / 126 / 127 ------------------------------------------------
// A member brought one character from a 7-file backup onto a PC that also holds another account's characters (so key
// bindings and Zeal were off). The hotbars, macros, spell sets and chat routing did not arrive.
describe('a bring-in on a shared PC lands every file of the character (FB-124 / 126 / 127)', () => {
  const backup = {
    'UI_Aldenmar_pq.proj.ini': '[MainChat]\r\nXPos1920x1080=10\r\nYPos1920x1080=20\r\n[ChatManager]\r\nNumWindows=2\r\nChannelMap4=1\r\nChannelMap41=1\r\n',
    'Aldenmar_pq.proj.ini': '[HotButtons]\r\nPage1Button1Name=Heal\r\n[Socials]\r\nPage1Button1Name=Hi\r\n[Options]\r\nT=1\r\n',
    'Aldenmar_spellsets.ini': '[Set1]\r\nGem1=Heal\r\n',
    'Aldenmar_bandolier.ini': '[Band]\r\nA=1\r\n',
    'Aldenmar_protected.ini': '[Prot]\r\nA=1\r\n',
    'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\n[KeyMaps]\r\nKEY=1\r\n[Aldenmar]\r\nTellWindows=1\r\n',
    'zeal.ini': '[Zeal]\r\nFoo=2\r\n[Aldenmar]\r\nExtended_ChannelMaps=7\r\n[TellWindows_Aldenmar]\r\nX=5\r\n',
  };
  const local = { 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\n[KeyMaps]\r\nKEY=9\r\n', 'zeal.ini': '[Zeal]\r\nFoo=1\r\n' };
  const run = (parts) => plan.buildRestore({ backupFiles: backup, localFiles: local, character: 'Aldenmar', parts, knownChars: ['Zarrin'], target: { w: 1920, h: 1080 } });

  it('the always-on parts write the layout (with chat routing), hotbars, socials, spell sets, bandolier and the character\'s Zeal sections', () => {
    const r = run(sync.defaultParts({ otherAccountsOnPc: true }));
    expect(Object.keys(r.writes).sort()).toEqual(['Aldenmar_bandolier.ini', 'Aldenmar_pq.proj.ini', 'Aldenmar_protected.ini', 'Aldenmar_spellsets.ini', 'UI_Aldenmar_pq.proj.ini', 'eqclient.ini', 'zeal.ini']);
    expect(r.writes['UI_Aldenmar_pq.proj.ini']).toMatch(/ChannelMap41=1/);
    expect(r.writes['Aldenmar_pq.proj.ini']).toMatch(/\[HotButtons\][\s\S]*\[Socials\]/);
    expect(r.writes['zeal.ini']).toMatch(/\[Aldenmar\]\r\nExtended_ChannelMaps=7/);
    expect(r.writes['zeal.ini']).toMatch(/Foo=1/);                                  // the shared [Zeal] section is the host's
    expect(r.writes['eqclient.ini']).toMatch(/\[Aldenmar\]\r\nTellWindows=1/);
    expect(r.writes['eqclient.ini']).toMatch(/KEY=9/);                              // key bindings stay the host's
    expect(r.fileParts['Aldenmar_spellsets.ini']).toEqual(['spellsets']);
    expect(r.fileParts['zeal.ini']).toEqual(['zealchar']);
  });
  it('the shared-PC tick adds the key bindings and the shared Zeal sections', () => {
    const r = run(sync.defaultParts({ otherAccountsOnPc: false }));
    expect(r.writes['eqclient.ini']).toMatch(/KEY=1/);
    expect(r.writes['zeal.ini']).toMatch(/Foo=2/);
  });
  it('defaultParts keeps the character\'s own Zeal part on a shared PC and drops only the shared two', () => {
    const p = sync.defaultParts({ otherAccountsOnPc: true });
    expect(p).toContain('zealchar');
    expect(p).not.toContain('zeal');
    expect(p).not.toContain('keybinds');
  });
});

describe('Mimic wiring for the 2026-11-11 report', () => {
  const main = stripJs(readSource(path.join(ROOT, 'apps/mimic/main.js')));
  it('ui-account-characters sends the parts list the card reads (it was never sent, so only overlays were restored)', () => {
    const b = sliceBlock(main, "ipcMain.handle('ui-account-characters'", '\n});\n');
    expect(b).toMatch(/parts:\s*uiSync\.defaultParts\(/);
  });
  it('the layout is fitted to eqclient.ini [VideoMode], else the EverQuest window, else the screen', () => {
    const t = sliceBlock(main, 'async function _uiTargetRes(local) {', '\n}\n');
    expect(t.indexOf('_eqResOf(local)')).toBeGreaterThan(-1);
    expect(t.indexOf('_eqResOf(local)')).toBeLessThan(t.indexOf('_eqMainWindow'));
    expect(t.indexOf('_eqMainWindow')).toBeLessThan(t.indexOf('_primarySize()'));
    const parts = sliceBlock(main, "ipcMain.handle('ui-restore-parts'", '\n});\n');
    expect(parts).toMatch(/_uiTargetRes\(_readUiBundle\(eqDir, character\)\)/);
    expect(parts).toMatch(/_uiWriteRestore\(\{[^}]*target/);
  });
  it('the restore answer names the files written and the parts behind each', () => {
    const parts = sliceBlock(main, "ipcMain.handle('ui-restore-parts'", '\n});\n');
    expect(parts).toMatch(/files,/);
    expect(sliceBlock(main, 'function _uiWriteRestore(entry, backupTag) {', '\n}\n')).toMatch(/written\.fileParts = r\.fileParts/);
  });
  it('UI Studio can be opened on one character\'s chat routing', () => {
    expect(main).toMatch(/ipcMain\.handle\('open-ui-studio', \(_e, goto\)/);
    expect(readSource(path.join(ROOT, 'apps/mimic/preload.js'))).toMatch(/onUiStudioGoto:/);
    const html = stripJs(readSource(path.join(ROOT, 'apps/mimic/ui-studio.html')));
    expect(html).toMatch(/onUiStudioGoto\(function\(goto\)/);
    expect(html).toMatch(/inspectSocialsBtn'\)\.click\(\)/);
  });
});

describe('the bring-in card (behaviour, a stub page)', () => {
  const src = readSource(path.join(ROOT, 'apps/mimic/bring-setup.js'));
  // A page just big enough for the card: innerHTML is kept, listeners are captured by selector.
  function page() {
    const handlers = {}, stubs = {};
    const el = {
      html: '',
      set innerHTML(v) { this.html = v; }, get innerHTML() { return this.html; },
      querySelector(sel) { return stubs[sel] || (stubs[sel] = { style: {}, checked: false, dataset: {}, addEventListener(ev, fn) { handlers[sel + ev] = fn; } }); },
      querySelectorAll(sel) {
        if (sel !== '[data-wpbs-chat]') return [];
        return [...this.html.matchAll(/data-wpbs-chat="([^"]+)"/g)].map(m => ({ dataset: { wpbsChat: m[1] }, addEventListener(ev, fn) { handlers['chat:' + m[1]] = fn; } }));
      },
    };
    return { el, handlers, stubs };
  }
  const tick = async () => { for (let i = 0; i < 12; i++) await new Promise(r => setTimeout(r, 0)); };
  function boot({ parts, restore, all = false } = {}) {
    const calls = { restore: [], studio: [] };
    let onPc = false;
    const mimic = {
      uiAccountCharacters: async () => ({ ok: true, eqDir: 'C:/EQ', otherAccountsOnPc: true, parts,
        characters: [{ character: 'Aldenmar', onThisPc: onPc, latestFull: { id: 'b1', created_at: '2026-11-10T00:00:00Z', source_width: 1920, source_height: 1080 }, machines: [], local: [] }] }),
      uiRestorePlan: async () => ({ ok: true, parts: ['layout', 'hotkeys', 'socials', 'spellsets', 'zealchar', 'zeal', 'keybinds', 'other'].map(key => ({ key, inBackup: 1 })) }),
      uiRestoreParts: async (p) => { calls.restore.push(p); onPc = true; return restore ? restore(p) : { ok: true, queued: false, files: [], savedCopies: [] }; },
      openUiStudio: async (g) => { calls.studio.push(g); return true; },
    };
    const w = { mimic };
    new Function('window', src)(w);
    return { w, calls };
  }
  const click = async (pg) => { pg.handlers['[data-wpbs-go]click']({ target: { disabled: false } }); await tick(); };

  it('restores the character\'s own parts even when the account answer carries no parts list, never the shared two unticked', async () => {
    const { w, calls } = boot({ parts: undefined, all: true });
    const pg = page();
    await w.wpBringSetup.mount(pg.el, { all: true });
    await click(pg);
    expect(calls.restore).toHaveLength(1);
    const parts = calls.restore[0].parts;
    expect(parts).toEqual(expect.arrayContaining(['layout', 'hotkeys', 'socials', 'spellsets', 'zealchar', 'other']));
    expect(parts).not.toContain('keybinds');
    expect(parts).not.toContain('zeal');
  });
  it('the key bindings tick adds keybinds and the shared Zeal part', async () => {
    const { w, calls } = boot({ parts: ['layout', 'zealchar'] });
    const pg = page();
    await w.wpBringSetup.mount(pg.el, {});
    pg.stubs['[data-wpbs-keys]'].checked = true;
    await click(pg);
    expect(calls.restore[0].parts).toEqual(expect.arrayContaining(['layout', 'zealchar', 'keybinds', 'zeal']));
  });
  it('shows how many files were updated, which ones, the safety copy, and keeps the ticks (FB-123)', async () => {
    const { w } = boot({
      parts: ['layout', 'hotkeys'], all: true,
      restore: () => ({ ok: true, queued: false, savedCopies: ['eqclient.ini.mimic-20261111-050000.bak'], target: { w: 1920, h: 1080, from: 'eqclient.ini' },
        files: [{ name: 'UI_Aldenmar_pq.proj.ini', parts: ['Window layout'] }, { name: 'Aldenmar_pq.proj.ini', parts: ['Hotkeys', 'Socials'] }] }),
    });
    const pg = page();
    await w.wpBringSetup.mount(pg.el, { all: true });
    await click(pg);
    const h = pg.el.html;
    expect(h).toContain('2 files updated');
    expect(h).toContain('UI_Aldenmar_pq.proj.ini');
    expect(h).toContain('(Hotkeys, Socials)');
    expect(h).toContain('Saved a copy of eqclient.ini first');
    expect(h).toContain('fitted to 1920×1080');
    // The character is on this PC now, which un-ticks it by default; the member's tick must survive the re-read.
    expect(h).toMatch(/data-pick="aldenmar" checked/);
  });
  it('a queued character says it applies when that character camps; a done one offers "Sort your chat channels"', async () => {
    const q = boot({ parts: ['layout'], restore: () => ({ ok: true, queued: true, busy: 'camp' }) });
    const pq = page();
    await q.w.wpBringSetup.mount(pq.el, {});
    await click(pq);
    expect(pq.el.html).toContain('apply when Aldenmar camps');
    expect(pq.el.html).not.toContain('data-wpbs-chat');
    const d = boot({ parts: ['layout'], all: true, restore: () => ({ ok: true, queued: false, files: [{ name: 'a.ini', parts: [] }], savedCopies: [] }) });
    const pd = page();
    await d.w.wpBringSetup.mount(pd.el, { all: true });
    await click(pd);
    expect(pd.el.html).toContain('Sort your chat channels');
    pd.handlers['chat:Aldenmar']();
    expect(d.calls.studio).toEqual([{ character: 'Aldenmar', eqDir: 'C:/EQ', chat: true }]);
  });
});
