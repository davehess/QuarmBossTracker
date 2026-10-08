// test/tail-watchdog.test.js — the log reader says so when it stops, and recovers.
//
// FB-51 (2026-10-05): after a restart one install tailed a log from offset == size
// and delivered nothing for 25+ minutes while the event loop stayed alive. The
// mechanism was never pinned. One candidate: tailFile is a self-scheduling
// setTimeout chain over fs.promises calls, so ONE promise that never settles ends
// the chain forever, silently. tailFile now carries a watchdog that reads the file
// with SYNC fs when a read has hung (or the chain has died), warns once, and hands
// back to the async reader when it recovers.
//
// ⚠ The load-bearing property is "never the same bytes twice": a late-settling
// async read, or a stale stat taken before the watchdog advanced, must not
// re-deliver anything. Both are driven below with a fs.promises that hangs.
//
// Run: npx vitest run test/tail-watchdog.test.js

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import agent from '../packages/wolfpack-logsync/index.js';

const { _tailStalled, tailFile, _tailStatus } = agent;

describe('_tailStalled — the decision', () => {
  const base = { inFlightSince: 0, lastDoneAt: 1_000_000, size: 500, pos: 500, now: 1_000_000, thresholdMs: 15_000 };

  it('a healthy loop is never stalled', () => {
    expect(_tailStalled({ ...base, now: base.now + 400 })).toBe(false);
    expect(_tailStalled({ ...base, size: 900, now: base.now + 400 })).toBe(false);   // growth, but a read finished a moment ago
  });

  it('one read in flight past the threshold is stalled, under it is not', () => {
    const inFlightSince = 1_000_000;
    expect(_tailStalled({ ...base, inFlightSince, now: inFlightSince + 14_999 })).toBe(false);
    expect(_tailStalled({ ...base, inFlightSince, now: inFlightSince + 15_000 })).toBe(true);
  });

  it('a dead chain is stalled once the file has moved: growth', () => {
    expect(_tailStalled({ ...base, size: 900, now: base.now + 17_000 })).toBe(true);
  });

  it('a dead chain is stalled once the file has moved: rotation below pos', () => {
    expect(_tailStalled({ ...base, size: 10, now: base.now + 17_000 })).toBe(true);
  });

  it('a quiet file is not a stall, however long since the last read finished', () => {
    // Nothing to read is not a problem the reader can have.
    expect(_tailStalled({ ...base, now: base.now + 600_000 })).toBe(false);
  });

  it('is off without a positive threshold', () => {
    expect(_tailStalled({ ...base, size: 900, now: base.now + 99_000, thresholdMs: 0 })).toBe(false);
    expect(_tailStalled({ ...base, size: 900, now: base.now + 99_000, thresholdMs: undefined })).toBe(false);
  });
});

// ── tailFile against a real file, with fs.promises made to hang ─────────────
let dir;
beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tail-watchdog-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});
afterAll(() => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* */ } });

const warnsFor = (base) => console.warn.mock.calls.map(c => c.join(' ')).filter(s => s.includes(base));
const waitFor = async (cond, ms = 6000) => {
  const end = Date.now() + ms;
  while (Date.now() < end) { if (cond()) return true; await new Promise(r => setTimeout(r, 15)); }
  return cond();
};
const settle = (ms) => new Promise(r => setTimeout(r, ms));

// Make one fs.promises method hang for `file` (calls on other paths pass through)
// until release(). A hung stat resolves LATE with what it saw when it was issued.
function hangFs(file, method) {
  const real = fs.promises[method];
  const held = [];
  let on = true;
  fs.promises[method] = (p, ...rest) => {
    if (!on || String(p) !== file) return real(p, ...rest);
    const seen = method === 'stat' ? fs.statSync(file) : null;
    return new Promise(res => held.push(() => res(method === 'stat' ? seen : real(p, ...rest))));
  };
  return {
    release() { on = false; for (const f of held.splice(0)) f(); },
    restore() { fs.promises[method] = real; },
  };
}

function start(name, initial) {
  const file = path.join(dir, name);
  fs.writeFileSync(file, initial);
  const got = [];
  return { file, got, base: name };
}

describe('tailFile — healthy case is unchanged', () => {
  it('delivers each line once, carries a partial line over, and never calls itself stalled', async () => {
    const t = start('eqlog_Aldenmar_pq.proj.txt', 'before the tail\n');
    await tailFile(t.file, l => t.got.push(l), { stallMs: 5000, watchdogMs: 20 });
    fs.appendFileSync(t.file, 'one\ntwo\n');
    fs.appendFileSync(t.file, 'thr');
    expect(await waitFor(() => t.got.length === 2)).toBe(true);
    fs.appendFileSync(t.file, 'ee\n');
    expect(await waitFor(() => t.got.length === 3)).toBe(true);
    await settle(300);
    expect(t.got).toEqual(['one', 'two', 'three']);
    const st = _tailStatus.get(t.base);
    expect(st.stalled).toBe(false);
    expect(st.stalls).toBe(0);
    expect(st.syncReads).toBe(0);
    expect(warnsFor(t.base)).toEqual([]);
  }, 10_000);
});

