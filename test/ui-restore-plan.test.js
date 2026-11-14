// The compare-first UI restore plan (apps/mimic/uiRestorePlan.js): which files/sections belong to each
// part, what differs, and that a restore writes only the parts picked, merged into the current files.
import { createRequire } from 'node:module';
import { describe, it, expect } from 'vitest';

const require = createRequire(import.meta.url);
const {
  PARTS, parseSections, classify, fitLayout, compare, buildRestore, windowRects, keysInfo,
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
    // key bindings are whole sections, never a key-by-key merge; a section the backup lacks is left alone
    expect(cls.keybinds).toMatchObject([{ file: 'eqclient.ini', mode: 'sections', keepAbsent: true }]);
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
    const o = cls.zealchar.find((e) => e.file === 'eqclient.ini' && e.mode === 'keys').test;
    expect([o('Zeal'), o('Aldenmar'), o('Brackwyn'), o('KeyMaps')]).toEqual([false, true, false, false]);
    // Zeal's per-character key bindings. A backup that shares one [KeyMaps], on a PC that also shares: no entry.
    expect(cls.zealchar.some((e) => e.mode === 'sections')).toBe(false);
    // The backup has the character's own section: this character's only, any case, never the shared one or another's.
    const own = classify({ 'eqclient.ini': '[KeyMaps]\r\nA=1\r\n[KeyMaps_Aldenmar]\r\nA=2\r\n[KeyMaps_Brackwyn]\r\nA=3\r\n' }, C)
      .zealchar.find((e) => e.mode === 'sections');
    expect(own).toMatchObject({ keepAbsent: true });
    expect(own.from).toBeUndefined();
    expect([own.test('KeyMaps_Aldenmar'), own.test('keymaps_aldenmar'), own.test('KeyMaps'), own.test('KeyMaps_Brackwyn'), own.test('Aldenmar')])
      .toEqual([true, true, false, false, false]);
    // The backup shares one [KeyMaps] and THIS PC keeps them per character: the shared set is brought under the character's name.
    const as = classify(filesFor(), C, { localPerCharKeys: true }).zealchar.find((e) => e.mode === 'sections');
    expect(as).toMatchObject({ from: 'KeyMaps', as: 'KeyMaps_Aldenmar', keepAbsent: true });
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
    // no size in the file and no skin: the 200x100 stand-in, placed the same fraction of the way across the free space
    expect(r.writes['UI_Aldenmar_pq.proj.ini']).toContain('XPos1920x1080=' + Math.round(1000 / (2560 - 200) * (1920 - 200)));
    expect(r.writes['UI_Aldenmar_pq.proj.ini']).toContain('YPos1920x1080=' + Math.round(500 / (1440 - 100) * (1080 - 100)));
  });

  // The guild lead, 2026-11-14: "all of the keybinds are messed up". A merge kept this PC's binding for every key the
  // other PC had left unbound (KEEP below), so one key did two things.
  it('keybinds makes [KeyMaps] exactly the backup\'s and never touches [VideoMode]', () => {
    const lo = { 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nFORWARD=1\r\nKEEP=5\r\n[Defaults]\r\nA=1\r\n' };
    const bk = {
      'eqclient.ini': '[VideoMode]\r\nWidth=640\r\nFullscreen=1\r\n[KeyMaps]\r\nFORWARD=87\r\nBACK=83\r\n[Defaults]\r\nA=2\r\n',
    };
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['keybinds'] });
    expect(r.writes['eqclient.ini']).toBe(
      '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nFORWARD=87\r\nBACK=83\r\n[Defaults]\r\nA=1\r\n');
  });

  it('keybinds with no local eqclient.ini creates only [KeyMaps]', () => {
    const bk = { 'eqclient.ini': '[VideoMode]\nWidth=640\n[KeyMaps]\nFORWARD=87\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: {}, character: C, parts: ['keybinds'] });
    expect(r.writes['eqclient.ini']).toBe('[KeyMaps]\nFORWARD=87\n');
  });

  it('a backup with no [KeyMaps] never removes this PC\'s', () => {
    const lo = { 'eqclient.ini': '[KeyMaps]\r\nFORWARD=1\r\n[Defaults]\r\nA=1\r\n' };
    const r = buildRestore({ backupFiles: { 'eqclient.ini': '[Defaults]\r\nA=2\r\n' }, localFiles: lo, character: C, parts: ['keybinds', 'zealchar'] });
    expect(r.writes['eqclient.ini']).toBeUndefined();
  });

  // Zeal's "per character keybinds" (zeal.ini [Zeal] PerCharKeybinds) keeps a character's keys in [KeyMaps_<Char>].
  // The guild lead, 2026-11-14, real files: the other PC had the option off (one [KeyMaps] for everyone), this PC had it
  // on, and after a bring-in the character's own section held 2 keys, so the game used its defaults for the rest.
  describe('per-character key bindings', () => {
    const PER = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=TRUE\r\n' };
    const SHARED_BK = { 'eqclient.ini': '[VideoMode]\r\nWidth=2559\r\n[KeyMaps]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x\r\nKEYMAP_HOT1_2=NOKEY\r\n' };
    const local = (extra = '') => ({ ...PER,
      'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\nMINE=1\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_BACK=s\r\n[KeyMaps_Brackwyn]\r\nKEYMAP_DUCK=d\r\n' + extra });

    it('this PC per character, the backup shared: the backup\'s [KeyMaps] becomes the character\'s own section', () => {
      // 'zealchar' is always brought with a character, so this happens with the shared Key bindings tick OFF too
      const r = buildRestore({ backupFiles: SHARED_BK, localFiles: local(), character: C, parts: ['zealchar'] });
      expect(r.writes['eqclient.ini']).toBe(
        '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\nMINE=1\r\n'
        + '[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x\r\nKEYMAP_HOT1_2=NOKEY\r\n'      // exactly the backup's set: KEYMAP_BACK is gone
        + '[KeyMaps_Brackwyn]\r\nKEYMAP_DUCK=d\r\n');                                              // another character's: untouched
      expect(compare('zealchar', SHARED_BK, local(), C)).toMatchObject({ added: 2, changed: 0, removed: 1 });
    });

    it('creates the character\'s section when this PC has none yet', () => {
      const lo = { ...PER, 'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\n' };
      const r = buildRestore({ backupFiles: SHARED_BK, localFiles: lo, character: C, parts: ['zealchar'] });
      expect(r.writes['eqclient.ini']).toBe('[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x\r\nKEYMAP_HOT1_2=NOKEY\r\n');
    });

    it('this PC shared too: nothing is written under the character\'s name', () => {
      const lo = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=FALSE\r\n', 'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\n' };
      expect(buildRestore({ backupFiles: SHARED_BK, localFiles: lo, character: C, parts: ['zealchar'] }).writes['eqclient.ini']).toBeUndefined();
      expect(buildRestore({ backupFiles: SHARED_BK, localFiles: { 'eqclient.ini': lo['eqclient.ini'] }, character: C, parts: ['zealchar'] }).writes['eqclient.ini']).toBeUndefined();
    });

    it('the backup has the character\'s own section: that section is brought as it is, not the shared one', () => {
      const bk = { 'eqclient.ini': '[KeyMaps]\r\nSHARED=1\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=e\r\n[KeyMaps_Corvale]\r\nX=1\r\n' };
      const r = buildRestore({ backupFiles: bk, localFiles: local(), character: C, parts: ['zealchar'] });
      expect(r.writes['eqclient.ini']).toContain('[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=e\r\n[KeyMaps_Brackwyn]');
      expect(r.writes['eqclient.ini']).not.toMatch(/SHARED|Corvale/);
      expect(r.writes['eqclient.ini']).toContain('[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\nMINE=1\r\n');   // the shared set stays with the tick off
    });

    // Which section holds the character's live keys in a backup is decided by the BACKUP's own switch.
    it('a backup whose PC shares keys: an old [KeyMaps_<Char>] left in its file does not win over its live [KeyMaps]', () => {
      const bk = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=FALSE\r\n',
        'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=OLD\r\n' };
      const r = buildRestore({ backupFiles: bk, localFiles: local(), character: C, parts: ['zealchar'] });
      expect(r.writes['eqclient.ini']).toContain('[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x\r\n[KeyMaps_Brackwyn]');
      expect(r.writes['eqclient.ini']).not.toContain('OLD');
    });

    it('a backup whose PC is per character: its [KeyMaps] is nobody\'s keys and is never written as the character\'s', () => {
      // this PC's own backup, taken before the character had a section of its own
      const bk = { ...PER, 'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=SHARED\r\n' };
      const r = buildRestore({ backupFiles: bk, localFiles: local(), character: C, parts: ['zealchar'] });
      expect(r.writes['eqclient.ini']).toBeUndefined();
      // and with a section of its own, that section comes as it is
      const bk2 = { ...PER, 'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=SHARED\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=e\r\n' };
      const r2 = buildRestore({ backupFiles: bk2, localFiles: local(), character: C, parts: ['zealchar'] });
      expect(r2.writes['eqclient.ini']).toContain('[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=e\r\n[KeyMaps_Brackwyn]');
      expect(r2.writes['eqclient.ini']).not.toContain('SHARED');
    });

    // Review of the release, 2026-11-14. The other direction: the backup's PC keeps keys per character, this PC
    // shares one set. With the switch no longer copied, the game here reads [KeyMaps], so the tick must bring the
    // character's own keys there, not the other PC's [KeyMaps] that no character reads.
    it('a per-character backup brought to a PC that shares keys: the tick brings the character\'s OWN keys as the shared set', () => {
      const bk = { ...PER, 'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=UNREAD\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=e\r\nKEYMAP_DUCK=x\r\n' };
      const lo = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=FALSE\r\n', 'eqclient.ini': '[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\nMINE=1\r\n' };
      const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['keybinds', 'zealchar', 'zeal'] });
      expect(r.writes['eqclient.ini']).toContain('[KeyMaps]\r\nKEYMAP_FORWARD=e\r\nKEYMAP_DUCK=x\r\n');
      expect(r.writes['eqclient.ini']).not.toMatch(/UNREAD|MINE=1/);
      expect(r.writes['zeal.ini']).toBeUndefined();                 // the switch is not copied: this PC keeps sharing keys
      // without the tick the shared set is left alone
      const r2 = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['zealchar'] });
      expect(r2.writes['eqclient.ini']).toContain('[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\nMINE=1\r\n');
      // both PCs per character: the shared set comes as it is (no character reads it on either)
      const r3 = buildRestore({ backupFiles: bk, localFiles: local(), character: C, parts: ['keybinds'] });
      expect(r3.writes['eqclient.ini']).toContain('[KeyMaps]\r\nKEYMAP_FORWARD=UNREAD\r\n');
      // a backup that cannot say which way its PC keeps keys (no zeal.ini) is not second-guessed
      const r4 = buildRestore({ backupFiles: { 'eqclient.ini': bk['eqclient.ini'] }, localFiles: lo, character: C, parts: ['keybinds'] });
      expect(r4.writes['eqclient.ini']).toContain('[KeyMaps]\r\nKEYMAP_FORWARD=UNREAD\r\n');
    });

    it('bringing shared Zeal settings never flips this PC\'s per-character switch', () => {
      const bk = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=FALSE\r\nCamera=2\r\n' };
      const lo = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=TRUE\r\nCamera=1\r\n' };
      const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['zeal'] });
      expect(r.writes['zeal.ini']).toBe('[Zeal]\r\nPerCharKeybinds=TRUE\r\nCamera=2\r\n');
      const k = classify(bk, C).zeal.find((e) => e.file === 'zeal.ini').keyTest;
      expect([k('PerCharKeybinds'), k('percharkeybinds'), k('Camera'), k('ServerPassword')]).toEqual([false, false, true, false]);
    });

    it('with the shared Key bindings tick on, [KeyMaps] is replaced as well', () => {
      const r = buildRestore({ backupFiles: SHARED_BK, localFiles: local(), character: C, parts: ['keybinds', 'zealchar'] });
      expect(r.writes['eqclient.ini']).toContain('[KeyMaps]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x\r\nKEYMAP_HOT1_2=NOKEY\r\n[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=w\r\nKEYMAP_DUCK=x');
      expect(r.writes['eqclient.ini']).not.toContain('MINE=1');
    });
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

  const secOf = (text) => Object.fromEntries(parseSections(text).map((s) => [s.name, Object.fromEntries(s.keys.map((k) => [k.key, k.value]))]));

  it('adds a fitted block for this screen and keeps the other screen\'s numbers', () => {
    const r = fitLayout(src, 1920, 1080);
    expect(r.sourceRes).toBe('2560x1440');
    expect(r.added).toBe(2);
    const sec = secOf(r.text);
    // [Chat] has a Width but no Height, so it is not resized; it keeps its place in the free space (300 wide, 100 guessed tall)
    expect(sec.Chat).toMatchObject({
      XPos1920x1080: String(Math.round(1280 / (2560 - 300) * (1920 - 300))), YPos1920x1080: String(Math.round(720 / (1440 - 100) * (1080 - 100))),
      XPos2560x1440: '1280', Width: '300',
    });
    expect(sec.Buffs).toMatchObject({ XPos1920x1080: '0', YPos1920x1080: '0' });
    expect(r.text).toContain('\r\n');
    expect(r.text.replace(/\r\n/g, '')).not.toMatch(/\n/);
  });

  // FB-132 (the guild lead, 2026-11-14): "Import did not resize correctly onto this 1080 monitor from 1440p". The real
  // file held a full 1920x1080 block from long ago beside the 2560x1440 one it was played at, and that old block won.
  it('a backup played on another screen size replaces its own old block for this size', () => {
    const r = fitLayout(src, 1920, 1080);
    expect(r.refit).toBe(1);
    // [Map] sat at the bottom-right corner at 1440p (2500,1400): it is at the bottom-right corner here, not at the stale 40,50
    expect(secOf(r.text).Map).toMatchObject({ XPos1920x1080: String(1920 - 200), YPos1920x1080: String(1080 - 100) });
  });

  it('a backup played on THIS screen size keeps its block (the source is its own eqclient.ini)', () => {
    const t = '[MainChat]\r\nXPos2560x1440=2000\r\nYPos2560x1440=1000\r\nXPos1920x1080=40\r\nYPos1920x1080=50\r\nWidth=300\r\nHeight=200\r\n';
    const r = fitLayout(t, 1920, 1080, { source: { w: 1920, h: 1080 } });
    expect(r).toMatchObject({ text: t, added: 0, refit: 0, resized: 0, sourceRes: '1920x1080' });
    // and played at 2560x1440, the same file is re-fitted from there
    const o = fitLayout(t, 1920, 1080, { source: { w: 2560, h: 1440 } });
    expect(o).toMatchObject({ refit: 1, resized: 1, sourceRes: '2560x1440' });
    expect(secOf(o.text).MainChat).toMatchObject({ XPos1920x1080: '1500', YPos1920x1080: '750', Width: '225', Height: '150' });
  });

  // Real files, 2026-11-14: one PC ran the game at 2559x1440 and the file held a full block for 2560x1440 too, and an
  // old part-block for 1920x1080. The block to read is the one the game was running at, which only its own
  // eqclient.ini says; counting keys picks the wrong one on a tie.
  it('reads the block the game was running at, even when another block is just as full', () => {
    const t = '[MainChat]\nXPos2560x1440=10\nYPos2560x1440=10\nXPos2559x1440=2059\nYPos2559x1440=1040\nWidth=500\nHeight=400\n';
    const r = fitLayout(t, 1920, 1080, { source: { w: 2559, h: 1440 } });
    expect(r.sourceRes).toBe('2559x1440');
    const c = secOf(r.text).MainChat;   // bottom-right corner there, bottom-right corner here
    expect([Number(c.XPos1920x1080) + Number(c.Width), Number(c.YPos1920x1080) + Number(c.Height)]).toEqual([1920, 1080]);
    // a source the file has no block for falls back to the fullest block rather than fitting nothing
    expect(fitLayout(t, 1920, 1080, { source: { w: 3440, h: 1440 } }).sourceRes).toBe('2560x1440');
  });

  it('a window docked to the right and bottom edges stays docked, wholly on the new screen', () => {
    const t = '[Buffs]\nXPos2560x1440=2160\nYPos2560x1440=1140\nWidth=400\nHeight=300\n[Mid]\nXPos2560x1440=1080\nYPos2560x1440=570\nWidth=400\nHeight=300\n';
    const sec = secOf(fitLayout(t, 1920, 1080).text);
    expect(sec.Buffs).toMatchObject({ XPos1920x1080: '1520', YPos1920x1080: '780', Width: '400', Height: '300' });   // 1520 + 400 = 1920
    expect(sec.Mid).toMatchObject({ XPos1920x1080: '760', YPos1920x1080: '390' });                                    // centred stays centred
    // the old rule: 2160 x 0.75 = 1620, and 1620 + 400 hung 100 px off the screen
  });

  it('chat windows are resized in proportion, down and up; no other window is', () => {
    const t = '[MainChat]\nXPos2560x1440=0\nYPos2560x1440=1040\nWidth=800\nHeight=400\n[Chat 3]\nXPos2560x1440=1760\nYPos2560x1440=1040\nWidth=800\nHeight=400\n'
      + '[MerchantWnd]\nXPos2560x1440=100\nYPos2560x1440=100\nWidth=125\nHeight=300\n[Chat 9]\nXPos2560x1440=5\nYPos2560x1440=5\nWidth=80\nHeight=51\n';
    const r = fitLayout(t, 1920, 1080);
    const sec = secOf(r.text);
    expect(r.resized).toBe(2);
    expect(sec.MainChat).toMatchObject({ XPos1920x1080: '0', YPos1920x1080: '780', Width: '600', Height: '300' });
    expect(sec['Chat 3']).toMatchObject({ XPos1920x1080: '1320', YPos1920x1080: '780', Width: '600', Height: '300' });   // still side by side, still on the bottom edge
    expect(sec.MerchantWnd).toMatchObject({ Width: '125', Height: '300' });      // #146: a fixed window is never shrunk
    expect(sec['Chat 9']).toMatchObject({ Width: '80', Height: '51' });          // already smaller than the floor: left as it is
    const up = secOf(fitLayout('[MainChat]\nXPos1920x1080=0\nYPos1920x1080=780\nWidth=600\nHeight=300\n', 2560, 1440).text).MainChat;
    expect(up).toMatchObject({ XPos2560x1440: '0', YPos2560x1440: '1040', Width: '800', Height: '400' });
  });

  it('a window parked a few pixels past an edge keeps its tuck; one far off the screen is brought to the edge', () => {
    const t = '[MainChat]\nXPos2560x1440=-5\nYPos2560x1440=1087\nWidth=463\nHeight=257\n[Far]\nXPos2560x1440=2560\nYPos2560x1440=1440\nWidth=300\nHeight=200\n';
    const sec = secOf(fitLayout(t, 1920, 1080).text);
    expect(sec.MainChat.XPos1920x1080).toBe('-5');
    expect(sec.Far).toMatchObject({ XPos1920x1080: '1620', YPos1920x1080: '880' });
  });

  it('a window with no size in the file takes the skin\'s size when one is given', () => {
    const t = '[PlayerWindow]\nXPos2560x1440=2260\nYPos2560x1440=0\n';
    expect(secOf(fitLayout(t, 1920, 1080, { skinSizes: { PlayerWindow: { w: 300, h: 120 } } }).text).PlayerWindow.XPos1920x1080).toBe('1620');
    expect(secOf(fitLayout(t, 1920, 1080).text).PlayerWindow.XPos1920x1080).toBe(String(Math.round(2260 / 2360 * 1720)));   // the 200-wide stand-in
  });

  it('brings a window that would sit off the new screen back to its edge', () => {
    const r = fitLayout('[Far]\nXPos2560x1440=2560\nYPos2560x1440=1440\n[Anchor]\nXPos2560x1440=0\nYPos2560x1440=0\n', 1920, 1080);
    const far = parseSections(r.text).find((s) => s.name === 'Far');
    expect(far.keys.find((k) => k.key === 'XPos1920x1080').value).toBe('1720');
    expect(far.keys.find((k) => k.key === 'YPos1920x1080').value).toBe('980');
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

  it('key bindings are compared as a whole section: a binding only this PC has counts as removed', () => {
    const b = { 'eqclient.ini': '[KeyMaps]\r\nA=1\r\nB=2\r\nC=3\r\n' };
    const l = { 'eqclient.ini': '[KeyMaps]\r\nA=1\r\nB=9\r\nExtra=4\r\n' };
    const r = compare('keybinds', b, l, C);
    expect(r).toMatchObject({ added: 1, changed: 1, removed: 1 });
    expect(r.summary).toBe('1 new, 1 changed, 1 removed');
    // a backup with no [KeyMaps] at all never offers to remove this PC's
    expect(compare('keybinds', { 'eqclient.ini': '[Defaults]\r\nA=1\r\n' }, l, C)).toMatchObject({ inBackup: 0, removed: 0 });
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
    const fitted = fitLayout(t, 1920, 1080).text.replace(/(\[A\][^[]*?XPos1920x1080=)\d+/, '$10');
    const r = windowRects(fitted, 1920, 1080);
    expect(r.find(w => w.name === 'A').x).toBe(0);                // the 1920x1080 block, edited
    expect(windowRects(t, 1920, 1080).find(w => w.name === 'A').x).toBe(0.5);   // no such block: the file's own
  });
});

// Review of the fitted bring-in (2026-11-14): two cases where "fit it from the other screen" is the wrong answer.
describe('a layout that is already this screen\'s is not re-fitted', () => {
  const NAME = 'UI_' + CHAR;
  // The file holds a block for both screen sizes this PC has used. The backup was taken the day the game ran at
  // 2560x1440; the game runs at 1920x1080 now.
  const ui = '[MainChat]\r\nXPos2560x1440=2000\r\nYPos2560x1440=1200\r\nXPos1920x1080=100\r\nYPos1920x1080=200\r\nWidth=400\r\nHeight=200\r\n';
  const bk = { [NAME]: ui, 'eqclient.ini': '[VideoMode]\r\nWidth=2560\r\nHeight=1440\r\n' };
  const lo = { [NAME]: ui.replace('XPos1920x1080=100', 'XPos1920x1080=555'), 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\n' };
  const target = { w: 1920, h: 1080 };

  it('a backup from another PC: its block for this size is replaced by a fit of the size it was played at', () => {
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['layout'], target });
    expect(r.writes[NAME]).not.toContain('XPos1920x1080=100\r\n');
    expect(r.writes[NAME]).not.toContain('XPos1920x1080=555\r\n');
  });

  it('a backup made on this computer: its block for this size is put back as it was', () => {
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: C, parts: ['layout'], target, sameMachine: true });
    expect(r.writes[NAME]).toBe(ui);
    expect(compare('layout', bk, { ...lo, [NAME]: ui }, C, { target, sameMachine: true }).same).toBe(true);
    expect(compare('layout', bk, { ...lo, [NAME]: ui }, C, { target }).same).toBe(false);
  });

  // Review of the release, 2026-11-14: "same computer" was first built as "read everything at this screen's size",
  // which threw away the size the backup was played at. A window with no place at this size was then fitted from
  // whichever block came first in its section.
  it('a backup made on this computer: a window with NO place at this size is fitted from the size it was played at', () => {
    // BuffWindow: an old 1280x1024 place listed first, the played-at 2560x1440 place, none for 1920x1080
    const ui2 = ui + '[BuffWindow]\r\nXPos1280x1024=0\r\nYPos1280x1024=0\r\nXPos2560x1440=2400\r\nYPos2560x1440=1300\r\nWidth=100\r\nHeight=100\r\n';
    const r = buildRestore({ backupFiles: { ...bk, [NAME]: ui2 }, localFiles: lo, character: C, parts: ['layout'], target, sameMachine: true });
    const secs = parseSections(r.writes[NAME]);
    const val = (sec, key) => secs.find((s) => s.name === sec).keys.find((k) => k.key === key).value;
    // the window that HAS a place here keeps it, size and all
    expect([val('MainChat', 'XPos1920x1080'), val('MainChat', 'YPos1920x1080'), val('MainChat', 'Width')]).toEqual(['100', '200', '400']);
    // the one that has none: docked bottom right at 2560x1440, so bottom right here (not 0,0 from the 1280x1024 block)
    expect([val('BuffWindow', 'XPos1920x1080'), val('BuffWindow', 'YPos1920x1080')]).toEqual(['1776', '951']);
  });

  it('with no screen size recorded for the backup, a tie between blocks goes to this screen\'s block', () => {
    const r = fitLayout(ui, 1920, 1080, {});
    expect(r.sourceRes).toBe('1920x1080');
    expect(r.text).toBe(ui);
    expect(fitLayout(ui, 2560, 1440, {}).sourceRes).toBe('2560x1440');
  });
});

