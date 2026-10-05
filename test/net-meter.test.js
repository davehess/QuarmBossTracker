// test/net-meter.test.js — the connection (lag) meter.
//
// A member reported lag and nothing measured a player's own connection. The agent now pings the
// router and the game server's host from the player's PC, and the dashboard (Diagnostics) and the
// Tick overlay show it. Local only: nothing is uploaded.
//
// Everything that decides something is a pure function exported from the agent — the ping-line
// parser, the eqhost.txt and `route print` parsers, the stats, the verdict, the graph buckets —
// and runs here for real. The ping process itself needs Windows' ping.exe, so what is tested is
// the stdout it would print (English and localized), fed through the shipped line reader.
//
// Run: npx vitest run test/net-meter.test.js

import { describe, it, expect, afterEach } from 'vitest';
import path from 'node:path';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, sliceBlock, stripJs, AGENT_INDEX, ROOT } from './_source-slice.js';

const {
  _netParsePingLine, _netParseEqHost, _netParseGateway, _netStats, _netVerdict,
  _netSeries, _netFightSpan, _netNewTarget, _netOnData, _netPush, _netPayload,
  _netTargetsForTest, _netSetPlatformForTest,
} = agent;

const T0 = 1_800_000_000_000;
// samples from a list of ms values (null = lost), one a second
const mk = (list, { start = T0, step = 1000, fight } = {}) =>
  list.map((ms, i) => ({ t: start + i * step, ms, fight: fight ? !!fight(i) : false }));
const rep = (n, v) => Array.from({ length: n }, () => v);

describe('ping line parser', () => {
  it('a reply is a number, English or localized, and "under 1 ms" reads as 1', () => {
    expect(_netParsePingLine('Reply from 192.168.1.1: bytes=32 time=2ms TTL=64', true)).toEqual({ kind: 'ok', ms: 2 });
    expect(_netParsePingLine('Reply from 8.8.8.8: bytes=32 time<1ms TTL=117', true)).toEqual({ kind: 'ok', ms: 1 });
    expect(_netParsePingLine('Antwort von 8.8.8.8: Bytes=32 Zeit=45ms TTL=55', true)).toEqual({ kind: 'ok', ms: 45 });
    expect(_netParsePingLine('Réponse de 8.8.8.8 : octets=32 temps=12 ms TTL=117', true)).toEqual({ kind: 'ok', ms: 12 });
  });

  it('Spanish prints "under a millisecond" with a bare m, and a word after bytes=32 that starts with m is not a unit', () => {
    expect(_netParsePingLine('Respuesta desde 192.168.1.1: bytes=32 tiempo<1m TTL=64', true)).toEqual({ kind: 'ok', ms: 1 });
    expect(_netParsePingLine('Respuesta desde 8.8.8.8: bytes=32 tiempo=23ms TTL=117', true)).toEqual({ kind: 'ok', ms: 23 });
    expect(_netParsePingLine('Balasan dari 8.8.8.8: bait=32 masa=12ms TTL=117', true)).toEqual({ kind: 'ok', ms: 12 });
  });

  it('a unit that is not "ms" still parses, but a reply with no time at all is not read as one', () => {
    // Russian prints the unit in Cyrillic; the agent decodes stdout as latin1, so it arrives as 0x80+ characters.
    expect(_netParsePingLine('Reply: bytes=32 time=45¬á TTL=117', true)).toEqual({ kind: 'ok', ms: 45 });
    expect(_netParsePingLine('Reply from 10.0.0.1: bytes=32 TTL=64', true)).toBeNull();
  });

  it('timeouts, unreachable, general failure and expired TTL are lost samples', () => {
    for (const line of [
      'Request timed out.',
      'Reply from 192.168.1.20: Destination host unreachable.',
      'General failure.',
      'PING: transmit failed. General failure.',
      'Zeitüberschreitung der Anforderung.',
      'Reply from 10.0.0.1: TTL expired in transit.',
    ]) {
      expect(_netParsePingLine(line, true), line).toEqual({ kind: 'lost' });
    }
  });

  it('the header (whatever the language) and blank lines carry no sample', () => {
    expect(_netParsePingLine('Pinging 192.168.1.1 with 32 bytes of data:', false)).toBeNull();
    expect(_netParsePingLine('Ping wird ausgeführt für 192.168.1.1 mit 32 Bytes Daten:', false)).toBeNull();
    expect(_netParsePingLine('', true)).toBeNull();
    expect(_netParsePingLine('   \t', true)).toBeNull();
    expect(_netParsePingLine(undefined, true)).toBeNull();
  });

  it('the end-of-run summary is not counted as lost pings', () => {
    expect(_netParsePingLine('    Packets: Sent = 4, Received = 4, Lost = 0 (0% loss),', true)).toBeNull();
    expect(_netParsePingLine('    Minimum = 1ms, Maximum = 3ms, Average = 2ms', true)).toBeNull();
  });
});

