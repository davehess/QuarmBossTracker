// The compare-first UI restore plan (apps/mimic/uiRestorePlan.js): which files/sections belong to each
// part, what differs, and that a restore writes only the parts picked, merged into the current files.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PARTS, parseSections, classify, fitLayout, compare, buildRestore, windowRects,
} = require('../apps/mimic/uiRestorePlan.js');

const C = 'Aldenmar';
const CHAR = 'Aldenmar_pq.proj.ini';

const filesFor = (extra = {}) => ({
  'UI_Aldenmar_pq.proj.ini': '[Main]\r\nXPos1920x1080=10\r\nYPos1920x1080=20\r\n',
  [CHAR]: '[HotButtons]\r\nPage1Button1Name=Heal\r\n[Socials]\r\nPage1Button1Name=Hi\r\n[Options]\r\nTheme=1\r\n',
  'Sock_Aldenmar_pq.proj.ini': '[Socials]\r\nA=1\r\n',
  'Socials_Aldenmar_pq.proj.ini': '[Socials]\r\nA=2\r\n',
  'Aldenmar_spellsets.ini': '[Set1]\r\nGem1=Heal\r\n',
  'Aldenmar_bandolier.ini': '[Band]\r\nA=1\r\n',
  'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nFORWARD=87\r\n',
  'zeal.ini': '[Zeal]\r\nFoo=1\r\n',
  'UI_Brackwyn_pq.proj.ini': '[Main]\r\nXPos=1\r\n',
  'Brackwyn_pq.proj.ini': '[HotButtons]\r\nX=1\r\n',
  'notes.txt': 'nope',
  ...extra,
});
const filesOf = (cls, key) => cls[key].map((e) => e.file).sort();

describe('PARTS', () => {
  it('lists the parts in order, keybinds as the only shared one', () => {
    expect(PARTS.map((p) => p.key)).toEqual(['layout', 'hotkeys', 'socials', 'spellsets', 'keybinds', 'zealchar', 'zeal', 'other']);
    expect(PARTS.filter((p) => p.scope === 'all').map((p) => p.key)).toEqual(['keybinds']);
  });
});

describe('parseSections', () => {
  it('handles BOM, CRLF/LF, comments, blank lines and pre-section lines', () => {
    const s = parseSections('﻿stray=1\r\n; note\n# note\n\n[One]\r\nA = 1 \nB=x=y\n[Two]\n');
    expect(s).toEqual([
      { name: '', keys: [{ key: 'stray', value: '1' }] },
      { name: 'One', keys: [{ key: 'A', value: '1' }, { key: 'B', value: 'x=y' }] },
      { name: 'Two', keys: [] },
    ]);
  });
});