describe('tailFile — a read that never settles', () => {
  it('warns once, keeps delivering synchronously, and never delivers a byte twice', async () => {
    const t = start('eqlog_Brackwyn_pq.proj.txt', 'before the tail\n');
    await tailFile(t.file, l => t.got.push(l), { stallMs: 600, watchdogMs: 40 });
    const hang = hangFs(t.file, 'open');
    try {
      fs.appendFileSync(t.file, 'l1\nl2\n');
      // The async reader's first pass (500 ms) opens the file and hangs for good.
      expect(await waitFor(() => t.got.length === 2)).toBe(true);
      expect(t.got).toEqual(['l1', 'l2']);

      const st = _tailStatus.get(t.base);
      expect(st.stalled).toBe(true);
      expect(st.stalls).toBe(1);

      // Still stalled: later lines (and a line split across two writes) keep coming.
      fs.appendFileSync(t.file, 'l3\nl4-par');
      fs.appendFileSync(t.file, 'tial\n');
      expect(await waitFor(() => t.got.length === 4)).toBe(true);
      expect(t.got).toEqual(['l1', 'l2', 'l3', 'l4-partial']);

      // ONE warning for the whole episode, and it says what it knows.
      const stallWarns = warnsFor(t.base).filter(s => /reads stopped/.test(s));
      expect(stallWarns).toHaveLength(1);
      expect(stallWarns[0]).toMatch(/no read finished for \d+s/);
      expect(stallWarns[0]).toMatch(/KB ahead/);
      expect(stallWarns[0]).toMatch(/reading synchronously/);

      // The hung read finally settles. It was opened for bytes the watchdog
      // already delivered: it must discard them, and say it recovered.
      hang.release();
      expect(await waitFor(() => warnsFor(t.base).some(s => /recovered/.test(s)))).toBe(true);
      await settle(200);
      expect(t.got).toEqual(['l1', 'l2', 'l3', 'l4-partial']);
      expect(st.stalled).toBe(false);
      expect(st.syncReads).toBeGreaterThan(0);

      // And the async reader is back in charge.
      fs.appendFileSync(t.file, 'l5\n');
      expect(await waitFor(() => t.got.length === 5)).toBe(true);
      await settle(200);
      expect(t.got).toEqual(['l1', 'l2', 'l3', 'l4-partial', 'l5']);
      expect(warnsFor(t.base).filter(s => /reads stopped/.test(s))).toHaveLength(1);
    } finally { hang.release(); hang.restore(); }
  }, 20_000);

  it('a stat that settles late is not mistaken for a rotation', async () => {
    // The stat was issued before the watchdog advanced pos, so its size is OLDER
    // than pos. Read as "size < pos" it would look like a rotation, reset pos to
    // 0 and re-deliver the whole file.
    const t = start('eqlog_Corvale_pq.proj.txt', 'before the tail\nsecond old line\n');
    await tailFile(t.file, l => t.got.push(l), { stallMs: 700, watchdogMs: 40 });
    const hang = hangFs(t.file, 'stat');
    try {
      fs.appendFileSync(t.file, 'a1\n');
      await settle(560);                       // the first async pass (500 ms) has issued its stat and hung
      fs.appendFileSync(t.file, 'a2\na3\n');   // grows AFTER that stat saw the file
      expect(await waitFor(() => t.got.length === 3)).toBe(true);
      expect(t.got).toEqual(['a1', 'a2', 'a3']);

      hang.release();                          // the stale stat settles now
      expect(await waitFor(() => warnsFor(t.base).some(s => /recovered/.test(s)))).toBe(true);
      await settle(300);
      expect(t.got).toEqual(['a1', 'a2', 'a3']);
      expect(warnsFor(t.base).some(s => /file rotated/.test(s))).toBe(false);
    } finally { hang.release(); hang.restore(); }
  }, 20_000);

  it('a real rotation while stalled resets and reads the new file from the top', async () => {
    const t = start('eqlog_Nyssara_pq.proj.txt', 'a long first file with enough text in it to matter\n');
    await tailFile(t.file, l => t.got.push(l), { stallMs: 600, watchdogMs: 40 });
    const hang = hangFs(t.file, 'open');
    try {
      fs.appendFileSync(t.file, 'x1\n');
      expect(await waitFor(() => t.got.length === 1)).toBe(true);
      fs.writeFileSync(t.file, 'new1\nnew2\n');   // smaller than pos: the archiver renamed it away
      expect(await waitFor(() => t.got.length === 3)).toBe(true);
      expect(t.got).toEqual(['x1', 'new1', 'new2']);
    } finally { hang.release(); hang.restore(); }
  }, 20_000);
});