describe('ping output, as it arrives', () => {
  it('lines split across chunks and CRLF endings become samples; the header gives the address', () => {
    const t = _netNewTarget('game'); t.host = 'login.example.com';
    const child = {}; t.child = child;
    _netOnData(t, child, 'Pinging login.example.com [93.184.216.34] with 32 bytes of data:\r\n\r\nReply from 93.184.216.34: bytes=32 time=12ms TT');
    _netOnData(t, child, 'L=117\r\nRequest timed out.\r\nReply from 93.184.216.34: bytes=32 time<1ms TTL=117\r\n');
    expect(t.samples.map(s => s.ms)).toEqual([12, null, 1]);
    expect(t.ip).toBe('93.184.216.34');
    expect(t.runCount).toBe(3);
  });

  it('the header line is skipped, then timeouts count as lost; a literal-IP target is its own address', () => {
    const t = _netNewTarget('router'); t.host = '192.168.1.1';
    const child = {}; t.child = child;
    _netOnData(t, child, 'Pinging 192.168.1.1 with 32 bytes of data:\nRequest timed out.\nRequest timed out.\n');
    expect(t.samples.map(s => s.ms)).toEqual([null, null]);
    expect(t.ip).toBe('192.168.1.1');
  });

  it('output from a run that was replaced is ignored', () => {
    const t = _netNewTarget('game'); t.host = 'x.example';
    t.child = {};
    _netOnData(t, { other: true }, 'Reply from 1.2.3.4: bytes=32 time=5ms TTL=60\n');
    expect(t.samples).toEqual([]);
  });

  it('a full run hands over to the next one at once, and the old run\'s trailing summary is ignored', () => {
    const t = _netNewTarget('game'); t.host = 'x.example';
    const child = {}; t.child = child; t.spawnedAt = Date.now() - 400_000;   // a run that paced itself: 300 pings in ~5 minutes
    const lines = Array.from({ length: 300 }, () => 'Reply from 1.2.3.4: bytes=32 time=5ms TTL=60\n').join('');
    _netOnData(t, child, 'Pinging x.example [1.2.3.4] with 32 bytes of data:\n' + lines);
    expect(t.samples.length).toBe(300);
    expect(t.child).toBeNull();   // handed over (the next run is not started here: the meter is Windows-only)
    expect(t.timer).toBeNull();   // ...and it is not a failure, so nothing is backing off
    _netOnData(t, child, '\nPing statistics for 1.2.3.4:\n    Packets: Sent = 300, Received = 300, Lost = 0 (0% loss),\n');
    expect(t.samples.length).toBe(300);
  });

  it('a ping that finishes a whole run in seconds is not pacing itself: back off instead of respawning in a loop', () => {
    const t = _netNewTarget('game'); t.host = 'x.example';
    const child = {}; t.child = child; t.spawnedAt = Date.now();
    const lines = Array.from({ length: 300 }, () => 'General failure.\n').join('');
    _netOnData(t, child, 'Pinging x.example with 32 bytes of data:\n' + lines);
    expect(t.child).toBeNull();
    expect(t.timer).not.toBeNull();   // a retry is scheduled, with a growing wait
    expect(t.backoffMs).toBe(10_000);
    expect(t.error).toMatch(/faster than once a second/);
    clearTimeout(t.timer);
  });

  it('a stream with no newline cannot grow without bound, and a big backlog of whole lines is not mistaken for one', () => {
    const t = _netNewTarget('game'); t.host = 'x.example';
    const child = {}; t.child = child;
    for (let i = 0; i < 50; i++) _netOnData(t, child, 'x'.repeat(1000));
    expect(t.buf.length).toBeLessThanOrEqual(1024);
    const u = _netNewTarget('game'); u.host = 'x.example';
    const c2 = {}; u.child = c2;
    _netOnData(u, c2, 'Pinging x.example with 32 bytes of data:\n' + 'Reply from 1.2.3.4: bytes=32 time=5ms TTL=60\n'.repeat(200));   // ~9 KB in one chunk
    expect(u.samples.length).toBe(200);
  });

  it('the ring keeps 30 minutes and never more than 2000 samples', () => {
    const t = _netNewTarget('game');
    for (let i = 0; i < 2100; i++) _netPush(t, 10, T0 + i * 100);   // 10 a second: the cap bites before the age does
    expect(t.samples.length).toBe(2000);
    const u = _netNewTarget('game');
    _netPush(u, 10, T0);
    _netPush(u, 10, T0 + 30 * 60_000 + 1);
    expect(u.samples.map(s => s.t)).toEqual([T0 + 30 * 60_000 + 1]);   // the first is just past 30 minutes
  });
});

