// test/backup-log-name.test.js — a copied-aside log is not a new raider.
//
// EverQuest character names cannot contain digits (Hitya, 2026-08-13), so
// "eqlog_Dant3_pq.proj.txt" was never written by the client. It is what a
// raider ends up with after copying their log aside and letting EQ start a
// fresh one. We were treating the copy as a separate person.
//
// What that cost: on Va Xi Aten Ha Ra an uploader calling itself "Atlasius2"
// reported 288,169 for Atlasius while ten real clients — and Atlasius himself —
// agreed on ~100,000. The live-DPS merge took a max across clients, so the
// phantom set the number for the whole raid (bot 3.1.44 fixed the estimator;
// this fixes the source).
//
// Two halves, and the second is the one that could make things worse if it were
// forgotten: resolving Dant3 -> Dant is only safe if the backup is ALSO kept out
// of the live tail. Tailing both files under one name would replay every event
// twice — a doubled real raider instead of a phantom extra one.
//
// Run: npx vitest run test/backup-log-name.test.js

import { describe, it, expect } from 'vitest';
import { characterFromFilename, isBackupLogFile, _splitBackupSuffix }
  from '../packages/wolfpack-logsync/index.js';

describe('the two names that caused this', () => {
  it('resolves Atlasius2 to Atlasius', () => {
    expect(characterFromFilename('eqlog_Atlasius2_pq.proj.txt')).toBe('Atlasius');
    expect(isBackupLogFile('eqlog_Atlasius2_pq.proj.txt')).toBe(true);
  });

  it('resolves Dant3 to Dant', () => {
    expect(characterFromFilename('eqlog_Dant3_pq.proj.txt')).toBe('Dant');
    expect(isBackupLogFile('eqlog_Dant3_pq.proj.txt')).toBe(true);
  });
});

describe('real logs are untouched', () => {
  for (const name of ['Hitya', 'Mcdorf', 'Wabumkin', 'Peopleslayer', 'Bardtholemu']) {
    it(`leaves ${name} alone`, () => {
      const f = `eqlog_${name}_pq.proj.txt`;
      expect(characterFromFilename(f)).toBe(name);
      expect(isBackupLogFile(f)).toBe(false);
    });
  }

  it('handles a full path, not just a basename', () => {
    // NB path.basename is platform-specific: it only splits on "\\" when the
    // process is running on Windows. The agent's Windows builds get that for
    // free, and the Linux/Deck build sees POSIX paths, so the mixed case never
    // arises in the field — asserting it here would only be testing Node.
    expect(characterFromFilename('/home/x/Logs/eqlog_Hitya_pq.proj.txt')).toBe('Hitya');
    expect(characterFromFilename('/home/x/Logs/eqlog_Dant3_pq.proj.txt')).toBe('Dant');
  });
});

describe('the suffix split itself', () => {
  it('strips any run of trailing digits, not just one', () => {
    expect(_splitBackupSuffix('Dant10')).toEqual({ base: 'Dant', isBackup: true });
    expect(_splitBackupSuffix('Dant003')).toEqual({ base: 'Dant', isBackup: true });
  });

  it('requires a letter before the digits — never eats the whole name', () => {
    // A name that is ONLY digits is not a raider with a suffix; leaving it
    // whole is better than returning an empty character.
    expect(_splitBackupSuffix('123')).toEqual({ base: '123', isBackup: false });
  });

  it('only strips at the END', () => {
    expect(_splitBackupSuffix('Dant')).toEqual({ base: 'Dant', isBackup: false });
    expect(_splitBackupSuffix('D4nt')).toEqual({ base: 'D4nt', isBackup: false });
  });

  it('survives empty and junk input', () => {
    expect(_splitBackupSuffix('')).toEqual({ base: '', isBackup: false });
    expect(_splitBackupSuffix(null)).toEqual({ base: '', isBackup: false });
  });
});

describe('a backup never joins the live tail', () => {
  it('is flagged so the watch loop can skip it', () => {
    // The live-watch filter drops these; keeping the flag on the SAME helper
    // that renames them means the two can never disagree about what a backup is.
    expect(isBackupLogFile('eqlog_Dant3_pq.proj.txt')).toBe(true);
    expect(isBackupLogFile('eqlog_Dant_pq.proj.txt')).toBe(false);
  });

  it('would otherwise double every event for that character', () => {
    // Characterisation of WHY the skip exists: both files now resolve to one
    // name, so tailing both is a duplicate stream, not two perspectives.
    const live   = 'eqlog_Dant_pq.proj.txt';
    const backup = 'eqlog_Dant3_pq.proj.txt';
    expect(characterFromFilename(live)).toBe(characterFromFilename(backup));
    expect(isBackupLogFile(live)).toBe(false);
    expect(isBackupLogFile(backup)).toBe(true);
  });
});
