// test/crash-reason-parse.test.js — crash_reason.txt → structured fields.
//
// THE BUG (found in live data, 2026-08-12): the parser used
// `/Character:\s*(.+)/i`, and `\s` matches NEWLINES. So an empty field
// swallowed the line break and captured the NEXT line — production rows ended
// up with `character` = "UI Skin: UIFiles\NillipussUI_1080p\".
//
// It bit hardest exactly where it hurt most: `Character:` is blank when the
// client crashes during ZONING, which is the case we most wanted to read.
// Every `(.+)` field had the same hole, so the fix is line-anchoring all of
// them, and these tests pin that.
//
// Run: npx vitest run test/crash-reason-parse.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const block = sliceBlock(src, 'function _parseCrashReason', '\n}');
// `path.basename` is the only outside reference in the block.
// eslint-disable-next-line no-new-func
const _parseCrashReason = new Function(
  'path',
  block + '\nreturn _parseCrashReason;',
)(require('node:path'));

// Shaped like the real file, including CRLF and the blank Character line.
const zoningCrash = [
  'Unhandled exception occurred: Initial Handler',
  '',
  'Exception Code: 0xc0000005',
  'Exception Address: 0x7ffb1234fb03',
  'Exception occurred in module: C:\\Windows\\SYSTEM32\\ntdll.dll',
  'Zeal Version: 1.4.2 (c6b903b)',
  'Character:',                                   // ← blank: crashed while zoning
  'UI Skin: UIFiles\\NillipussUI_1080p\\',
  'Zone ID: ffffffff',
  'Callbacks: render,pulse',
].join('\r\n');

const namedCrash = [
  'Unhandled exception occurred: Multiple Crashes',
  'Exception Code: 0x6ef',
  'Exception Address: 0x00009f54',
  'Exception occurred in module: C:\\Windows\\System32\\KernelBase.dll',
  'Zeal Version: 1.4.2 (c6b903b)',
  'Character: Rockin',
  'UI Skin: UIFiles\\default\\',
  'Zone ID: 0000004d',
].join('\n');

// Verbatim shapes from live rows (2026-08-12), including the exact fields Zeal
// writes that the parser used to discard.
const realZoning = [
  'Unhandled exception occurred: Initial Handler',
  '',
  'Exception Code: 0x6ef',
  'Exception Address: 0x764C9F54',
  'Exception occurred in module: C:\\WINDOWS\\System32\\KERNELBASE.dll',
  'Zeal Version: 1.4.2 (c6b903b)',
  'Character: ',
  'UI Skin: UIFiles\\NillipussUI_1080p\\',
  'Zone ID: ffffffff',
  'Game state: ff',
  'Callbacks: RenderUI : Exit (0x0)',
  'SpawnInfo: 0x0',
  'Self: 0x0',
].join('\r\n');

const realVeh = [
  'Unhandled exception occurred: VEH',
  '',
  'Zeal Version: 0.6.6-beta1 (6d688ac)',
  '',
  'Exception Code: 0xc0000005',
  'Exception String: EXCEPTION_ACCESS_VIOLATION',
  'Exception Address: 0x7744FB03',
  'Exception occurred in module: C:\\WINDOWS\\SYSTEM32\\ntdll.dll',
  'Self: 0x33dc7a08',
  'Character: ',
  'UI Skin: UIFiles\\Default\\',
  'Zone ID: 185',
  'Game state: 1',
  'Callbacks: DoCharacterSelection: Enter',
].join('\r\n');