describe('eqhost.txt', () => {
  it('reads the login server host, with or without a port', () => {
    expect(_netParseEqHost('[LoginServer]\nHost=login.projectquarm.com:5998\n')).toBe('login.projectquarm.com');
    expect(_netParseEqHost('[LoginServer]\nHost=203.0.113.9\n')).toBe('203.0.113.9');
  });

  it('reads the Quarm/TAKP client\'s own shape: a [Login Servers] block of quoted host:port entries', () => {
    // Verbatim from a member's eqhost.txt (2026-10-05). The registration server must not win.
    const takp = '[Registration Servers]\r\n{\r\n"loginserver.takproject.net:6999"\r\n}\r\n'
               + '[Login Servers]\r\n{\r\n"loginserver.takproject.net:6000"\r\n}\r\n';
    expect(_netParseEqHost(takp)).toBe('loginserver.takproject.net');
    // Registration servers alone are not a login server.
    expect(_netParseEqHost('[Registration Servers]\n{\n"reg.example:6999"\n}\n')).toBeNull();
    // The first usable entry wins; a refused one is skipped, not fatal.
    expect(_netParseEqHost('[Login Servers]\n{\n"-t"\n"second.example:6000"\n}\n')).toBe('second.example');
  });

  it('survives CRLF, a BOM, odd case and spaces around the equals sign', () => {
    expect(_netParseEqHost('﻿[loginserver]\r\n  host = login.example.com:5998  \r\n')).toBe('login.example.com');
  });

  it('only the [LoginServer] section counts; comments and trailing comments are ignored', () => {
    const txt = ';Host=bad.example\n[LoginServer2]\nHost=other.example:1\n[LoginServer]\n# a note\nHost=right.example:5998 ; trailing\n';
    expect(_netParseEqHost(txt)).toBe('right.example');
  });

  it('no section, no Host, an empty host, or empty input: no target — never an invented one', () => {
    expect(_netParseEqHost('[Other]\nHost=x.example')).toBeNull();
    expect(_netParseEqHost('[LoginServer]\nPort=5998')).toBeNull();
    expect(_netParseEqHost('[LoginServer]\nHost=:5998')).toBeNull();
    expect(_netParseEqHost('')).toBeNull();
    expect(_netParseEqHost(undefined)).toBeNull();
  });

  it('a host that would be read as a ping option or carries spaces is refused', () => {
    expect(_netParseEqHost('[LoginServer]\nHost=-t')).toBeNull();
    expect(_netParseEqHost('[LoginServer]\nHost=-n 99999:5998')).toBeNull();
    expect(_netParseEqHost('[LoginServer]\nHost=a b.example')).toBeNull();
  });
});

describe('route print — the default gateway', () => {
  const table = (rows) => [
    '===========================================================================',
    'Interface List',
    ' 12...00 15 5d 01 02 03 ......Intel(R) Ethernet Connection',
    '===========================================================================',
    '',
    'IPv4 Route Table',
    '===========================================================================',
    'Active Routes:',
    'Network Destination        Netmask          Gateway       Interface  Metric',
    ...rows,
    '===========================================================================',
    'Persistent Routes:',
    '  Network Address          Netmask  Gateway Address  Metric',
    '          0.0.0.0          0.0.0.0      192.168.1.1  Default',
    '===========================================================================',
  ].join('\r\n');

  it('picks the gateway', () => {
    expect(_netParseGateway(table(['          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     25']))).toBe('192.168.1.1');
  });

  it('with two defaults, the lower metric wins, whatever the order', () => {
    const a = '          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     25';
    const b = '          0.0.0.0          0.0.0.0     192.168.1.254    192.168.1.21     10';
    expect(_netParseGateway(table([a, b]))).toBe('192.168.1.254');
    expect(_netParseGateway(table([b, a]))).toBe('192.168.1.254');
  });

  it('an On-link row is not a router, even with the best metric (and neither is a localized one)', () => {
    const real = '          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     25';
    expect(_netParseGateway(table(['          0.0.0.0          0.0.0.0         On-link     192.168.1.20      5', real]))).toBe('192.168.1.1');
    expect(_netParseGateway(table(['          0.0.0.0          0.0.0.0   Auf Verbindung     192.168.1.20      5', real]))).toBe('192.168.1.1');
  });

  it('no default route, only On-link, or rubbish: null', () => {
    expect(_netParseGateway(table(['        127.0.0.0        255.0.0.0         On-link         127.0.0.1    331']))).toBeNull();
    expect(_netParseGateway(table(['          0.0.0.0          0.0.0.0         On-link     192.168.1.20      5']))).toBeNull();
    expect(_netParseGateway('')).toBeNull();
    expect(_netParseGateway(undefined)).toBeNull();
    expect(_netParseGateway(table(['          0.0.0.0          0.0.0.0      999.1.1.1    192.168.1.20     25']))).toBeNull();
  });

  it('a gateway of 0.0.0.0 is not a router either', () => {
    const real = '          0.0.0.0          0.0.0.0      192.168.1.1    192.168.1.20     25';
    expect(_netParseGateway(table(['          0.0.0.0          0.0.0.0          0.0.0.0    192.168.1.20      1', real]))).toBe('192.168.1.1');
  });
});

