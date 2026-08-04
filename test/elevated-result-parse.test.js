// Reading back what an elevated PowerShell wrote.
//
// THE BUG (Uilnayar, 2026-08-04): "I approved the UAC prompts" — and Mimic
// still reported "Cancelled at the Windows permission prompt."
//
// Windows PowerShell 5.1 IS powershell.exe, and its `-Encoding UTF8` ALWAYS
// emits a UTF-8 BOM (there is no utf8NoBOM before PowerShell 6). JSON.parse
// throws on a leading U+FEFF, so a result file that had been written perfectly
// read back as "no result" — and the no-result branch reported a declined
// prompt. The elevated script had run; the Defender exclusions were applied.
// Only the reporting was wrong, which is the worst kind of wrong: it told the
// user their action failed while it had actually succeeded.
//
// Two lessons pinned here:
//   1. strip the BOM (and trailing CRLF) before parsing;
//   2. NEVER infer "the user cancelled" from an unparseable file. Cancelled is
//      a specific Windows condition with specific wording; everything else is
//      an error and has to say so.
//
// Source-sliced so it tests the shipped regex rather than a copy of it.
//
// Run: npx vitest run test/elevated-result-parse.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, ROOT } from './_source-slice.js';

const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

describe('elevated result parsing', () => {
  it('the shipped code strips a BOM before parsing', () => {
    // If this regex is ever removed, the 2026-08-04 bug is back.
    expect(src, 'main.js must strip \\uFEFF from the elevated result file')
      .toMatch(/readFileSync\(outFile, 'utf8'\)\s*\.replace\(\/\^\\uFEFF\/, ''\)/);
  });

  it('does NOT pass -RedirectStandard* alongside -Verb RunAs', () => {
    // Start-Process puts -Verb and -RedirectStandard* in mutually exclusive
    // parameter sets; combining them throws "Parameter set cannot be resolved"
    // and elevation never happens at all. 3.5.25 shipped exactly that.
    const launcher = src.slice(src.indexOf('Start-Process powershell.exe -Verb RunAs'));
    const stanza = launcher.slice(0, 400);
    expect(stanza, 'redirect params break -Verb RunAs').not.toMatch(/-RedirectStandard/);
  });

  // The parse behaviour itself, against exactly what PowerShell 5.1 produces.
  const parse = (raw) => JSON.parse(String(raw).replace(/^\uFEFF/, '').trim());

  it('parses a real PowerShell 5.1 payload (BOM + CRLF)', () => {
    const ps51 = '\uFEFF' + JSON.stringify({ done: ['A:\\EQ', 'C:\\Users\\Dave\\AppData\\Roaming\\wolfpack-mimic'], failed: [] }) + '\r\n';
    const r = parse(ps51);
    expect(r.done).toHaveLength(2);
    expect(r.done[0]).toBe('A:\\EQ');
    expect(r.failed).toEqual([]);
  });

  it('still parses a BOM-less payload (PowerShell 7 / pwsh)', () => {
    expect(parse(JSON.stringify({ ok: true, steps: ['startup=Automatic'] })).ok).toBe(true);
  });

  it('the clock payload survives the same round trip', () => {
    const raw = '\uFEFF' + JSON.stringify({ ok: true, steps: ['startup=Automatic', 'service=Running', 'resync=ok'], source: 'time.windows.com' }) + '\r\n';
    const r = parse(raw);
    expect(r.ok).toBe(true);
    expect(r.steps).toContain('resync=ok');
    expect(r.source).toBe('time.windows.com');
  });

  it('genuinely malformed output still throws — the guard is not blanket try/catch', () => {
    expect(() => parse('\uFEFFnot json at all')).toThrow();
  });
});

describe('cancelled must mean cancelled', () => {
  // Mirrors the classifier in main.js: only Windows' own declined-UAC wording
  // counts. Anything else is a real error and must surface its message.
  const declined = (s) => /canceled by the user|cancelled by the user|1223/i.test(s);

  it('recognises a genuinely declined prompt', () => {
    for (const s of [
      'This command cannot be run due to the error: The operation was canceled by the user.',
      'Start-Process : The operation was cancelled by the user',
      'System.ComponentModel.Win32Exception (1223): The operation was canceled by the user',
    ]) expect(declined(s), s).toBe(true);
  });

  it('does NOT call real failures cancelled', () => {
    for (const s of [
      'Add-MpPreference : Access is denied',
      'Start-Process : Parameter set cannot be resolved using the specified named parameters.',
      'Set-Content : Could not find a part of the path',
      'The term Add-MpPreference is not recognized as the name of a cmdlet',
      '',
    ]) expect(declined(s), s).toBe(false);
  });
});

// ── EQ scan: never probe a speculative path on a non-local drive ────────────
//
// Measured 2026-08-04:
//   [eq-scan] scanned 26 dir(s) in 21050ms (hint A:\EQ) — SLOW: B:\Quarm 21046ms
// B: is a mapped NAS backup drive. Asleep, one fs.existsSync on it costs ~21
// SECONDS on the main process, freezing every Mimic window. One path was the
// entire hang.
//
// The guard MUST use DriveType, never IsReady: IsReady queries free space and
// blocks on exactly the drives being skipped, which would make the guard the
// bug. And it must NOT short-circuit discovery once a configured hint resolves
// — this user has a second install at D:\EQ that only the speculative pass
// finds, and dropping it would trade a slow scan for a missing folder.
describe('EQ scan drive filter', () => {
  const src = readSource(path.join(ROOT, 'apps', 'mimic', 'main.js'));

  it('enumerates by DriveType, not IsReady', () => {
    expect(src, 'must filter on DriveType').toMatch(/DriveType -eq 'Fixed'/);
    expect(src, 'IsReady blocks on the very drives we are avoiding').not.toMatch(/\$_\.IsReady/);
  });

  it('does not abandon discovery when a hint resolves', () => {
    // The early return that would have hidden D:\EQ.
    expect(src).not.toMatch(/if \(hint && found\.length > 0\) return/);
  });

  it('fails OPEN when drives cannot be enumerated', () => {
    // A null set must mean "scan everything", not "scan nothing" — silently
    // hiding someone's EQ folder is worse than a slow scan.
    expect(src).toMatch(/const local = _fixedDriveSet\(\);/);
    expect(src).toMatch(/if \(local && \/\^\[A-Za-z\]:\/\.test\(dir\) && !local\.has\(/);
  });

  it('the filter keeps local installs and drops non-local speculation', () => {
    const local = new Set(['A:', 'C:', 'D:']);          // B: NAS, E:/F: absent
    const keep = (d) => !(/^[A-Za-z]:/.test(d)) || local.has(d.slice(0, 2).toUpperCase());
    expect(keep('D:\\EQ'), 'the 28-log second install must stay discoverable').toBe(true);
    expect(keep('A:\\EQ')).toBe(true);
    expect(keep('B:\\Quarm'), 'the 21-second NAS probe must be skipped').toBe(false);
    expect(keep('B:\\EQ')).toBe(false);
    expect(keep('E:\\Quarm')).toBe(false);
  });
});