// Review of 3.0.11 (2026-11-14): a backup of this PC's own files, restored onto itself, reported 13-34 windows
// "moved" and rewrote them. Invented names only.
describe('same-PC restore of an unchanged backup (keep)', () => {
  const T = { w: 1920, h: 1080 };
  // Chat 2 is parked almost wholly off the bottom right on purpose; Bag has NO 1920x1080 place (only a stale
  // 2560x1440 one); Map is a normal window; Zone is parked far off screen by the game.
  const ui = [
    '[Chat 2]', 'XPos1920x1080=1881', 'YPos1920x1080=1070', 'Width=282', 'Height=224', 'XPos2560x1440=2200', 'YPos2560x1440=1300',
    '[Map]', 'XPos1920x1080=1179', 'YPos1920x1080=291', 'XPos2560x1440=1500', 'YPos2560x1440=400',
    '[Zone]', 'XPos1920x1080=-32000', 'YPos1920x1080=-32000',
    '[Bag]', 'XPos2560x1440=1654', 'YPos2560x1440=424', '',
  ].join('\r\n');
  const eqc = '[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\n';
  const files = { 'UI_Aldenmar_pq.proj.ini': ui, 'eqclient.ini': eqc };
  const secOf = (text) => Object.fromEntries(parseSections(text).map((s) => [s.name, Object.fromEntries(s.keys.map((k) => [k.key, k.value]))]));

  it('moves nothing and writes nothing: 0 windows moved, none invented', () => {
    const r = fitLayout(ui, 1920, 1080, { keep: true, source: T });
    expect(r.text).toBe(ui);
    expect([r.added, r.clamped, r.refit, r.resized]).toEqual([0, 0, 0, 0]);
    const cmp = compare('layout', files, files, C, { target: T, sameMachine: true });
    expect(cmp.same).toBe(true);
    expect(cmp.summary).toBe('identical');
    expect(buildRestore({ backupFiles: files, localFiles: files, character: C, parts: ['layout'], target: T, sameMachine: true }).writes).toEqual({});
  });

  it('without keep (another PC) the same file IS fitted, so the guard above is the keep rule and not an accident', () => {
    const r = fitLayout(ui, 1920, 1080, { source: T });
    expect(r.clamped).toBeGreaterThan(0);
    expect(secOf(r.text)['Chat 2']['XPos1920x1080']).not.toBe('1881');
  });

  it('a window with a place at the target size keeps it exactly while one with none is fitted from the played-at size', () => {
    // played at 2560x1440, now on 1920x1080: Map has a 1080 place (kept), Bag has none (fitted from 1440)
    const r = fitLayout(ui, 1920, 1080, { keep: true, source: { w: 2560, h: 1440 } });
    const s = secOf(r.text);
    expect([s.Map['XPos1920x1080'], s.Map['YPos1920x1080']]).toEqual(['1179', '291']);
    expect([s['Chat 2']['XPos1920x1080'], s['Chat 2']['YPos1920x1080'], s['Chat 2'].Width, s['Chat 2'].Height]).toEqual(['1881', '1070', '282', '224']);
    expect(s.Zone['XPos1920x1080']).toBe('-32000');
    expect(r.added).toBe(1);
    expect(Number(s.Bag['XPos1920x1080'])).toBeLessThanOrEqual(1920 - 200);
  });
});