describe('_netStats', () => {
  it('count, loss, min, median, p95, max and last over a window', () => {
    const s = mk(Array.from({ length: 20 }, (_, i) => (i + 1) * 10));   // 10..200
    const r = _netStats(s, T0 + 19_000, 60_000);
    expect(r).toMatchObject({ count: 20, lost: 0, lossPct: 0, min: 10, median: 105, p95: 190, max: 200, last: 200 });
  });

  it('loss % counts lost pings against all pings; the ms numbers use replies only', () => {
    const s = mk([...rep(95, 20), ...rep(5, null)]);
    const r = _netStats(s, T0 + 99_000, 600_000);
    expect(r.count).toBe(100);
    expect(r.lost).toBe(5);
    expect(r.lossPct).toBe(5);
    expect(r.median).toBe(20);
    expect(r.last).toBeNull();   // the newest ping was lost
  });

  it('0 ms is a reply, not a lost ping', () => {
    const r = _netStats(mk([0, 0, 4]), T0 + 2_000, 60_000);
    expect(r).toMatchObject({ count: 3, lost: 0, min: 0, median: 0, last: 4 });
  });

  it('spikes: a lost ping, or a reply over max(150 ms, 3x the median) — the boundary is not a spike', () => {
    expect(_netStats(mk([20, 20, 20, 20, 20, 151, 150, null]), T0 + 7_000, 60_000).spikes).toBe(2);   // 151 and the lost one
    expect(_netStats(mk([...rep(9, 100), 300]), T0 + 9_000, 60_000).spikes).toBe(0);   // limit is 3 x 100
    expect(_netStats(mk([...rep(9, 100), 301]), T0 + 9_000, 60_000).spikes).toBe(1);
  });

  it('the window is (now - windowMs, now]: the sample exactly windowMs old is out, a future one is out', () => {
    const s = mk([5, 6, 7, 8], { step: 10_000 });   // t = T0, +10 s, +20 s, +30 s
    expect(_netStats(s, T0 + 30_000, 30_000).count).toBe(3);   // T0 itself is exactly 30 s old
    expect(_netStats(s, T0 + 30_000, 30_001).count).toBe(4);
    expect(_netStats(s, T0 + 20_000, 60_000).count).toBe(3);   // the +30 s sample is in the future
  });

  it('nothing in the window: zeros and nulls, not NaN', () => {
    const r = _netStats([], T0, 60_000);
    expect(r).toEqual({ count: 0, lost: 0, lossPct: 0, min: null, median: null, p95: null, max: null, last: null, spikes: 0 });
    const dead = _netStats(mk(rep(5, null)), T0 + 4_000, 60_000);
    expect(dead).toMatchObject({ count: 5, lost: 5, lossPct: 100, median: null, p95: null, last: null, spikes: 5 });
  });
});

