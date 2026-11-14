// UI Studio "Keep in sync" decisions (apps/mimic/uiSync.js; the guild lead, 2026-11-01). Behaviour only.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import { stripJs, sliceBlock, evalBlock } from './_source-slice.js';

const require = createRequire(import.meta.url);
const sync = require('../apps/mimic/uiSync.js');

describe('an automatic backup leaves chat-channel passwords out', () => {
  const eqclient = '[Defaults]\r\nChannelAutoJoin=raid:secret\r\nSound=TRUE\r\n[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nKEYMAPPING_JUMP_1=32\r\n';
  const zeal = '[Zeal]\nCamera=1\nChatPassword=abc\n[ChannelAutoJoin_Aldenmar]\nraid=secret\n[TellWindows_Aldenmar]\nEnabled=TRUE\n';
  const out = sync.redactForAutoBackup({ 'eqclient.ini': eqclient, 'zeal.ini': zeal, 'Aldenmar_pq.proj.ini': '[Socials]\nPassword=kept here\n' });

  it('drops the keys and whole sections, keeps the rest byte for byte', () => {
    expect(out['eqclient.ini']).toBe('[Defaults]\r\nSound=TRUE\r\n[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nKEYMAPPING_JUMP_1=32\r\n');
    expect(out['zeal.ini']).toBe('[Zeal]\nCamera=1\n[TellWindows_Aldenmar]\nEnabled=TRUE\n');
  });
  it('touches only eqclient.ini and zeal.ini', () => {
    expect(out['Aldenmar_pq.proj.ini']).toBe('[Socials]\nPassword=kept here\n');
  });
});

describe('bundleHash', () => {
  it('is the same for the same files in any order and changes with any text', () => {
    const a = sync.bundleHash({ 'a.ini': 'x', 'B.ini': 'y' });
    expect(sync.bundleHash({ 'B.ini': 'y', 'a.ini': 'x' })).toBe(a);
    expect(sync.bundleHash({ 'a.ini': 'x', 'B.ini': 'y ' })).not.toBe(a);
  });
});

describe('newerElsewhere: which backup is a newer copy from another PC', () => {
  const t = (iso) => Date.parse(iso);
  const snaps = [
    { id: 'm2', machine_name: 'LAPTOP', created_at: '2026-11-01T12:00:00Z' },
    { id: 'm1', machine_name: 'desktop', created_at: '2026-11-01T13:00:00Z' },
    { id: 'm0', machine_name: null, created_at: '2026-11-01T14:00:00Z' },
  ];
  it('takes the newest from another machine, ignoring this one and nameless backups', () => {
    expect(sync.newerElsewhere(snaps, { machine: 'Desktop', since: t('2026-11-01T00:00:00Z') }).id).toBe('m2');
  });
  it('ignores backups made before sync was switched on or before this PC last synced', () => {
    expect(sync.newerElsewhere(snaps, { machine: 'desktop', since: t('2026-11-01T12:30:00Z') })).toBe(null);
    expect(sync.newerElsewhere(snaps, { machine: 'desktop', since: 1, lastSyncAt: t('2026-11-01T12:30:00Z') })).toBe(null);
  });
  it('offers one backup once', () => {
    expect(sync.newerElsewhere(snaps, { machine: 'desktop', since: 1, seenId: 'm2' })).toBe(null);
  });
});

describe('suggestScale', () => {
  it('is 100% on the screen overlays were made on', () => {
    expect(sync.suggestScale({ width: 1920, height: 1080, inches: 24 }).percent).toBe(100);
  });
  it('grows on a sharper screen and leaves Windows scaling to do its own part', () => {
    expect(sync.suggestScale({ width: 2560, height: 1440, inches: 27 }).percent).toBe(120);
    expect(sync.suggestScale({ width: 3840, height: 2160, scaleFactor: 1.5, inches: 32 }).percent).toBe(100);
  });
  it('without a size, goes halfway towards the resolution, within 80–160%', () => {
    expect(sync.suggestScale({ width: 2560, height: 1440 }).percent).toBe(115);
    expect(sync.suggestScale({ width: 7680, height: 4320 }).percent).toBe(160);
    expect(sync.suggestScale({ width: 0, height: 0 })).toBe(null);
  });
});

describe('cleanSyncCfg', () => {
  it('backs up after camp unless switched off (2026-11-11), asks about newer copies, keybinds left out', () => {
    const c = sync.cleanSyncCfg(undefined);
    expect(c).toMatchObject({ autoBackup: true, newer: 'ask', since: 0 });
    expect(sync.cleanSyncCfg({ autoBackup: false }).autoBackup).toBe(false);
    expect(c.parts).not.toContain('keybinds');
  });
  it('refuses unknown modes', () => {
    expect(sync.cleanSyncCfg({ newer: 'sometimes' }).newer).toBe('ask');
  });
});

