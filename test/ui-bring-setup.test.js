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