describe('Zeal raid bars are fitted with the window rule', () => {
  const zeal = '[RaidBars]\r\nEnabled=TRUE\r\nLeft=1970\r\nTop=750\r\nRight=2530\r\nBottom=1080\r\nShowAll=TRUE\r\n[AssistBar]\r\nEnabled=TRUE\r\nLeft=1200\r\nTop=1000\r\n';
  const eq1440 = '[VideoMode]\r\nWidth=2560\r\nHeight=1440\r\n';
  const bars = (text) => {
    const o = {};
    for (const s of parseSections(text)) if (/^(RaidBars|AssistBar)$/i.test(s.name)) for (const k of s.keys) o[s.name + '.' + k.key] = k.value;
    return o;
  };
  const bk = { 'eqclient.ini': eq1440, 'zeal.ini': zeal };
  const lo = { 'zeal.ini': '[RaidBars]\r\nLeft=1358\r\nTop=504\r\nRight=1918\r\nBottom=834\r\n' };
  const restore = (target, sameMachine, backup = bk) =>
    bars(buildRestore({ backupFiles: backup, localFiles: lo, character: C, parts: ['zeal'], target, sameMachine }).writes['zeal.ini'] || '');

  it('1440 -> 1080: the bars end wholly on the 1920x1080 screen, at the same size', () => {
    const b = restore({ w: 1920, h: 1080 }, false);
    const L = +b['RaidBars.Left'], T = +b['RaidBars.Top'], R = +b['RaidBars.Right'], B = +b['RaidBars.Bottom'];
    expect(L).toBeGreaterThanOrEqual(0); expect(T).toBeGreaterThanOrEqual(0);
    expect(R).toBeLessThanOrEqual(1920); expect(B).toBeLessThanOrEqual(1080);
    expect([R - L, B - T]).toEqual([560, 330]);               // a bar keeps its size
    expect(+b['AssistBar.Left']).toBeLessThan(1920 - 100); expect(+b['AssistBar.Top']).toBeLessThan(1080);
  });

  it('the same screen size leaves them untouched', () => {
    const same = { 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\nHeight=1080\r\n', 'zeal.ini': zeal.replace('1970', '1358').replace('2530', '1918').replace('Top=750', 'Top=504').replace('Bottom=1080', 'Bottom=834') };
    const b = restore({ w: 1920, h: 1080 }, false, same);
    expect([b['RaidBars.Left'], b['RaidBars.Right'], b['RaidBars.Top'], b['RaidBars.Bottom']]).toEqual(['1358', '1918', '504', '834']);
  });

  it('a backup from this PC (keep) leaves them alone even when the sizes differ', () => {
    expect(restore({ w: 1920, h: 1080 }, true)['RaidBars.Left']).toBe('1970');
  });

  it('a side that runs to the screen edge (0) stays 0', () => {
    const edge = { ...bk, 'zeal.ini': '[RaidBars]\r\nLeft=1000\r\nTop=500\r\nRight=0\r\nBottom=0\r\n' };
    const b = restore({ w: 1920, h: 1080 }, false, edge);
    expect([b['RaidBars.Right'], b['RaidBars.Bottom']]).toEqual(['0', '0']);
    expect(b['RaidBars.Left']).toBe('750');
  });
});

describe('a backup with no eqclient.ini picks its block the same way every time', () => {
  // one window section per window, each holding BOTH blocks, so the two counts tie (as in the real files)
  const small = Array.from({ length: 3 }, (_, i) => ['[W' + i + ']', 'XPos2559x1440=' + (i * 10), 'YPos2559x1440=5', 'XPos2560x1440=' + (i * 20 + 7), 'YPos2560x1440=9'].join('\r\n')).join('\r\n') + '\r\n';
  const big = '';
  it('equal blocks: the larger screen wins whichever is listed first', () => {
    const swapped = small.replace(/XPos2559x1440/g, 'XPosTMP').replace(/YPos2559x1440/g, 'YPosTMP')
      .replace(/XPos2560x1440/g, 'XPos2559x1440').replace(/YPos2560x1440/g, 'YPos2559x1440')
      .replace(/XPosTMP/g, 'XPos2560x1440').replace(/YPosTMP/g, 'YPos2560x1440');
    expect(fitLayout(small + big, 1920, 1080).sourceRes).toBe('2560x1440');
    expect(fitLayout(swapped, 1920, 1080).sourceRes).toBe('2560x1440');
  });
  it('the snapshot\'s own source size wins when it names a block the file has', () => {
    const files = { 'UI_Aldenmar_pq.proj.ini': small + big };
    const a = buildRestore({ backupFiles: files, localFiles: {}, character: C, parts: ['layout'], target: { w: 1920, h: 1080 }, sourceRes: { w: 2559, h: 1440 } });
    const b = buildRestore({ backupFiles: files, localFiles: {}, character: C, parts: ['layout'], target: { w: 1920, h: 1080 } });
    expect(a.writes['UI_Aldenmar_pq.proj.ini']).toBeTruthy();
    expect(a.writes['UI_Aldenmar_pq.proj.ini']).not.toBe(b.writes['UI_Aldenmar_pq.proj.ini']);
  });
});

// Bringing per-character-keys backups onto a PC that shares one set (review of 3.0.11, 2026-11-14): the last character
// brought in used to decide every character's keys. Invented names throughout.
describe('per-character keys backups on a shared-keys PC', () => {
  const PER = '[Zeal]\r\nPerCharKeybinds=TRUE\r\n';
  const backupOf = (name, keys, extra = '') => ({ 'zeal.ini': PER, 'eqclient.ini':
    '[KeyMaps]\r\nKEYMAP_FORWARD=UNREAD\r\n[KeyMaps_' + name + ']\r\n' + keys + extra });
  const sharedPc = () => ({
    'zeal.ini': '[Zeal]\r\nPerCharKeybinds=FALSE\r\nCamera=1\r\n',
    'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n[KeyMaps]\r\nKEYMAP_FORWARD=UP\r\nKEYMAP_DUCK=c\r\n',
    'Corvale_pq.proj.ini': '[Options]\r\nT=1\r\n',
  });
  const apply = (local, r) => ({ ...local, ...r.writes });
  const sect = (text, name) => { const x = parseSections(text).find((q) => q.name.toLowerCase() === name.toLowerCase()); return x ? x.keys.map((k) => k.key + '=' + k.value) : null; };
  const A = backupOf('Aldenmar', 'KEYMAP_FORWARD=a1\r\n'), B = backupOf('Brackwyn', 'KEYMAP_FORWARD=b1\r\nKEYMAP_BACK=b2\r\n');

  const run = (order) => {
    let l = sharedPc();
    l = apply(l, buildRestore({ backupFiles: A, localFiles: l, character: 'Aldenmar', parts: ['keysplit'], splitChars: ['Corvale', 'Aldenmar'] }));
    for (const who of order) {
      l = apply(l, buildRestore({ backupFiles: who === 'A' ? A : B, localFiles: l, character: who === 'A' ? 'Aldenmar' : 'Brackwyn', parts: ['zealchar', 'zeal'] }));
    }
    return l;
  };

  it('own keys: each character gets its own section, characters already here keep today\'s set, the switch is on, [KeyMaps] is unchanged, any order', () => {
    const ab = run(['A', 'B']), ba = run(['B', 'A']);
    for (const l of [ab, ba]) {
      expect(sect(l['eqclient.ini'], 'KeyMaps_Aldenmar')).toEqual(['KEYMAP_FORWARD=a1']);
      expect(sect(l['eqclient.ini'], 'KeyMaps_Brackwyn')).toEqual(['KEYMAP_FORWARD=b1', 'KEYMAP_BACK=b2']);
      expect(sect(l['eqclient.ini'], 'KeyMaps_Corvale')).toEqual(['KEYMAP_FORWARD=UP', 'KEYMAP_DUCK=c']);
      expect(sect(l['eqclient.ini'], 'KeyMaps')).toEqual(['KEYMAP_FORWARD=UP', 'KEYMAP_DUCK=c']);
      expect(sect(l['zeal.ini'], 'Zeal')).toEqual(expect.arrayContaining(['PerCharKeybinds=TRUE', 'Camera=1']));
      expect(l['eqclient.ini']).toContain('[VideoMode]\r\nWidth=1920');
    }
    expect(sect(ab['eqclient.ini'], 'KeyMaps_Brackwyn')).toEqual(sect(ba['eqclient.ini'], 'KeyMaps_Brackwyn'));
  });
  it('the shared step is one write of eqclient.ini and zeal.ini, labelled keysplit, and compare says what it does', () => {
    const r = buildRestore({ backupFiles: A, localFiles: sharedPc(), character: 'Aldenmar', parts: ['keysplit'], splitChars: ['Corvale'] });
    expect(Object.keys(r.writes).sort()).toEqual(['eqclient.ini', 'zeal.ini']);
    expect(r.fileParts['zeal.ini']).toEqual(['keysplit']);
    const c = compare('keysplit', A, sharedPc(), 'Aldenmar', { splitChars: ['Corvale'] });
    expect(c).toMatchObject({ added: 1, changed: 1, same: false });
    expect(c.summary).toMatch(/1 character keeps .*Zeal's per-character keys turned on/);
    // a PC that already reads per-character keys has nothing to do
    const done = apply(sharedPc(), r);
    expect(compare('keysplit', A, done, 'Aldenmar', { splitChars: ['Corvale'] })).toMatchObject({ same: true, summary: 'already per character' });
  });
  it('a character that already has its own section keeps it, and an empty shared set creates no sections', () => {
    const l = sharedPc();
    l['eqclient.ini'] += '[KeyMaps_Corvale]\r\nKEYMAP_FORWARD=mine\r\n';
    const r = buildRestore({ backupFiles: A, localFiles: l, character: 'Aldenmar', parts: ['keysplit'], splitChars: ['Corvale'] });
    expect(r.writes['eqclient.ini']).toBeUndefined();
    const e = { ...sharedPc(), 'eqclient.ini': '[VideoMode]\r\nWidth=1920\r\n' };
    expect(buildRestore({ backupFiles: A, localFiles: e, character: 'Aldenmar', parts: ['keysplit'], splitChars: ['Corvale'] }).writes['eqclient.ini']).toBeUndefined();
  });
  it('picker: only the picked character\'s keys land in the shared [KeyMaps] (the card runs keybinds for that one character)', () => {
    const l = apply(sharedPc(), buildRestore({ backupFiles: B, localFiles: sharedPc(), character: 'Brackwyn', parts: ['keybinds'] }));
    expect(sect(l['eqclient.ini'], 'KeyMaps')).toEqual(['KEYMAP_FORWARD=b1', 'KEYMAP_BACK=b2']);
    expect(sect(l['eqclient.ini'], 'KeyMaps_Brackwyn')).toBeNull();
    expect(compare('keybinds', B, sharedPc(), 'Brackwyn')).toMatchObject({ inBackup: 2, added: 1, changed: 1, removed: 1 });
  });
  it('keysInfo says how both PCs keep keys (main.js uses it to keep quiet sync off the shared set)', () => {
    expect(keysInfo(A, sharedPc(), 'Aldenmar')).toEqual({ backupPerChar: true, hasOwn: true, pcPerChar: false });
    expect(keysInfo(A, sharedPc(), 'Brackwyn')).toMatchObject({ backupPerChar: true, hasOwn: false });
    expect(keysInfo({ 'eqclient.ini': '[KeyMaps]\r\nA=1\r\n' }, sharedPc(), 'Aldenmar').backupPerChar).toBe(false);
  });
  it('a per-character backup with no section for the character brings no keys, and compare says so', () => {
    const bk = backupOf('Brackwyn', 'KEYMAP_FORWARD=b1\r\n');
    const r = buildRestore({ backupFiles: bk, localFiles: sharedPc(), character: 'Aldenmar', parts: ['keybinds', 'zealchar'] });
    expect(r.writes['eqclient.ini']).toBeUndefined();                       // the backup's unread [KeyMaps] is not written
    expect(compare('keybinds', bk, sharedPc(), 'Aldenmar')).toMatchObject({ inBackup: 0, summary: 'not in this backup' });
  });
  it('an empty own section writes nothing, for a shared PC and for a per-character one', () => {
    const bk = backupOf('Aldenmar', '');
    const r = buildRestore({ backupFiles: bk, localFiles: sharedPc(), character: 'Aldenmar', parts: ['keybinds', 'zealchar'] });
    expect(r.writes['eqclient.ini']).toBeUndefined();
    const perPc = { ...sharedPc(), 'zeal.ini': PER, 'eqclient.ini': sharedPc()['eqclient.ini'] + '[KeyMaps_Aldenmar]\r\nKEYMAP_FORWARD=mine\r\n' };
    expect(buildRestore({ backupFiles: bk, localFiles: perPc, character: 'Aldenmar', parts: ['zealchar'] }).writes['eqclient.ini']).toBeUndefined();
    expect(compare('keybinds', bk, sharedPc(), 'Aldenmar').inBackup).toBe(0);
  });
  it('PerCharAutojoin (any PerChar switch) is never copied from a backup, by either Zeal part', () => {
    const bk = { 'zeal.ini': '[Zeal]\r\nPerCharAutojoin=TRUE\r\nPerCharKeybinds=TRUE\r\nCamera=2\r\n[Aldenmar]\r\nPerCharFoo=1\r\nTellWindows=1\r\n',
      'eqclient.ini': '[Zeal]\r\nPerCharAutojoin=TRUE\r\nCamera=2\r\n' };
    const lo = { 'zeal.ini': '[Zeal]\r\nPerCharAutojoin=FALSE\r\nCamera=1\r\n', 'eqclient.ini': '[Zeal]\r\nCamera=1\r\n' };
    const r = buildRestore({ backupFiles: bk, localFiles: lo, character: 'Aldenmar', parts: ['zeal', 'zealchar'] });
    const all = Object.values(r.writes).join('\n');
    expect(r.writes['zeal.ini']).toContain('Camera=2');
    expect(all).not.toMatch(/PerCharAutojoin=TRUE|PerCharKeybinds=TRUE|PerCharFoo/);
    expect(r.writes['zeal.ini']).toContain('PerCharAutojoin=FALSE');
    expect(compare('zeal', bk, lo, 'Aldenmar').summary).not.toMatch(/2 changed/);
  });
  it('a character named Zeal never copies the global [Zeal] section through its own part', () => {
    const bk = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=TRUE\r\nFoo=1\r\n', 'eqclient.ini': '[Zeal]\r\nPerCharKeybinds=TRUE\r\nBar=1\r\n' };
    const lo = { 'zeal.ini': '[Zeal]\r\nPerCharKeybinds=FALSE\r\nFoo=0\r\n', 'eqclient.ini': '[Zeal]\r\nBar=0\r\n' };
    const own = buildRestore({ backupFiles: bk, localFiles: lo, character: 'Zeal', parts: ['zealchar'] });
    expect(own.writes).toEqual({});
    const both = buildRestore({ backupFiles: bk, localFiles: lo, character: 'Zeal', parts: ['zealchar', 'zeal', 'keybinds'] });
    expect(Object.values(both.writes).join('\n')).not.toMatch(/PerCharKeybinds=TRUE/);
    expect(both.writes['zeal.ini']).toContain('Foo=1');                      // the shared part still brings the other [Zeal] keys
  });
});
