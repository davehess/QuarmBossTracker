// test/agent-sntp.test.js — the agent asking a real time server what time it is.
//
// The heartbeat's four-stamp exchange measures this machine against OUR BOT,
// which is the right reference for "is this bot timestamp still fresh" and the
// wrong one for "is this machine's clock correct" — it cannot see an error the
// bot shares. Two cases where that bites: the bot being unreachable (the agent
// then assumed a zero offset, a silent 56s error on the machines that need it
// most), and a self-hosted bot with a wrong clock quietly pulling its whole
// fleet toward it.
//
// ⚠ The network half cannot be tested here — UDP/123 is blocked in CI and in
// the cloud dev container, verified 2026-08-14 (all three servers timed out).
// So the ARITHMETIC is split out and tested instead, which is the half that
// fails silently: a bad epoch constant or a mis-scaled fraction produces a
// confident number that is decades or milliseconds wrong.
//
// Run: npx vitest run test/agent-sntp.test.js

import { describe, it, expect } from 'vitest';
import { _parseSntpReply } from '../packages/wolfpack-logsync/index.js';

const NTP_EPOCH_OFFSET_S = 2208988800;

// Build a server reply as a real NTP server would: 48 bytes, stratum 2, with
// receive (offset 32) and transmit (offset 40) timestamps in NTP epoch.
function reply({ t2Ms, t3Ms, stratum = 2 }) {
  const b = Buffer.alloc(48);
  b[0] = 0x1c;                 // LI=0, VN=3, Mode=4 (server)
  b[1] = stratum;
  const put = (off, ms) => {
    b.writeUInt32BE(Math.floor(ms / 1000) + NTP_EPOCH_OFFSET_S, off);
    b.writeUInt32BE(Math.round(((ms % 1000) / 1000) * 4294967296) >>> 0, off + 4);
  };
  put(32, t2Ms);
  put(40, t3Ms);
  return b;
}

describe('reading the time off the wire', () => {
  it('reports ~0 for a machine whose clock is correct', () => {
    // Symmetric 40ms round trip, server agrees with us.
    const t1 = 1_700_000_000_000;
    const r = _parseSntpReply(reply({ t2Ms: t1 + 20, t3Ms: t1 + 20 }), t1, t1 + 40);
    expect(Math.abs(r.offsetMs)).toBeLessThanOrEqual(2);
    expect(r.rttMs).toBe(40);
  });

  it('gets the SIGN right — a machine that is BEHIND reads positive', () => {
    // The convention the whole system runs on: ts + offset_ms = true time. A
    // flip here doubles every error instead of removing it.
    const t1 = 1_700_000_000_000;          // our clock
    const server = t1 + 56_000;            // true time is 56s later => we are behind
    const r = _parseSntpReply(reply({ t2Ms: server + 20, t3Ms: server + 20 }), t1, t1 + 40);
    expect(r.offsetMs).toBeGreaterThan(55_000);
    expect(r.offsetMs).toBeLessThan(57_000);
  });

  it('reads negative for a machine running AHEAD', () => {
    const t1 = 1_700_000_000_000;
    const server = t1 - 30_000;
    const r = _parseSntpReply(reply({ t2Ms: server + 20, t3Ms: server + 20 }), t1, t1 + 40);
    expect(r.offsetMs).toBeLessThan(-29_000);
  });

  it('does not charge the round trip to the offset', () => {
    // The whole reason for the four-stamp form. With a 2s round trip and a
    // correct clock, a naive (t3 - t4) would report a ~1-2s skew.
    const t1 = 1_700_000_000_000;
    const r = _parseSntpReply(reply({ t2Ms: t1 + 1000, t3Ms: t1 + 1000 }), t1, t1 + 2000);
    expect(Math.abs(r.offsetMs)).toBeLessThanOrEqual(2);
    expect(r.rttMs).toBe(2000);
  });

  it('survives an ASYMMETRIC round trip as well as the maths allows', () => {
    // Request took 900ms, reply took 100ms. NTP cannot detect asymmetry — the
    // residual error is half the imbalance and that is expected, not a bug.
    const t1 = 1_700_000_000_000;
    const r = _parseSntpReply(reply({ t2Ms: t1 + 900, t3Ms: t1 + 900 }), t1, t1 + 1000);
    expect(Math.abs(r.offsetMs)).toBeLessThanOrEqual(500);
  });

  it('handles the sub-second fraction, not just whole seconds', () => {
    const t1 = 1_700_000_000_000;
    const r = _parseSntpReply(reply({ t2Ms: t1 + 250, t3Ms: t1 + 250 }), t1, t1 + 500);
    expect(Math.abs(r.offsetMs)).toBeLessThanOrEqual(2);
  });

  it('uses the right epoch — 1900, not 1970', () => {
    // Getting this wrong is a 70-year error that still parses as a number.
    const t1 = 1_700_000_000_000;
    const r = _parseSntpReply(reply({ t2Ms: t1, t3Ms: t1 }), t1, t1 + 10);
    expect(Math.abs(r.offsetMs)).toBeLessThan(60_000);
  });
});