describe('_netVerdict', () => {
  // A 10-minute stats object, the shape _netStats returns.
  const st = (o = {}) => {
    const count = o.count ?? 60, lost = o.lost ?? 0;
    return { count, lost, lossPct: o.lossPct ?? (count ? (lost / count) * 100 : 0), p95: o.p95 ?? 5, median: o.median ?? 3 };
  };

  it('unknown until each line has 30 samples, or when a line has no target', () => {
    expect(_netVerdict({ router: null, game: st() }).code).toBe('unknown');
    expect(_netVerdict({ router: st({ count: 29 }), game: st() }).code).toBe('unknown');
    expect(_netVerdict({ router: st({ count: 30 }), game: st() }).code).toBe('ok');
    expect(_netVerdict({ router: st(), game: null }).code).toBe('unknown');
    expect(_netVerdict({ router: st(), game: st({ count: 29 }) }).code).toBe('unknown');
    expect(_netVerdict({ router: st(), game: st({ count: 30 }) }).code).toBe('ok');
    expect(_netVerdict().code).toBe('unknown');
  });

  it('home: the router line has 2% loss or a p95 over 50 ms', () => {
    expect(_netVerdict({ router: st({ lossPct: 1.99 }), game: st() }).code).toBe('ok');
    expect(_netVerdict({ router: st({ lossPct: 2 }), game: st() }).code).toBe('home');
    expect(_netVerdict({ router: st({ p95: 50 }), game: st() }).code).toBe('ok');
    expect(_netVerdict({ router: st({ p95: 51 }), game: st() }).code).toBe('home');
  });

  it('a bad router is the answer even when the server line is missing, and it outranks a bad server', () => {
    expect(_netVerdict({ router: st({ lossPct: 5 }), game: null }).code).toBe('home');
    expect(_netVerdict({ router: st({ lossPct: 5 }), game: st({ lossPct: 20 }) }).code).toBe('home');
  });

  it('beyond: a clean router, and 2% loss or a p95 over max(150 ms, 3x the server median)', () => {
    expect(_netVerdict({ router: st(), game: st({ lossPct: 1.99 }) }).code).toBe('ok');
    expect(_netVerdict({ router: st(), game: st({ lossPct: 2 }) }).code).toBe('beyond');
    expect(_netVerdict({ router: st(), game: st({ median: 20, p95: 150 }) }).code).toBe('ok');
    expect(_netVerdict({ router: st(), game: st({ median: 20, p95: 151 }) }).code).toBe('beyond');
    expect(_netVerdict({ router: st(), game: st({ median: 100, p95: 300 }) }).code).toBe('ok');   // 3 x 100
    expect(_netVerdict({ router: st(), game: st({ median: 100, p95: 301 }) }).code).toBe('beyond');
  });

  it('a router that answers nothing is not blamed (some ignore ping) unless the server line is dead too', () => {
    const silent = st({ count: 60, lost: 60 });
    expect(_netVerdict({ router: silent, game: st() }).code).toBe('unknown');
    expect(_netVerdict({ router: silent, game: null }).code).toBe('unknown');
    expect(_netVerdict({ router: silent, game: st({ count: 60, lost: 60 }) }).code).toBe('home');
  });

  it('every verdict has plain words, and the two real calls name the router or the provider', () => {
    const home = _netVerdict({ router: st({ lossPct: 5 }), game: st() });
    const beyond = _netVerdict({ router: st(), game: st({ lossPct: 5 }) });
    const ok = _netVerdict({ router: st(), game: st() });
    for (const v of [home, beyond, ok]) expect(v.text.length).toBeGreaterThan(40);
    expect(home.text).toMatch(/router/i);
    expect(beyond.text).toMatch(/internet provider/i);
    expect(beyond.text).toMatch(/past your router/i);
  });
});

describe('graph data', () => {
  it('buckets of 5 s: slowest reply, lost count, fight flag, start in epoch seconds', () => {
    const base = Math.floor(T0 / 5000) * 5000;   // a bucket boundary
    const s = [
      { t: base + 500, ms: 10, fight: false }, { t: base + 1500, ms: 40, fight: false }, { t: base + 2500, ms: null, fight: false },
      { t: base + 5500, ms: null, fight: true }, { t: base + 6500, ms: null, fight: false },
    ];
    expect(_netSeries(s, base + 9_000, 600_000)).toEqual([
      [base / 1000, 40, 1, 0],
      [base / 1000 + 5, null, 2, 1],
    ]);
  });

  it('ten minutes of one-a-second samples is at most 120 points, even when the window starts mid-bucket', () => {
    const base = Math.floor(T0 / 5000) * 5000;
    const s = mk(rep(600, 5), { start: base + 2500 });   // 600 pings straddle 121 buckets
    const out = _netSeries(s, base + 2500 + 599_000, 600_000);
    expect(out.length).toBe(120);
    expect(out[out.length - 1][0]).toBe((base + 2500 + 599_000 - ((base + 2500 + 599_000) % 5000)) / 1000);   // the newest bucket is kept
  });

  it('the newest fight run of at least 10 samples is the last fight', () => {
    const flags = [...rep(5, 0), ...rep(20, 1), ...rep(5, 0), ...rep(4, 1), ...rep(3, 0)];
    const s = mk(rep(flags.length, 7), { fight: (i) => flags[i] });
    // the 4-sample run is newer but too short: the 20-sample run is the answer
    expect(_netFightSpan(s)).toEqual({ from: T0 + 5_000, to: T0 + 24_000 });
    expect(_netFightSpan(s, 4)).toEqual({ from: T0 + 30_000, to: T0 + 33_000 });
    expect(_netFightSpan(mk(rep(30, 7)))).toBeNull();
    expect(_netFightSpan([])).toBeNull();
  });
});