// main.js wiring: these cannot run without Electron, so the source is checked (comments stripped).
describe('main.js wiring', () => {
  const main = fs.readFileSync(new URL('../apps/mimic/main.js', import.meta.url), 'utf8');
  it('a camp schedules the automatic backup', () => {
    const retire = stripJs(sliceBlock(main, 'function _retireZealChar(character, why, swappedTo) {', '\n}\n'));
    expect(retire).toMatch(/_uiScheduleAutoBackup\(character\)/);
  });
  it('the automatic backup is redacted and skipped when nothing changed', () => {
    const auto = stripJs(sliceBlock(main, 'async function _uiAutoBackup(character) {', '\n}\n'));
    expect(auto).toMatch(/uiSync\.redactForAutoBackup\(/);
    expect(auto.indexOf('lastHash === hash')).toBeLessThan(auto.indexOf('_uiUploadBundle('));
  });
  it('a restore with keybinds waits for every EverQuest to close', () => {
    const tick = stripJs(sliceBlock(main, 'async function _tickUiDeferred() {', '\n}\n'));
    expect(tick).toMatch(/entry\.kind === 'restore' && !ownOnly/);
    const needs = stripJs(sliceBlock(main, 'function _uiNeedsEqClosed(parts) {', '\n}\n'));
    expect(needs).toMatch(/'keybinds'/);
    expect(needs).toMatch(/'zeal'/);
  });
  it('a restore of only the character\'s own files does not wait for ANOTHER character\'s EverQuest (FB-126/127)', () => {
    const { _uiNeedsEqClosed } = evalBlock(sliceBlock(main, 'function _uiNeedsEqClosed(parts) {', '\n}\n'), ['_uiNeedsEqClosed']);
    expect(_uiNeedsEqClosed(['layout', 'hotkeys', 'socials', 'spellsets', 'other', 'overlays'])).toBe(false);
    expect(_uiNeedsEqClosed(['layout', 'keybinds'])).toBe(true);
    expect(_uiNeedsEqClosed(['layout', 'zeal'])).toBe(true);
    // The character's own Zeal sections live INSIDE eqclient.ini / zeal.ini, which a running client rewrites.
    expect(_uiNeedsEqClosed(['zealchar'])).toBe(true);
    expect(_uiNeedsEqClosed(undefined)).toBe(true);               // unknown parts: assume the strict case
    const busy = stripJs(sliceBlock(main, 'async function _uiEqBusyFor(character, parts, eqDir) {', '\n}\n'));
    expect(busy.indexOf('_uiCharActiveInZeal')).toBeLessThan(busy.indexOf('_uiNeedsEqClosed'));
    expect(busy).toMatch(/_uiCharLogFresh\(eqDir, cl\)/);          // in game with the pipe down still counts as camp
  });
  it('says what the queue will really wait for: a shared-file half waits for EverQuest to close even for the logged-in character', async () => {
    const busyFor = (live, up, fresh) => evalBlock(
      `const _uiCharActiveInZeal = () => ${live}; const _isEqRunning = async () => ${up}; const _uiCharLogFresh = () => ${fresh};\n`
      + sliceBlock(main, 'function _uiNeedsEqClosed(parts) {', '\n}\n')
      + sliceBlock(main, 'async function _uiEqBusyFor(character, parts, eqDir) {', '\n}\n'), ['_uiEqBusyFor'])._uiEqBusyFor;
    expect(await busyFor(true, true, false)('Aldenmar', ['layout', 'hotkeys'], 'd')).toBe('camp');
    expect(await busyFor(true, true, false)('Aldenmar', ['zealchar'], 'd')).toBe('close');
    expect(await busyFor(true, true, false)('Aldenmar', ['keybinds', 'zeal'], 'd')).toBe('close');
    expect(await busyFor(true, true, false)('Aldenmar', undefined, 'd')).toBe('camp');        // the compare card: the character as a whole
    expect(await busyFor(false, true, false)('Aldenmar', ['keybinds'], 'd')).toBe('close');
    expect(await busyFor(false, true, true)('Aldenmar', ['layout'], 'd')).toBe('camp');       // in game with the pipe down
    expect(await busyFor(false, true, false)('Aldenmar', ['layout'], 'd')).toBe(null);        // someone else's client is running
    expect(await busyFor(false, false, true)('Aldenmar', ['keybinds'], 'd')).toBe(null);
  });
  it('a restore runs in two halves: own files now or at camp, shared-file parts when EverQuest closes, and the queue keeps both', () => {
    const h = stripJs(sliceBlock(main, "ipcMain.handle('ui-restore-parts', async (_e, params) => {", '\n});\n'));
    expect(h).toMatch(/const halves = \[parts\.filter\(k => !_uiNeedsEqClosed\(\[k\]\)\), parts\.filter\(k => _uiNeedsEqClosed\(\[k\]\)\)\]/);
    expect(h).toMatch(/const busy = await _uiEqBusyFor\(character, g, eqDir\);/);
    expect(h).toMatch(/queuedParts: queued/);
    // a half that waits carries "made on this computer" with it, so it is not re-fitted when it lands
    expect(h).toMatch(/_queueUiRestore\(\{[^}]*target, sameMachine \}\)/);
    expect(h).toMatch(/_uiWriteRestore\(\{[^}]*target, sameMachine \}\)/);
    const q = stripJs(sliceBlock(main, 'function _queueUiRestore(entry) {', '\n}\n'));
    expect(q).toMatch(/_uiNeedsEqClosed\(e\.parts\) === shared/);
  });
  it('the old single Zeal choice still brings the character\'s own Zeal settings', () => {
    expect(sync.cleanSyncCfg({ parts: ['layout', 'zeal'] }).parts).toEqual(expect.arrayContaining(['zeal', 'zealchar']));
    expect(sync.cleanSyncCfg({ parts: ['layout'] }).parts).not.toContain('zealchar');
    expect(sync.cleanSyncCfg({}).parts).toContain('zealchar');
  });
  it('a queued restore survives a restart', () => {
    const load = stripJs(sliceBlock(main, 'function _loadUiDeferred() {', '\n}\n'));
    expect(load).toMatch(/e\.kind === 'restore'/);
  });
});