describe('refusing an answer it should not trust', () => {
  it('rejects a kiss-of-death (stratum 0) rather than reading it as a time', () => {
    const t1 = 1_700_000_000_000;
    expect(_parseSntpReply(reply({ t2Ms: t1, t3Ms: t1, stratum: 0 }), t1, t1 + 10)).toBeNull();
  });

  it('rejects a server that has never synced (transmit stamp of zero)', () => {
    const b = Buffer.alloc(48);
    b[1] = 2;
    expect(_parseSntpReply(b, 1_700_000_000_000, 1_700_000_000_010)).toBeNull();
  });

  it('rejects a short or missing packet', () => {
    expect(_parseSntpReply(Buffer.alloc(20), 1, 2)).toBeNull();
    expect(_parseSntpReply(null, 1, 2)).toBeNull();
    expect(_parseSntpReply(undefined, 1, 2)).toBeNull();
  });

  it('never returns a negative round trip', () => {
    // A server claiming to have spent longer on it than we waited.
    const t1 = 1_700_000_000_000;
    const r = _parseSntpReply(reply({ t2Ms: t1, t3Ms: t1 + 5000 }), t1, t1 + 10);
    expect(r.rttMs).toBeGreaterThanOrEqual(0);
  });
});

describe('how the agent uses it', () => {
  const src = require('node:fs').readFileSync(
    new URL('../packages/wolfpack-logsync/index.js', import.meta.url), 'utf8');

  it('asks several servers and takes the LOWEST round trip', () => {
    // A short trip bounds how wrong the offset can be, and it stops one slow or
    // lying server deciding the answer alone.
    expect(src).toMatch(/answers\.sort\(\(a, b\) => a\.rttMs - b\.rttMs\)/);
  });

  it('falls back to NTP for live decisions only when the pulse is missing', () => {
    // Pulse stays authoritative for "is this BOT timestamp fresh" — that is a
    // question about the bot's clock, not about true time.
    const fn = src.slice(src.indexOf('function _nowOnServerClock()'));
    expect(fn.slice(0, 700)).toMatch(/if \(Number\.isFinite\(off\)\) return Date\.now\(\) \+ off;/);
    expect(fn.slice(0, 700)).toMatch(/stats\.ntpOffsetMs/);
  });

  it('derives the BOT\'s own clock error from ntp minus pulse', () => {
    // This machine is measured against both, so it cancels out of the
    // difference — what is left is the server's error. The only way to catch a
    // self-hosted bot with a wrong clock.
    expect(src).toMatch(/const botErr = r\.offsetMs - pulse;/);
  });

  it('is inlined, not a sibling file that would never ship', () => {
    // apps/mimic/scripts/stage-agent.js copies a HARDCODED file list into the
    // bundle, so a new file works in dev and silently does not ship.
    const stage = require('node:fs').readFileSync(
      new URL('../apps/mimic/scripts/stage-agent.js', import.meta.url), 'utf8');
    const list = /const FILES = \[([^\]]*)\]/.exec(stage)[1];
    expect(list).not.toMatch(/sntp/);
    expect(src).toMatch(/function _parseSntpReply/);
  });

  it('keeps its timers unref\'d so they cannot hold the process open', () => {
    const block = src.slice(src.indexOf('function startNtpRefresh'), src.indexOf('function startNtpRefresh') + 400);
    expect(block).toMatch(/t\.unref/);
  });
});