describe('_parseCrashReason — diagnostic fields', () => {
  it('captures the zoning fingerprint: no world, no player entity', () => {
    const r = _parseCrashReason(realZoning);
    expect(r.game_state).toBe('ff');      // ff = no world loaded
    expect(r.zone_id).toBe('ffffffff');
    expect(r.self_ptr).toBe('0x0');       // player entity gone
    expect(r.spawn_info).toBe('0x0');
    expect(r.callbacks).toBe('RenderUI : Exit (0x0)');
  });

  it('keeps the human-readable exception string when Zeal writes one', () => {
    expect(_parseCrashReason(realVeh).exception_string).toBe('EXCEPTION_ACCESS_VIOLATION');
    expect(_parseCrashReason(realZoning).exception_string).toBeNull();
  });

  it('records which handler caught it', () => {
    expect(_parseCrashReason(realZoning).handler_stage).toBe('Initial Handler');
    expect(_parseCrashReason(realVeh).handler_stage).toBe('VEH');
    expect(_parseCrashReason('Unhandled exception occurred: Multiple Crashes\r\n\r\nException Code: 0x6ef\r\n')
      .handler_stage).toBe('Multiple Crashes');
  });

  it('a context-free Multiple Crashes row parses without inventing fields', () => {
    const r = _parseCrashReason('Unhandled exception occurred: Multiple Crashes\r\n\r\nException Code: 0x6ef\r\nException Address: 0x764C9F54\r\nException occurred in module: C:\\WINDOWS\\System32\\KERNELBASE.dll\r\nZeal Version: 1.4.2 (c6b903b)\r\n');
    expect(r.exception_module).toBe('kernelbase.dll');
    expect(r.zone_id).toBeNull();
    expect(r.game_state).toBeNull();
    expect(r.ui_skin).toBeNull();
  });

  it('still reads the character out of the real zoning sample as blank', () => {
    // "Character: " with a trailing space — the exact live shape.
    expect(_parseCrashReason(realZoning).character).toBeNull();
    expect(_parseCrashReason(realZoning).ui_skin).toBe('UIFiles\\NillipussUI_1080p\\');
  });
});

describe('_parseCrashReason', () => {
  it('a blank Character does NOT swallow the next line (the live bug)', () => {
    const r = _parseCrashReason(zoningCrash);
    expect(r.character).toBeNull();
    expect(r.ui_skin).toBe('UIFiles\\NillipussUI_1080p\\');
  });

  it('still reads a real character name', () => {
    expect(_parseCrashReason(namedCrash).character).toBe('Rockin');
  });

  it('"unknown" stays null rather than becoming a character', () => {
    expect(_parseCrashReason('Character: unknown\nZone ID: 5').character).toBeNull();
    expect(_parseCrashReason('Character: UNKNOWN\n').character).toBeNull();
  });

  it('module is reduced to a lowercase basename', () => {
    expect(_parseCrashReason(zoningCrash).exception_module).toBe('ntdll.dll');
    expect(_parseCrashReason(namedCrash).exception_module).toBe('kernelbase.dll');
  });

  it('address_low16 is the last four hex digits, for signature grouping', () => {
    expect(_parseCrashReason(zoningCrash).address_low16).toBe('fb03');
    expect(_parseCrashReason(namedCrash).address_low16).toBe('9f54');
  });

  it('reads the zoning fingerprint: invalid zone id survives intact', () => {
    expect(_parseCrashReason(zoningCrash).zone_id).toBe('ffffffff');
  });

  it('handles CRLF and LF identically', () => {
    const crlf = _parseCrashReason(namedCrash.replace(/\n/g, '\r\n'));
    expect(crlf.character).toBe('Rockin');
    expect(crlf.zeal_version).toBe('1.4.2 (c6b903b)');
    expect(crlf.exception_code).toBe('0x6ef');
  });

  it('a blank trailing field is null, never the empty string', () => {
    const r = _parseCrashReason('Exception Code: 0x1\nCallbacks:\n');
    expect(r.callbacks).toBeNull();
  });

  it('missing fields are null and the parse still succeeds', () => {
    const r = _parseCrashReason('Unhandled exception occurred: something\n');
    expect(r.exception_code).toBeNull();
    expect(r.character).toBeNull();
    expect(r.address_low16).toBeNull();
    expect(r.raw_reason).toContain('Unhandled exception');
  });

  it('a label appearing mid-line is not mistaken for a field', () => {
    // Only line-leading labels count, or prose in the headline could set fields.
    const r = _parseCrashReason('Note: the Character: field was empty\nCharacter: Hitya\n');
    expect(r.character).toBe('Hitya');
  });
});