describe('GET /api/net payload', () => {
  const net = _netTargetsForTest();
  afterEach(() => {
    _netSetPlatformForTest(process.platform);
    for (const t of [net.router, net.game]) { t.host = null; t.ip = null; t.samples = []; t.error = null; }
    net.gameNote = null;
  });

  // Two minutes of pings: router ~2 ms and clean, server ~48 ms with two lost. Samples 80-99 are a fight.
  const fixture = () => {
    _netSetPlatformForTest('win32');
    net.router.host = '192.168.1.1';
    net.game.host = 'login.example.com'; net.game.ip = '93.184.216.34';
    net.router.samples = mk(rep(120, 2), { fight: (i) => i >= 80 && i < 100 });
    net.game.samples = mk(Array.from({ length: 120 }, (_, i) => (i === 30 || i === 31 ? null : 48)), { fight: (i) => i >= 80 && i < 100 });
    return T0 + 119_000;
  };

  it('is not supported off Windows, and says so in words', () => {
    _netSetPlatformForTest('linux');
    const p = _netPayload(T0);
    expect(p).toMatchObject({ supported: false, enabled: false, targets: { router: null, game: null }, lastFight: null });
    expect(p.verdict.code).toBe('unknown');
    expect(p.verdict.text).toMatch(/Windows/);
    expect(p.series).toEqual({ router: [], game: [] });
  });

  it('carries targets, both windows of stats, the verdict, series and the last fight', () => {
    const now = fixture();
    const p = _netPayload(now);
    expect(p.supported).toBe(true);
    expect(p.enabled).toBe(true);
    expect(p.targets.router).toEqual({ ip: '192.168.1.1' });
    expect(p.targets.game).toEqual({ host: 'login.example.com', ip: '93.184.216.34', source: 'eqhost.txt' });
    expect(p.stats.router.m1).toMatchObject({ count: 60, lost: 0, median: 2 });
    expect(p.stats.game.m10).toMatchObject({ count: 120, lost: 2, median: 48 });
    expect(p.stats.game.m10.lossPct).toBeCloseTo(1.667, 2);
    expect(p.verdict.code).toBe('ok');   // 1.7% is under the 2% line
    expect(p.series.router.length).toBeGreaterThan(0);
    expect(p.series.router.length).toBeLessThanOrEqual(120);
    expect(p.lastFight.router).toMatchObject({ count: 20, lost: 0 });
    expect(p.lastFight.game).toMatchObject({ count: 20, lost: 0, median: 48 });
  });

  it('a target with no address is null in targets and stats, and the reason rides along', () => {
    _netSetPlatformForTest('win32');
    net.router.host = '192.168.1.1';
    net.router.samples = mk(rep(40, 2));
    net.gameNote = 'no eqhost.txt in your EverQuest folder';
    const p = _netPayload(T0 + 39_000);
    expect(p.targets.game).toBeNull();
    expect(p.stats.game).toBeNull();
    expect(p.series.game).toEqual([]);
    expect(p.notes.game).toBe('no eqhost.txt in your EverQuest folder');
    expect(p.verdict.code).toBe('unknown');
    expect(p.lastFight).toBeNull();
  });

  it('it is JSON-clean: no NaN or undefined survives', () => {
    const now = fixture();
    const json = JSON.stringify(_netPayload(now));
    expect(json).not.toMatch(/NaN|undefined/);
  });
});

