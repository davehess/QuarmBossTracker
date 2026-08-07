// test/gina-import.test.js — GINA import field mapping + .gtp (PKZIP) reading.
//
// From pq-companion analysis 01 (§3.8/§3.9): our .gtp import was advertised
// and broken (PKZIP fed to a gzip-only path), and GINA's <TimerDuration> —
// the COUNTDOWN length — was imported as cooldown_seconds, turning a 450s
// raid timer into a 450s mute with no timer at all.
//
// Run: npx vitest run test/gina-import.test.js

import { describe, it, expect } from 'vitest';
import zlib from 'node:zlib';
import { readSource, sliceBlock, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);

function build() {
  const block =
    sliceBlock(src, 'function _ginaDurationSecs(raw) {', '\n}') +
    sliceBlock(src, 'function _parseTriggerXml(xml) {', '\n  return triggers;\n}') +
    sliceBlock(src, 'function _readZipMemberFromBuf(buf, preferBase) {', '\n  return null;\n}');
  const harness = `
    const zlib = arguments[0];
    function _decodeXmlEntities(t) {
      return String(t).replace(/&lt;/g,'<').replace(/&gt;/g,'>')
        .replace(/&quot;/g,'"').replace(/&apos;/g,"'").replace(/&amp;/g,'&');
    }
    function _escapeForLiteralMatch(s) {
      return String(s || '').replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
    }
  ` + block + `
    return { _ginaDurationSecs, _parseTriggerXml, _readZipMemberFromBuf };
  `;
  // eslint-disable-next-line no-new-func
  return new Function(harness)(zlib);
}

const GINA_TRIGGER = (inner) => `<SharedTriggers><Triggers><Trigger>${inner}</Trigger></Triggers></SharedTriggers>`;

describe('_ginaDurationSecs', () => {
  it('parses seconds, floats, and clock notation', () => {
    const h = build();
    expect(h._ginaDurationSecs('400')).toBe(400);
    expect(h._ginaDurationSecs('6:40')).toBe(400);
    expect(h._ginaDurationSecs('1:02:03')).toBe(3723);
    expect(h._ginaDurationSecs('12.6')).toBe(13);
    expect(h._ginaDurationSecs('')).toBe(0);
    expect(h._ginaDurationSecs('abc')).toBe(0);
  });
});

describe('_parseTriggerXml — GINA semantics', () => {
  it('TimerDuration becomes a COUNTDOWN, never a cooldown (the inversion fix)', () => {
    const h = build();
    const [t] = h._parseTriggerXml(GINA_TRIGGER(
      '<Name>Tash Timer</Name><TriggerText>^You tash</TriggerText>' +
      '<EnableRegex>True</EnableRegex><TimerType>Timer</TimerType>' +
      '<TimerDuration>450</TimerDuration>'));
    expect(t.timer_duration_sec).toBe(450);
    expect(t.cooldown_seconds).toBe(0);      // was 450 — a 450s MUTE
  });

  it('TimerType NoTimer means no countdown even with a duration present', () => {
    const h = build();
    const [t] = h._parseTriggerXml(GINA_TRIGGER(
      '<Name>x</Name><TriggerText>y</TriggerText><TimerType>NoTimer</TimerType>' +
      '<TimerDuration>60</TimerDuration>'));
    expect(t.timer_duration_sec).toBe(0);
  });

  it('TimerMillisecondDuration wins over TimerDuration', () => {
    const h = build();
    const [t] = h._parseTriggerXml(GINA_TRIGGER(
      '<Name>x</Name><TriggerText>y</TriggerText><TimerType>Timer</TimerType>' +
      '<TimerMillisecondDuration>12500</TimerMillisecondDuration><TimerDuration>99</TimerDuration>'));
    expect(t.timer_duration_sec).toBe(13);
  });

  it('UseTextToVoice=False suppresses the TTS text', () => {
    const h = build();
    const [t] = h._parseTriggerXml(GINA_TRIGGER(
      '<Name>x</Name><TriggerText>y</TriggerText>' +
      '<UseText>True</UseText><DisplayText>show me</DisplayText>' +
      '<UseTextToVoice>False</UseTextToVoice><TextToVoiceText>never say this</TextToVoiceText>'));
    expect(t.display_text).toBe('show me');
    expect(t.tts_text).toBe('');
  });

  it('early enders join as alternatives, escaping non-regex enders', () => {
    const h = build();
    const [t] = h._parseTriggerXml(GINA_TRIGGER(
      '<Name>x</Name><TriggerText>y</TriggerText><TimerType>Timer</TimerType><TimerDuration>30</TimerDuration>' +
      '<TimerEarlyEnders><EarlyEnder><EarlyEndText>has been slain</EarlyEndText><EnableRegex>True</EnableRegex></EarlyEnder>' +
      '<EarlyEnder><EarlyEndText>worn off. (ouch)</EarlyEndText><EnableRegex>False</EnableRegex></EarlyEnder></TimerEarlyEnders>'));
    expect(t.end_early_pattern).toBe('(?:has been slain)|(?:worn off\\. \\(ouch\\))');
    expect(t.end_use_regex).toBe(true);
  });
});

describe('_readZipMemberFromBuf — the .gtp path', () => {
  // Hand-rolled single-member PKZIP: local header + deflate body + central
  // directory + EOCD. Enough structure for the reader; GINA writes the same.
  function makeZip(name, content, method) {
    const nameB = Buffer.from(name);
    const raw   = Buffer.from(content);
    const body  = method === 8 ? zlib.deflateRawSync(raw) : raw;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(method, 8);
    local.writeUInt32LE(body.length, 18); local.writeUInt32LE(raw.length, 22);
    local.writeUInt16LE(nameB.length, 26);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0); central.writeUInt16LE(method, 10);
    central.writeUInt32LE(body.length, 20); central.writeUInt32LE(raw.length, 24);
    central.writeUInt16LE(nameB.length, 28); central.writeUInt32LE(0, 42);
    const cdStart = 30 + nameB.length + body.length;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0); eocd.writeUInt16LE(1, 8); eocd.writeUInt16LE(1, 10);
    eocd.writeUInt32LE(46 + nameB.length, 12); eocd.writeUInt32LE(cdStart, 16);
    return Buffer.concat([local, nameB, body, central, nameB, eocd]);
  }

  it('extracts a deflated ShareData.xml by basename, case-insensitively', () => {
    const h = build();
    const xml = '<SharedTriggers><Triggers></Triggers></SharedTriggers>';
    expect(h._readZipMemberFromBuf(makeZip('ShareData.xml', xml, 8), 'sharedata.xml')).toBe(xml);
  });

  it('extracts a stored member and falls back to the first .xml', () => {
    const h = build();
    expect(h._readZipMemberFromBuf(makeZip('other.xml', '<x/>', 0), 'sharedata.xml')).toBe('<x/>');
  });

  it('rejects non-zip input', () => {
    const h = build();
    expect(h._readZipMemberFromBuf(Buffer.from('not a zip at all......'), 'sharedata.xml')).toBeNull();
  });
});