describe('classify', () => {
  const cls = classify(filesFor(), C, { knownChars: ['Brackwyn', 'Corvale'] });

  it('puts each file under its part with the right mode', () => {
    expect(cls.layout).toMatchObject([{ file: 'UI_Aldenmar_pq.proj.ini', mode: 'whole' }]);
    expect(filesOf(cls, 'spellsets')).toEqual(['Aldenmar_spellsets.ini']);
    expect(cls.spellsets[0].mode).toBe('whole');
    expect(cls.hotkeys).toMatchObject([{ file: CHAR, mode: 'sections' }]);
    expect(filesOf(cls, 'socials')).toEqual([CHAR, 'Sock_Aldenmar_pq.proj.ini', 'Socials_Aldenmar_pq.proj.ini'].sort());
    expect(cls.socials.find((e) => e.file === 'Sock_Aldenmar_pq.proj.ini').mode).toBe('whole');
    expect(cls.keybinds).toMatchObject([{ file: 'eqclient.ini', mode: 'keys' }]);
    expect(filesOf(cls, 'zeal')).toEqual(['eqclient.ini', 'zeal.ini']);
    expect(filesOf(cls, 'zealchar')).toEqual(['eqclient.ini', 'zeal.ini']);
    expect(cls.zeal.concat(cls.zealchar).every((e) => e.mode === 'keys')).toBe(true);
  });

  it('selects sections by name', () => {
    const hot = cls.hotkeys[0].test, soc = cls.socials.find((e) => e.file === CHAR).test;
    const oth = cls.other.find((e) => e.file === CHAR).test;
    expect([hot('HotButtons'), hot('HotButtons2'), hot('Socials'), hot('Options')]).toEqual([true, true, false, false]);
    expect([soc('Socials'), soc('HotButtons'), soc('Options')]).toEqual([true, false, false]);
    expect([oth('Options'), oth('HotButtons'), oth('HotButtons2'), oth('Socials')]).toEqual([true, false, false, false]);
  });

  it('sends other per-character inis to "other" whole, and nothing claims another character or a non-ini', () => {
    expect(cls.other.find((e) => e.file === 'Aldenmar_bandolier.ini').mode).toBe('whole');
    const all = Object.values(cls).flat().map((e) => e.file);
    expect(all.some((f) => /Brackwyn/.test(f))).toBe(false);
    expect(all).not.toContain('notes.txt');
  });

  it('keeps a short name from claiming a longer one (Al vs Aldenmar)', () => {
    const al = classify(filesFor({ 'UI_Al_pq.proj.ini': '[Main]\r\n' }), 'Al');
    expect(Object.values(al).flat().map((e) => e.file)).toEqual(
      expect.not.arrayContaining(['UI_Aldenmar_pq.proj.ini', CHAR, 'Aldenmar_spellsets.ini']));
    expect(filesOf(al, 'layout')).toEqual(['UI_Al_pq.proj.ini']);
    const full = classify(filesFor({ 'UI_Al_pq.proj.ini': '[Main]\r\n' }), 'Aldenmar');
    expect(filesOf(full, 'layout')).toEqual(['UI_Aldenmar_pq.proj.ini']);
  });

  it('only ever classifies the KeyMaps section of eqclient.ini', () => {
    const t = cls.keybinds[0].test;
    expect([t('KeyMaps'), t('keymaps'), t('VideoMode'), t('Defaults'), t('ChannelAutoJoin')]).toEqual([true, true, false, false, false]);
    expect(filesOf(cls, 'other')).not.toContain('eqclient.ini');
  });

  // The real layout (a member's files, 2026-11-01): eqclient.ini carries a shared [Zeal] and a [<Char>] TellWindows
  // section per character; zeal.ini has bare [<Char>] sections holding only TellWindows keys, for characters this PC
  // may have no files for.
  // The Zeal part is split (a member, 2026-11-11, FB-124 / FB-127): the character's OWN sections are 'zealchar', always
  // brought in; only the shared ones stay in 'zeal', behind the shared-PC tick.
  it('zeal covers eqclient.ini [Zeal] only; the character\'s own section there is zealchar', () => {
    const t = cls.zeal.find((e) => e.file === 'eqclient.ini').test;
    expect([t('Zeal'), t('Aldenmar'), t('Brackwyn'), t('KeyMaps'), t('VideoMode'), t('Defaults')]).toEqual([true, false, false, false, false, false]);
    const o = cls.zealchar.find((e) => e.file === 'eqclient.ini').test;
    expect([o('Zeal'), o('Aldenmar'), o('Brackwyn'), o('KeyMaps')]).toEqual([false, true, false, false]);
  });

  it('zeal: a bare TellWindows-only section is a character, restored only for this one (as zealchar)', () => {
    const z = '[Zeal]\r\nCamera=1\r\n[Holdfast]\r\nTellWindows=1\r\nTellWindowsHist=0\r\n[Aldenmar]\r\nTellWindows=1\r\n[AutoFollow]\r\nEnable=1\r\n';
    const k = classify({ 'zeal.ini': z }, C);
    const t = k.zeal[0].test, o = k.zealchar[0].test;
    expect([t('Holdfast'), t('Aldenmar'), t('AutoFollow'), t('Zeal')]).toEqual([false, false, true, true]);
    expect([o('Holdfast'), o('Aldenmar'), o('AutoFollow'), o('Zeal')]).toEqual([false, true, false, false]);
  });

  it('zeal: global sections in, this character\'s, other known characters\' and ChannelAutoJoin out', () => {
    const t = cls.zeal.find((e) => e.file === 'zeal.ini').test;
    expect(t('RaidBars')).toBe(true);
    expect(t('Zeal')).toBe(true);
    expect(t('TellWindows_Aldenmar')).toBe(false);       // the character's own: zealchar
    expect(t('Aldenmar')).toBe(false);
    expect(t('TellWindows_Brackwyn')).toBe(false);
    expect(t('Corvale')).toBe(false);
    expect(t('ChannelAutoJoin_Aldenmar')).toBe(false);
    expect(t('ChannelAutoJoin')).toBe(false);
    const k = cls.zeal.find((e) => e.file === 'zeal.ini').keyTest;
    expect([k('Foo'), k('ChannelAutoJoin1'), k('ServerPassword'), k('PASSWORD')]).toEqual([true, false, false, false]);
  });

  it('zealchar: only this character\'s sections of zeal.ini, never a password or another character', () => {
    const t = cls.zealchar.find((e) => e.file === 'zeal.ini').test;
    expect([t('TellWindows_Aldenmar'), t('Aldenmar'), t('RaidBars'), t('Zeal'), t('TellWindows_Brackwyn'), t('Corvale'), t('ChannelAutoJoin_Aldenmar')])
      .toEqual([true, true, false, false, false, false, false]);
    const k = cls.zealchar.find((e) => e.file === 'zeal.ini').keyTest;
    expect([k('Foo'), k('ChannelAutoJoin1'), k('ServerPassword')]).toEqual([true, false, false]);
  });

  it('skips names the guard would not restore', () => {
    const odd = classify({ '../UI_Aldenmar_pq.proj.ini': 'x', 'UI_Aldenmar_pq.proj.ini.bak': 'x' }, C);
    expect(Object.values(odd).flat()).toEqual([]);
  });
});

