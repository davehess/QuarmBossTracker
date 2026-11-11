// UI Studio "Keep in sync" decisions (apps/mimic/uiSync.js; the guild lead, 2026-11-01). Behaviour only.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import { stripJs, sliceBlock } from './_source-slice.js';

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
    expect(tick).toMatch(/entry\.kind === 'restore' && \(entry\.parts \|\| \[\]\)\.includes\('keybinds'\)/);
  });
  it('a queued restore survives a restart', () => {
    const load = stripJs(sliceBlock(main, 'function _loadUiDeferred() {', '\n}\n'));
    expect(load).toMatch(/e\.kind === 'restore'/);
  });
});