describe('wiring in the shipped source', () => {
  const agentSrc = readSource(AGENT_INDEX);
  const js = stripJs(agentSrc);

  it('GET /api/net and POST /api/net/toggle are routes, and the toggle persists net_meter_off', () => {
    expect(js).toMatch(/req\.method === 'GET' && \(req\.url === '\/api\/net'/);
    const toggle = sliceBlock(js, "if (req.url === '/api/net/toggle' && req.method === 'POST') {", "\n      }\n");
    expect(toggle).toMatch(/_saveAgentPrefs\(\{ net_meter_off: off \}\)/);
  });

  it('it pings with a hidden window, IPv4 only, a one-second timeout and a count (never an endless -t)', () => {
    const spawn = sliceBlock(js, "require('child_process').spawn('ping'", "{ windowsHide: true");
    expect(spawn).toMatch(/'-n', String\(NET_RUN_PINGS\)/);
    expect(spawn).toMatch(/'-4', '-w', '1000'/);
    expect(spawn).not.toMatch(/'-t'/);
  });

  it('it starts with the watch loop, and its children are killed on exit', () => {
    expect(js).toMatch(/try \{ _netStart\(\); \} catch/);
    expect(js).toMatch(/process\.on\('exit', _netStopAll\)/);
  });

  it('it uploads nothing: no bot URL, no upload queue, no network call in the meter block', () => {
    const block = stripJs(sliceBlock(agentSrc, 'const NET_RING_MS', '// ── Time-window mode (backfill)'));   // slice by the comment anchors first, strip after
    expect(block).not.toMatch(/botUrl|_uploadQueue|enqueue|https?\.request|fetch\(/);
  });
});

describe('Tick overlay line', () => {
  const html = readSource(path.join(ROOT, 'apps', 'mimic', 'zealhealth.html'));
  const netLine = new Function(sliceBlock(html, '  function netLine(n){', '\n  }\n') + '\nreturn netLine;')();

  const payload = (m1, extra = {}) => ({
    supported: true, enabled: true,
    targets: { router: { ip: '192.168.1.1' }, game: { host: 'login.example.com', source: 'eqhost.txt' } },
    stats: { game: { m1 }, router: { m1: { count: 60, lost: 0, lossPct: 0, median: 2, p95: 3, last: 2 } } },
    verdict: { code: 'ok', text: 'Your connection looks healthy.' },
    ...extra,
  });
  const m = (o) => ({ count: 60, lost: 0, lossPct: 0, median: 48, p95: 60, last: 47, ...o });

  it('reads like "📶 Quarm 48 ms · 0% loss" and carries the verdict in the tooltip', () => {
    const v = netLine(payload(m()));
    expect(v.text).toBe('📶 Quarm 48 ms · 0% loss');
    expect(v.cls).toBe('');
    expect(v.title).toMatch(/^Your connection looks healthy\./);
    expect(v.title).toMatch(/now 47 ms, median 48 ms, p95 60 ms, 0% loss/);
  });

  it('amber from 2% loss or a 150 ms p95, red from 10% or 300 ms — the edges included', () => {
    expect(netLine(payload(m({ lossPct: 1.9 }))).cls).toBe('');
    expect(netLine(payload(m({ lossPct: 2 }))).cls).toBe('warn');
    expect(netLine(payload(m({ p95: 150 }))).cls).toBe('');
    expect(netLine(payload(m({ p95: 151 }))).cls).toBe('warn');
    expect(netLine(payload(m({ lossPct: 10 }))).cls).toBe('bad');
    expect(netLine(payload(m({ p95: 300 }))).cls).toBe('warn');
    expect(netLine(payload(m({ p95: 301 }))).cls).toBe('bad');
    expect(netLine(payload(m({ lossPct: 2.5 }))).text).toBe('📶 Quarm 48 ms · 2.5% loss');
  });

  it('with no game address it shows the router; with neither, nothing', () => {
    const noGame = payload(m(), { targets: { router: { ip: '192.168.1.1' }, game: null } });
    expect(netLine(noGame).text).toBe('📶 Router 2 ms · 0% loss');
    expect(netLine(payload(m(), { targets: { router: null, game: null } }))).toBeNull();
  });

  it('hidden when the meter is off, unsupported, or the agent is too old to have it', () => {
    expect(netLine(payload(m(), { enabled: false }))).toBeNull();
    expect(netLine(payload(m(), { supported: false }))).toBeNull();
    expect(netLine(null)).toBeNull();
    expect(netLine({})).toBeNull();
  });

  it('before the first ping lands it says it is looking, and when every ping was lost it says so', () => {
    expect(netLine(payload({ count: 0 })).text).toBe('📶 Quarm …');
    const dead = netLine(payload(m({ count: 30, lost: 30, lossPct: 100, median: null, p95: null, last: null })));
    expect(dead.text).toBe('📶 Quarm no reply · 100% loss');
    expect(dead.cls).toBe('bad');
  });

  it('the line sits under the status row, hands the mouse over on hover, and is polled every 5 s from the agent port', () => {
    expect(html).toMatch(/<div id="status"[^>]*><\/div>\s*<div id="net" data-wp-interact style="display:none"><\/div>\s*<div id="detail"/);
    const js = stripJs(html);
    expect(js).toMatch(/fetch\('http:\/\/127\.0\.0\.1:'\+PORT\+'\/api\/net'/);
    expect(js).toMatch(/setInterval\(pollNet, 5000\)/);
  });
});

describe('Diagnostics card', () => {
  const dash = readSource(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'));
  const code = sliceBlock(dash, 'var _wpNet = {', '\nfunction wpNetRepaint');
  const render = new Function('esc', code.replace(/\nfunction wpNetRepaint$/, '\n') + '\nreturn { wpNetHtml, _wpNetSummary, _wpNetChart, _wpNet };');
  const esc = (s) => String(s || '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const { wpNetHtml, _wpNetSummary, _wpNetChart } = render(esc);

  const net = _netTargetsForTest();
  afterEach(() => {
    _netSetPlatformForTest(process.platform);
    for (const t of [net.router, net.game]) { t.host = null; t.ip = null; t.samples = []; }
  });
  const livePayload = () => {
    _netSetPlatformForTest('win32');
    net.router.host = '192.168.1.1';
    net.game.host = 'login.example.com';
    net.router.samples = mk(rep(120, 2), { fight: (i) => i >= 80 && i < 100 });
    net.game.samples = mk(Array.from({ length: 120 }, (_, i) => (i % 60 === 5 ? null : 48 + (i % 7))), { fight: (i) => i >= 80 && i < 100 });
    return JSON.parse(JSON.stringify(_netPayload(T0 + 119_000)));
  };

  it('the placeholder is emitted by renderDiag and filled by renderNetMeter after it', () => {
    const diag = sliceBlock(dash, 'function renderDiag(s) {', '\n}\n');
    expect(diag).toContain('id="wpNetMeter"');
    const order = [...dash.matchAll(/\['([a-z]+)', (render[A-Za-z]+)\]/g)].map(x => x[2]);
    expect(order.indexOf('renderNetMeter')).toBeGreaterThan(order.indexOf('renderDiag'));
  });

  it('paints the verdict, the chart, the stats rows and both buttons from a real payload', () => {
    const html = wpNetHtml(livePayload());
    expect(html).toContain('✓ Looks healthy');       // 1.7% loss on the server line is under the 2% line
    expect(html).toContain('<svg');
    expect(html).toContain('<path');                 // the two lines
    expect(html).toContain('fill="#f85149"');        // lost pings marked
    expect(html).toContain('opacity="0.12"');        // the fight band
    expect(html).toContain('Copy summary');
    expect(html).toContain('wpNetToggle(this.checked)');
    expect(html).not.toMatch(/NaN|undefined|null/);
    expect(html).not.toContain('<details');
    expect(html).not.toContain('class="name"');
  });

  it('amber from 2% loss or a 150 ms p95, red from 10% or 300 ms — the same lines as the overlay', () => {
    // the table only: the verdict heading and the legend's lost-ping mark carry these colours too
    const tone = (m1) => { const p = livePayload(); Object.assign(p.stats.game.m1, m1); const h = wpNetHtml(p); return h.slice(h.indexOf('<table'), h.indexOf('</table>')); };
    expect(tone({})).not.toMatch(/color:var\(--(orange|red)\)/);
    expect(tone({ lossPct: 3 })).toContain('color:var(--orange)');
    expect(tone({ p95: 151 })).toContain('color:var(--orange)');
    expect(tone({ lossPct: 12 })).toContain('color:var(--red)');
    expect(tone({ p95: 301 })).toContain('color:var(--red)');
  });

  it('is byte-stable: the same data paints the same HTML', () => {
    const p = livePayload();
    expect(wpNetHtml(p)).toBe(wpNetHtml(JSON.parse(JSON.stringify(p))));
  });

  it('the Discord summary is one short paragraph with the verdict and both lines', () => {
    const t = _wpNetSummary(livePayload());
    expect(t).not.toContain('\n');
    expect(t).toMatch(/^Connection check from my PC/);
    expect(t).toMatch(/Router median 2 ms, p95 2 ms, 0% loss\./);
    expect(t).toMatch(/Game server median \d+ ms, p95 \d+ ms, [\d.]+% loss\./);
    expect(t).toMatch(/During my last fight \(20 pings\)/);
    expect(t.length).toBeLessThan(700);
  });

  it('says plainly when it is unsupported, off, loading, or the agent is too old', () => {
    expect(wpNetHtml(null)).toMatch(/Reading the connection meter/);
    expect(wpNetHtml({ error: true })).toMatch(/not available from this engine/);
    _netSetPlatformForTest('linux');
    const off = wpNetHtml(JSON.parse(JSON.stringify(_netPayload(T0))));
    expect(off).toMatch(/only runs on Windows/);
    expect(off).not.toContain('<svg');
    expect(wpNetHtml({ supported: true, enabled: false, verdict: { code: 'unknown', text: 'The connection meter is turned off.' } })).toMatch(/turned off/);
  });

  it('a missing target is explained in the table, not drawn as zeros', () => {
    const p = livePayload();
    p.targets.game = null; p.stats.game = null; p.series.game = []; p.notes.game = 'no eqhost.txt in your EverQuest folder';
    const html = wpNetHtml(p);
    expect(html).toMatch(/no server address — no eqhost\.txt in your EverQuest folder/);
  });

  it('the chart caps the axis, so one huge spike cannot flatten everything else', () => {
    const p = livePayload();
    p.series.game = [[T0 / 1000, 90_000, 0, 0]];
    expect(_wpNetChart(p)).toContain('1000 ms');
  });
});