describe('buildRestore', () => {
  const local = {
    [CHAR]: '[HotButtons]\r\nPage1Button1Name=Mine\r\n[Socials]\r\nPage1Button1Name=MySocial\r\n[Options]\r\nTheme=9\r\n',
  };
  const backup = {
    [CHAR]: '[HotButtons]\r\nPage1Button1Name=Heal\r\nPage2Button3Name=Root\r\n[Socials]\r\nPage1Button1Name=Hi\r\n[Options]\r\nTheme=1\r\n',
  };

  it('hotkeys-only changes [HotButtons] and leaves the rest byte-identical', () => {
    const r = buildRestore({ backupFiles: backup, localFiles: local, character: C, parts: ['hotkeys'] });
    expect(r.writes[CHAR]).toBe(
      '[HotButtons]\r\nPage1Button1Name=Heal\r\nPage2Button3Name=Root\r\n[Socials]\r\nPage1Button1Name=MySocial\r\n[Options]\r\nTheme=9\r\n');
    expect(r.skipped).toEqual([]);
  });

  it('keeps the local file line endings (LF local, CRLF backup)', () => {
    const lf = { [CHAR]: '[HotButtons]\nPage1Button1Name=Mine\n[Options]\nTheme=9\n' };
    const r = buildRestore({ backupFiles: backup, localFiles: lf, character: C, parts: ['hotkeys'] });
    expect(r.writes[CHAR]).toBe('[HotButtons]\nPage1Button1Name=Heal\nPage2Button3Name=Root\n[Options]\nTheme=9\n');
    expect(r.writes[CHAR]).not.toContain('\r');
  });

  it('appends a socials section that is missing locally', () => {
    const noSoc = { [CHAR]: '[HotButtons]\r\nA=1\r\n[Options]\r\nTheme=9\r\n' };
    const r = buildRestore({ backupFiles: backup, localFiles: noSoc, character: C, parts: ['socials'] });
    expect(r.writes[CHAR]).toBe('[HotButtons]\r\nA=1\r\n[Options]\r\nTheme=9\r\n[Socials]\r\nPage1Button1Name=Hi\r\n');
  });

  it('removes a selected section that the backup does not have', () => {
    const bk = { [CHAR]: '[HotButtons]\r\nPage1Button1Name=Heal\r\n[Options]\r\nTheme=1\r\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: local, character: C, parts: ['socials'] });
    expect(r.writes[CHAR]).toBe('[HotButtons]\r\nPage1Button1Name=Mine\r\n[Options]\r\nTheme=9\r\n');
  });

  it('composes hotkeys + socials on one file', () => {
    const r = buildRestore({ backupFiles: backup, localFiles: local, character: C, parts: ['hotkeys', 'socials'] });
    expect(r.writes[CHAR]).toBe(
      '[HotButtons]\r\nPage1Button1Name=Heal\r\nPage2Button3Name=Root\r\n[Socials]\r\nPage1Button1Name=Hi\r\n[Options]\r\nTheme=9\r\n');
  });

  it('other restores the remaining sections and not hotkeys or socials', () => {
    const r = buildRestore({ backupFiles: backup, localFiles: local, character: C, parts: ['other'] });
    expect(r.writes[CHAR]).toBe(
      '[HotButtons]\r\nPage1Button1Name=Mine\r\n[Socials]\r\nPage1Button1Name=MySocial\r\n[Options]\r\nTheme=1\r\n');
  });

  it('does not include a file that would end identical', () => {
    const r = buildRestore({ backupFiles: backup, localFiles: backup, character: C, parts: ['hotkeys', 'socials', 'other'] });
    expect(r.writes).toEqual({});
    const sameBlock = buildRestore({
      backupFiles: { [CHAR]: '[HotButtons]\r\nA=1\r\n' }, localFiles: { [CHAR]: '[HotButtons]\r\nA=1\r\n\r\n[Options]\r\nT=1' },
      character: C, parts: ['hotkeys'],
    });
    expect(sameBlock.writes).toEqual({});
  });

  it('whole parts write under the local file real name (case-insensitive match)', () => {
    const bk = { 'UI_Aldenmar_pq.proj.ini': '[Main]\r\nXPos1920x1080=5\r\n' };
    const lo = { 'ui_aldenmar_PQ.proj.ini': '[Main]\r\nXPos1920x1080=9\r\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['layout'] });
    expect(Object.keys(r.writes)).toEqual(['ui_aldenmar_PQ.proj.ini']);
    expect(r.writes['ui_aldenmar_PQ.proj.ini']).toBe(bk['UI_Aldenmar_pq.proj.ini']);
  });

  it('layout restore adds this PC resolution block', () => {
    const bk = { 'UI_Aldenmar_pq.proj.ini': '[Main]\r\nXPos2560x1440=1000\r\nYPos2560x1440=500\r\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: {}, character: C, parts: ['layout'], target: { w: 1920, h: 1080 } });
    expect(r.writes['UI_Aldenmar_pq.proj.ini']).toContain('XPos1920x1080=750');
    expect(r.writes['UI_Aldenmar_pq.proj.ini']).toContain('YPos1920x1080=375');
  });

  it('keybinds merges only [KeyMaps] keys and never touches [VideoMode]', () => {
    const lo = { 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nFORWARD=1\r\nKEEP=5\r\n[Defaults]\r\nA=1\r\n' };
    const bk = {
      'eqclient.ini': '[VideoMode]\r\nWidth=640\r\nFullscreen=1\r\n[KeyMaps]\r\nFORWARD=87\r\nBACK=83\r\n[Defaults]\r\nA=2\r\n',
    };
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['keybinds'] });
    expect(r.writes['eqclient.ini']).toBe(
      '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nFORWARD=87\r\nKEEP=5\r\nBACK=83\r\n[Defaults]\r\nA=1\r\n');
  });

  it('keybinds with no local eqclient.ini creates only [KeyMaps]', () => {
    const bk = { 'eqclient.ini': '[VideoMode]\nWidth=640\n[KeyMaps]\nFORWARD=87\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: {}, character: C, parts: ['keybinds'] });
    expect(r.writes['eqclient.ini']).toBe('[KeyMaps]\nFORWARD=87\n');
  });

  it('zeal never writes ChannelAutoJoin or password keys, nor other characters sections', () => {
    const bk = {
      'zeal.ini': [
        '[Zeal]', 'Foo=2', 'ServerPassword=hunter2', 'ChannelAutoJoin1=gu secret',
        '[ChannelAutoJoin_Aldenmar]', 'Chan=1', 'Password=zzz',
        '[TellWindows_Aldenmar]', 'X=5', 'MyPassWord=nope',
        '[TellWindows_Corvale]', 'X=7', '',
      ].join('\r\n'),
    };
    const lo = { 'zeal.ini': '[Zeal]\r\nFoo=1\r\n' };
    const r = buildRestore({
      backupFiles: bk, localFiles: lo, character: C, parts: ['zeal', 'zealchar'], knownChars: ['Aldenmar', 'Corvale'],
    });
    const out = r.writes['zeal.ini'];
    expect(out).toBe('[Zeal]\r\nFoo=2\r\n[TellWindows_Aldenmar]\r\nX=5\r\n');
    expect(out).not.toMatch(/password|ChannelAutoJoin|Corvale|hunter2/i);
  });

  it('zealchar alone brings the character\'s own Zeal sections and leaves the shared ones as they are', () => {
    const bk = { 'zeal.ini': '[Zeal]\r\nFoo=2\r\n[TellWindows_Aldenmar]\r\nX=5\r\n[Aldenmar]\r\nExtended=7\r\n' };
    const lo = { 'zeal.ini': '[Zeal]\r\nFoo=1\r\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['zealchar'], knownChars: ['Corvale'] });
    expect(r.writes['zeal.ini']).toBe('[Zeal]\r\nFoo=1\r\n[TellWindows_Aldenmar]\r\nX=5\r\n[Aldenmar]\r\nExtended=7\r\n');
    expect(r.fileParts['zeal.ini']).toEqual(['zealchar']);
    // ...and 'zeal' alone brings the shared sections but not the character's.
    const s = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['zeal'], knownChars: ['Corvale'] });
    expect(s.writes['zeal.ini']).toBe('[Zeal]\r\nFoo=2\r\n');
  });

  it('reports which parts changed each written file', () => {
    const r = buildRestore({ backupFiles: backup, localFiles: local, character: C, parts: ['hotkeys', 'socials'] });
    expect(Object.keys(r.fileParts)).toEqual(Object.keys(r.writes));
    for (const parts of Object.values(r.fileParts)) expect(parts.length).toBeGreaterThan(0);
  });

  it('reports names it will not write as skipped', () => {
    const r = buildRestore({
      backupFiles: { ...backup, '../evil.ini': 'x', 'run.bat': 'x' }, localFiles: local, character: C, parts: ['hotkeys'],
    });
    expect(r.skipped.sort()).toEqual(['../evil.ini', 'run.bat']);
    expect(Object.keys(r.writes)).toEqual([CHAR]);
  });

  it('a part that is not selected is not touched', () => {
    const r = buildRestore({ backupFiles: filesFor(), localFiles: {}, character: C, parts: [] });
    expect(r.writes).toEqual({});
  });
});

describe('fitLayout', () => {
  const src = [
    '[Chat]', 'XPos2560x1440=1280', 'YPos2560x1440=720', 'Width=300',
    '[Map]', 'XPos2560x1440=2500', 'YPos2560x1440=1400', 'XPos1920x1080=40', 'YPos1920x1080=50',
    '[Buffs]', 'XPos2560x1440=0', 'YPos2560x1440=0', '',
  ].join('\r\n');

  it('adds a scaled target block, clamps, and leaves a section that already has it alone', () => {
    const r = fitLayout(src, 1920, 1080);
    expect(r.sourceRes).toBe('2560x1440');
    expect(r.added).toBe(2);
    const sec = Object.fromEntries(parseSections(r.text).map((s) => [s.name, Object.fromEntries(s.keys.map((k) => [k.key, k.value]))]));
    expect(sec.Chat).toMatchObject({ XPos1920x1080: '960', YPos1920x1080: '540', XPos2560x1440: '1280', Width: '300' });
    expect(sec.Buffs).toMatchObject({ XPos1920x1080: '0', YPos1920x1080: '0' });
    expect(sec.Map).toMatchObject({ XPos1920x1080: '40', YPos1920x1080: '50' });   // untouched
    expect(r.text).toContain('\r\n');
    expect(r.text.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  it('clamps a window that would sit off the new screen', () => {
    const r = fitLayout('[Far]\nXPos2560x1440=2560\nYPos2560x1440=1440\n[Anchor]\nXPos2560x1440=0\nYPos2560x1440=0\n', 1920, 1080);
    const far = parseSections(r.text).find((s) => s.name === 'Far');
    expect(far.keys.find((k) => k.key === 'XPos1920x1080').value).toBe('1840');
    expect(far.keys.find((k) => k.key === 'YPos1920x1080').value).toBe('1000');
    expect(r.text).not.toContain('\r');
  });

  it('is a no-op (count 0, same text) when every window already has the block', () => {
    const once = fitLayout(src, 1920, 1080);
    const again = fitLayout(once.text, 1920, 1080);
    expect(again.added).toBe(0);
    expect(again.text).toBe(once.text);
  });

  it('old bare XPos/YPos files are used unscaled but clamped', () => {
    const r = fitLayout('[Old]\nXPos=5000\nYPos=20\n', 1920, 1080);
    expect(r.sourceRes).toBeNull();
    expect(r.added).toBe(1);
    expect(r.text).toContain('XPos1920x1080=1840');
    expect(r.text).toContain('YPos1920x1080=20');
  });

  // The guild lead, 2026-11-11: chat windows stayed off the 1080 screen because an existing target block was kept as-is.
  it('pulls a window back on screen when the target block already exists', () => {
    const r = fitLayout('[Chat]\nXPos1920x1080=2400\nYPos1920x1080=1500\n[Buffs]\nXPos1920x1080=100\nYPos1920x1080=200\n', 1920, 1080);
    const sec = Object.fromEntries(parseSections(r.text).map((s) => [s.name, Object.fromEntries(s.keys.map((k) => [k.key, k.value]))]));
    expect(Number(sec.Chat.XPos1920x1080)).toBeLessThanOrEqual(1840);
    expect(Number(sec.Chat.YPos1920x1080)).toBeLessThanOrEqual(1000);
    expect(sec.Buffs).toMatchObject({ XPos1920x1080: '100', YPos1920x1080: '200' });
    expect(r).toMatchObject({ added: 0, clamped: 1 });
  });

  it('leaves an on-screen existing block alone (no edit)', () => {
    const t = '[Chat]\r\nXPos1920x1080=1840\r\nYPos1920x1080=0\r\n';
    expect(fitLayout(t, 1920, 1080)).toMatchObject({ text: t, added: 0, clamped: 0 });
  });

  it('skips sections with no position', () => {
    const r = fitLayout('[Colors]\nRed=1\n', 1920, 1080);
    expect(r).toMatchObject({ added: 0, text: '[Colors]\nRed=1\n' });
  });
});

describe('compare', () => {
  const bk = { [CHAR]: '[HotButtons]\r\nPage1Button1Name=A\r\nPage2Button1Name=B\r\nPage2Button2Name=C\r\n[Options]\r\nT=1\r\n' };

  it('identical -> same true and "identical"', () => {
    const r = compare('hotkeys', bk, bk, C);
    expect(r).toMatchObject({ inBackup: 3, same: true, added: 0, changed: 0, removed: 0, summary: 'identical' });
  });

  it('counts a moved window and a new one', () => {
    const b = { 'UI_Aldenmar_pq.proj.ini': '[A]\r\nXPos1920x1080=10\r\n[B]\r\nXPos1920x1080=30\r\n[C]\r\nXPos1920x1080=1\r\n' };
    const l = { 'UI_Aldenmar_pq.proj.ini': '[A]\r\nXPos1920x1080=10\r\n[B]\r\nXPos1920x1080=99\r\n' };
    const r = compare('layout', b, l, C);
    expect(r).toMatchObject({ inBackup: 3, same: false, added: 1, changed: 1, removed: 0 });
    expect(r.summary).toBe('1 window moved, 1 new');
  });

  it('counts a layout that only lacks this PC resolution block as a change when a target is given', () => {
    const b = { 'UI_Aldenmar_pq.proj.ini': '[A]\r\nXPos2560x1440=100\r\nYPos2560x1440=100\r\n' };
    expect(compare('layout', b, b, C).same).toBe(true);
    const r = compare('layout', b, b, C, { target: { w: 1920, h: 1080 } });
    expect(r.same).toBe(false);
    expect(r.changed).toBe(1);
  });

  it('names the pages and buttons that differ for hotkeys', () => {
    const l = { [CHAR]: '[HotButtons]\r\nPage1Button1Name=A\r\nPage2Button1Name=X\r\nPage2Button2Name=Y\r\n' };
    expect(compare('hotkeys', bk, l, C).summary).toBe('page 2 differs (2 buttons)');
    const l5 = { [CHAR]: '[HotButtons]\r\nPage1Button1Name=Z\r\nPage2Button1Name=B\r\nPage2Button2Name=C\r\n' };
    expect(compare('hotkeys', bk, l5, C).summary).toBe('page 1 differs (1 button)');
    const lNone = { [CHAR]: '[HotButtons]\r\nPage1Button1Name=Z\r\nPage2Button1Name=Q\r\nPage2Button2Name=C\r\n' };
    expect(compare('hotkeys', bk, lNone, C).summary).toBe('pages 1, 2 differ (2 buttons)');
  });

  it('says "N new, M changed" for key parts and never counts removals for keys mode', () => {
    const b = { 'eqclient.ini': '[KeyMaps]\r\nA=1\r\nB=2\r\nC=3\r\n' };
    const l = { 'eqclient.ini': '[KeyMaps]\r\nA=1\r\nB=9\r\nExtra=4\r\n' };
    const r = compare('keybinds', b, l, C);
    expect(r).toMatchObject({ added: 1, changed: 1, removed: 0 });
    expect(r.summary).toBe('1 new, 1 changed');
  });

  it('counts a section only the local file has as removed for a section part', () => {
    const l = { [CHAR]: bk[CHAR] + '[Socials]\r\nPage1Button1Name=Hi\r\n' };
    const r = compare('socials', bk, l, C);
    expect(r).toMatchObject({ inBackup: 0, removed: 1 });
    expect(r.summary).toBe('not in this backup (restoring would remove 1)');
  });

  it('"not in this backup" when the backup has no file for the part', () => {
    const r = compare('spellsets', bk, {}, C);
    expect(r).toMatchObject({ inBackup: 0, same: false, summary: 'not in this backup' });
  });
});

describe('windowRects', () => {
  it('returns fractions of the main resolution block and skips junk', () => {
    const t = [
      '[Chat]', 'XPos1920x1080=960', 'YPos1920x1080=540', 'Width=192', 'Height=108',
      '[NoPos]', 'Width=10', 'Height=10',
      '[Bad]', 'XPos1920x1080=1', 'YPos1920x1080=1', 'Width=-5', 'Height=10',
      '[Edge]', 'XPos1920x1080=1900', 'YPos1920x1080=0', 'Width=500', 'Height=100', '',
    ].join('\r\n');
    const r = windowRects(t, 1920, 1080);
    expect(r.map((x) => x.name)).toEqual(['Chat', 'Edge']);
    expect(r[0]).toEqual({ name: 'Chat', x: 0.5, y: 0.5, w: 0.1, h: 0.1 });
    expect(r[1].x + r[1].w).toBeLessThanOrEqual(1);
  });

  it('caps the list at 80', () => {
    const t = Array.from({ length: 120 }, (_, i) => `[W${i}]\nXPos1920x1080=1\nYPos1920x1080=1\nWidth=10\nHeight=10\n`).join('');
    expect(windowRects(t, 1920, 1080)).toHaveLength(80);
  });

  it('a fitted backup previews where it lands on this PC, not where it sat on the old one', () => {
    const t = '[A]\nXPos2560x1440=1280\nYPos2560x1440=0\nWidth=256\nHeight=144\n[B]\nXPos2560x1440=0\nYPos2560x1440=720\nWidth=256\nHeight=144\n';
    const fitted = fitLayout(t, 1920, 1080).text.replace('XPos1920x1080=960', 'XPos1920x1080=0');
    const r = windowRects(fitted, 1920, 1080);
    expect(r.find(w => w.name === 'A').x).toBe(0);                // the 1920x1080 block, edited
    expect(windowRects(t, 1920, 1080).find(w => w.name === 'A').x).toBe(0.5);   // no such block: the file's own
  });
});
