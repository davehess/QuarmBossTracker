// test/agent-slow-mode-line.test.js — the agent hears the server's guild-wide slow-mode announcement.
//
// The guild lead, 2026-10-14: the server god tells the guild when slow mode is switched off ("Time has
// returned to its natural pace"). Only the OFF wording has ever been captured, so ON is any
// "tells the guild" line from the god that mentions the thread of time without the natural pace.
// The private "voice fills your mind" line must never match, and neither may a boss-kill line.
//
// Run: npx vitest run test/agent-slow-mode-line.test.js

import { describe, it, expect } from 'vitest';
import { readSource, sliceBlock, evalBlock, stripJs, AGENT_INDEX } from './_source-slice.js';

const src = readSource(AGENT_INDEX);
const ts = sliceBlock(src, 'const TS_RX =', '  return isNaN(d.getTime()) ? null : d;\n}');
const slowRx = sliceBlock(src, 'const SLOW_MODE_RX =', 'const SLOW_MODE_MAX_AGE_MS = 12 * 3600 * 1000;');
const parser = sliceBlock(src, 'function parseSlowModeLine(line) {', '\n}\n');
const { parseSlowModeLine } = evalBlock(ts + '\n' + slowRx + '\n' + parser, ['parseSlowModeLine']);

// A log stamp "Wed Oct 14 20:01:10 2026" for `ms` before now, in the machine's local time like the real log.
function stamp(msAgo) {
  const d = new Date(Date.now() - msAgo);
  const p = (n) => String(n).padStart(2, '0');
  const day = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
  const mon = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][d.getMonth()];
  return `[${day} ${mon} ${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())} ${d.getFullYear()}]`;
}
const OFF_TEXT = "A ripple passes through your guild's thread of time. Aldenmar has asked the Timekeeper of Druzzil Ro to set its weave right. Beware! Time has returned to its natural pace, and those walking it have been drawn back to Tranquility.";
const offLine = (ago = 60_000) => `${stamp(ago)} Druzzil Ro tells the guild, '${OFF_TEXT}'`;

describe('parseSlowModeLine', () => {
  it('reads the known OFF line: state off, who asked, the text, and the log time', () => {
    const e = parseSlowModeLine(offLine(60_000));
    expect(e).not.toBeNull();
    expect(e.state).toBe('off');
    expect(e.by).toBe('Aldenmar');
    expect(e.line).toBe(OFF_TEXT);
    expect(Math.abs(Date.parse(e.at) - (Date.now() - 60_000))).toBeLessThan(2000);
  });

  it('reads an ON line (thread of time, no natural pace) as on, with by null when no name is given', () => {
    const e = parseSlowModeLine(`${stamp(1000)} Druzzil Ro tells the guild, 'The thread of time slows around your guild.'`);
    expect(e.state).toBe('on');
    expect(e.by).toBeNull();
  });

  it('captures by on an ON line when the Timekeeper wording is present', () => {
    const e = parseSlowModeLine(`${stamp(1000)} Druzzil Ro tells the guild, 'Rethlan has asked the Timekeeper of Druzzil Ro to bend your guild's thread of time.'`);
    expect(e.state).toBe('on');
    expect(e.by).toBe('Rethlan');
  });

  it('caps the reported text at 400 characters', () => {
    const e = parseSlowModeLine(`${stamp(1000)} Druzzil Ro tells the guild, 'thread of time ${'x'.repeat(600)}'`);
    expect(e.line.length).toBe(400);
  });

  it('ignores the private "voice fills your mind" line', () => {
    expect(parseSlowModeLine(`${stamp(1000)} Druzzil Ro's voice fills your mind, 'Your guild's thread of time has been disturbed.'`)).toBeNull();
  });

  it('ignores a boss-kill announcement', () => {
    expect(parseSlowModeLine(`${stamp(1000)} Druzzil Ro tells the guild, 'Brackwyn of <Wolf Pack> has killed Lord Nagafen in Nagafen's Lair!'`)).toBeNull();
  });

  it('ignores a guild line from someone else that mentions the thread of time', () => {
    expect(parseSlowModeLine(`${stamp(1000)} Zarrin tells the guild, 'thread of time is back to its natural pace'`)).toBeNull();
  });

  it('does not report a line older than 12 hours (log replay)', () => {
    expect(parseSlowModeLine(offLine(13 * 3600 * 1000))).toBeNull();
    expect(parseSlowModeLine(offLine(11 * 3600 * 1000))).not.toBeNull();
  });
});

describe('wiring', () => {
  const code = stripJs(src);
  it('posts the queued event to /slow-mode', () => {
    expect(code).toMatch(/case 'slow_mode':\s+return base \+ '\/slow-mode';/);
    expect(code).toMatch(/enqueueUpload\('slow_mode'/);
  });
  it('checks the line in the tail loop right after the kill check, before the PVP broadcast check', () => {
    const kill = code.indexOf('const druzzilKill = parseDruzzilKill(line);');
    const slow = code.indexOf('const slowMode = parseSlowModeLine(line);');
    const pvp = code.indexOf('const pvpBcast = parsePvpBroadcast(line);', slow);
    expect(kill).toBeGreaterThan(0);
    expect(slow).toBeGreaterThan(kill);
    expect(pvp).toBeGreaterThan(slow);
  });
});
