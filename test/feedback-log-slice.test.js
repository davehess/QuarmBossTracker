// test/feedback-log-slice.test.js — the log a bug report is allowed to carry.
//
// The guild lead, 2026-09-02: "give mimic a feedback entry point that allows for direct
// log collection timeframe."
//
// ⚠ THE WHOLE RISK IS ON ONE SIDE. A bug report with no log is a guessing game,
// but a bug report carrying someone's whole log is a privacy incident that we
// caused, on a platform whose central promise (docs/PRIVACY.md) is that officer
// chat, tells and group never leave the machine. Every assertion here is about
// what must NOT be in the slice.
//
// ⚠ Redaction REUSES triggerVisibleLine — the same audited predicate the local
// trigger engine is gated on. A bespoke second filter here would be a second
// thing to keep correct, and this one already is. Do not hand-roll one.
//
// Run: npx vitest run test/feedback-log-slice.test.js

import { describe, it, expect, afterAll } from 'vitest';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, ROOT, stripJs } from './_source-slice.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const { _feedbackLineAllowed } = agent;
const T = '[Wed Sep 02 11:40:47 2026] ';

describe('what must never reach a bug report', () => {
  it('drops the officer channel', () => {
    expect(_feedbackLineAllowed(T + "Hitya tells Wolfpackofficer:1, 'loot call after this'")).toBe(false);
  });

  it('drops tells in both directions', () => {
    expect(_feedbackLineAllowed(T + "Uilnayar tells you, 'you around later?'")).toBe(false);
    expect(_feedbackLineAllowed(T + "You told Uilnayar, 'give me ten'")).toBe(false);
  });

  it('drops group chat', () => {
    expect(_feedbackLineAllowed(T + "Kazmodon tells the group, 'oom'")).toBe(false);
  });

  it('drops every custom channel, not just the officer one', () => {
    expect(_feedbackLineAllowed(T + "Someone tells Lfg:3, 'need a port'")).toBe(false);
    expect(_feedbackLineAllowed(T + "Someone tells General:2, 'anyone selling'")).toBe(false);
  });

  // Not private to the reporter, but it names other players wholesale and is
  // never what makes a bug reproducible.
  it('drops /who output', () => {
    expect(_feedbackLineAllowed(T + 'Players on EverQuest:')).toBe(false);
    expect(_feedbackLineAllowed(T + '[60 Wizard] Kazmodon (Gnome) <Wolf Pack>')).toBe(false);
    expect(_feedbackLineAllowed(T + 'There are 14 players in Plane of Hate.')).toBe(false);
  });

  it('drops your location', () => {
    expect(_feedbackLineAllowed(T + 'Your Location is 1234.56, -789.01, 42.00')).toBe(false);
  });
});

describe('what must survive, or the report is useless', () => {
  it('keeps combat lines', () => {
    expect(_feedbackLineAllowed(T + 'You kick an elemental deceiver for 102 points of damage.')).toBe(true);
    expect(_feedbackLineAllowed(T + 'Lord of Ire hits YOU for 202 points of damage.')).toBe(true);
  });

  it('keeps spell and emote lines — the ones triggers fire on', () => {
    expect(_feedbackLineAllowed(T + 'an elemental deceiver yawns.')).toBe(true);
    expect(_feedbackLineAllowed(T + 'You feel replenished.')).toBe(true);
    expect(_feedbackLineAllowed(T + 'Your spell fizzles.')).toBe(true);
  });

  it('keeps zone and system lines that give a report its context', () => {
    expect(_feedbackLineAllowed(T + 'You have entered Plane of Hate.')).toBe(true);
    expect(_feedbackLineAllowed(T + 'Auto attack is on.')).toBe(true);
  });

  // The reporter's own name is the one identity that has to stay — it is how a
  // report is reproducible at all, and it is their own.
  it('keeps lines naming the reporter', () => {
    expect(_feedbackLineAllowed(T + 'Hitya begins to cast a spell.')).toBe(true);
  });
});

describe('guard rails', () => {
  it('has caps, so a raid night cannot ship a 40MB attachment', () => {
    expect(typeof agent.buildFeedbackLogSlice).toBe('function');
  });

  it('refuses cleanly when no log is being watched', () => {
    const r = agent.buildFeedbackLogSlice(30, Date.now());
    // No watched logs in a test process — must be a clean refusal, never a throw
    // and never a slice of something else.
    expect(r.ok).toBe(false);
    expect(String(r.reason)).toMatch(/no EQ log/i);
  });
});

// ── Which lines survive the cap ─────────────────────────────────────────────
// FB-51 (2026-10-05): a busy hour overflowed the caps and the slice kept the
// OLDEST 6,000 lines — the excerpt ended 44 minutes before it was sent, so the
// part the reporter was complaining about was exactly what got cut. The slice
// keeps the NEWEST lines.
describe('a window larger than the caps keeps the NEWEST lines', () => {
  const MAX_LINES = 6000, MAX_BYTES = 512 * 1024;   // FEEDBACK_MAX_LINES / FEEDBACK_MAX_BYTES
  const T0 = new Date(2026, 8, 2, 12, 0, 0).getTime();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const p2 = (n) => String(n).padStart(2, '0');
  const stamp = (ms) => { const d = new Date(ms); return `[${DOW[d.getDay()]} ${MON[d.getMonth()]} ${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())} ${d.getFullYear()}]`; };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'feedback-slice-'));
  afterAll(() => { agent._setWatchedLogsForTest([]); fs.rmSync(dir, { recursive: true, force: true }); });

  // `n` lines, two per second from T0; line i reads "... for <i> points ...".
  function slice(name, n, { minutes = 120, pad = '', every } = {}) {
    const file = path.join(dir, name);
    const lines = [];
    for (let i = 0; i < n; i++) {
      const ms = T0 + Math.floor(i / 2) * 1000;
      lines.push(every && i % every === 0
        ? `${stamp(ms)} Uilnayar tells you, 'private ${i}'`
        : `${stamp(ms)} You kick an elemental deceiver for ${i} points of damage.${pad}`);
    }
    fs.writeFileSync(file, lines.join('\n') + '\n');
    agent._setWatchedLogsForTest([{ character: 'Aldenmar', logPath: file, lastSeen: 1 }]);
    const nowMs = T0 + Math.floor(n / 2) * 1000 + 1000;
    return { r: agent.buildFeedbackLogSlice(minutes, nowMs), lines, nowMs };
  }
  const idxOf = (line) => Number(/for (\d+) points/.exec(line)[1]);

  it('line cap: the last 6,000 lines, truncated, from/to are the kept lines', () => {
    const { r, lines } = slice('lines.txt', MAX_LINES + 1500);
    expect(r.ok).toBe(true);
    expect(r.truncated).toBe(true);
    expect(r.lines).toBe(MAX_LINES);
    const out = r.text.split('\n');
    expect(out).toHaveLength(MAX_LINES);
    expect(out[out.length - 1]).toBe(lines[lines.length - 1]);          // the newest line is in
    expect(idxOf(out[0])).toBe(1500);                                    // the oldest 1,500 are what went
    expect(r.to).toBe(new Date(T0 + Math.floor((MAX_LINES + 1499) / 2) * 1000).toISOString());
    expect(r.from).toBe(new Date(T0 + Math.floor(1500 / 2) * 1000).toISOString());
    expect(r.bytes).toBe(out.reduce((a, l) => a + l.length + 1, 0));
  });

  it('byte cap: the newest lines that fit, and not one more', () => {
    const pad = ' x'.repeat(150);                                         // ~340-char lines: 3,000 of them is ~1 MB
    const { r, lines } = slice('bytes.txt', 3000, { pad });
    expect(r.truncated).toBe(true);
    expect(r.bytes).toBeLessThanOrEqual(MAX_BYTES);
    expect(r.lines).toBeGreaterThan(1000);
    expect(r.lines).toBeLessThan(3000);
    const out = r.text.split('\n');
    expect(out[out.length - 1]).toBe(lines[2999]);
    expect(out[0]).toBe(lines[3000 - r.lines]);                          // contiguous run ending at the newest
    const nextOlder = lines[3000 - r.lines - 1];
    expect(r.bytes + nextOlder.length + 1).toBeGreaterThan(MAX_BYTES);   // maximal: the next one would not have fit
  });

  it('a window that fits is returned whole and is not truncated', () => {
    const { r, lines } = slice('fits.txt', 400);
    expect(r.truncated).toBe(false);
    expect(r.lines).toBe(400);
    expect(r.text.split('\n')).toEqual(lines);
    expect(r.from).toBe(new Date(T0).toISOString());
    expect(r.to).toBe(new Date(T0 + 199 * 1000).toISOString());
  });

  it('redaction still applies, and `removed` counts the whole window, not just what was read', () => {
    const { r } = slice('private.txt', MAX_LINES + 1500, { every: 10 });
    expect(r.text).not.toMatch(/tells you/);
    expect(r.removed).toBe(Math.ceil((MAX_LINES + 1500) / 10));
    expect(r.truncated).toBe(true);
    expect(r.lines).toBe(MAX_LINES);
  });

  it('lines older than the window are not in the slice and are not counted as removed', () => {
    const { r } = slice('window.txt', 400, { minutes: 1 });              // newest minute of a ~3-minute log
    expect(r.truncated).toBe(false);
    expect(r.removed).toBe(0);
    expect(r.lines).toBeGreaterThan(0);
    expect(r.lines).toBeLessThan(400);
    const out = r.text.split('\n');
    expect(idxOf(out[out.length - 1])).toBe(399);
  });

  it('drops the partial first line when the read starts mid-file', () => {
    // 25 MB of old, 100-byte filler lines, then a few recent ones: the 24 MB tail read starts mid-line.
    const file = path.join(dir, 'big.txt');
    const old = `${stamp(T0 - 3 * 3600_000)} filler line to pad the log out `.padEnd(99, '.') + '\n';
    const recent = Array.from({ length: 5 }, (_, i) => `${stamp(T0 + i * 1000)} You kick an elemental deceiver for ${i} points of damage.`);
    const fd = fs.openSync(file, 'w');
    const chunk = old.repeat(10_000);
    for (let i = 0; i < 26; i++) fs.writeSync(fd, chunk);
    fs.writeSync(fd, recent.join('\n') + '\n');
    fs.closeSync(fd);
    const size = fs.statSync(file).size;
    const start = size - 24 * 1024 * 1024;
    const probe = fs.openSync(file, 'r'); const b = Buffer.alloc(1);
    fs.readSync(probe, b, 0, 1, start - 1); fs.closeSync(probe);
    expect(b.toString()).not.toBe('\n');                                 // precondition: the read really lands mid-line
    agent._setWatchedLogsForTest([{ character: 'Aldenmar', logPath: file, lastSeen: 1 }]);
    const r = agent.buildFeedbackLogSlice(120, T0 + 10_000);
    expect(r.text.split('\n')).toEqual(recent);                          // no fragment of a half line rides along
  });
});

// ── The dashboard card ──────────────────────────────────────────────────────
describe('the feedback card cannot ship a log by accident', () => {
  const dash = stripJs(readSource(
    path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html')));

  // ⚠ The failure this guards against is the worst one available to this
  // platform: quietly uploading someone's log because they typed in a box.
  it('attaches nothing unless the box is ticked', () => {
    expect(dash).toContain('attach_log: !!(cb && cb.checked && _wpFbKind === \'bug\')');
  });

  it('previews before it can be sent — the preview route sends nothing', () => {
    expect(dash).toContain("fetch('/api/feedback-preview'");
    expect(dash).toContain("fetch('/api/feedback-send'");
  });

  it('shows how many private lines the filter removed', () => {
    expect(dash).toMatch(/private lines removed/);
  });

  it('says the preview is only the head, so nobody reads it as everything', () => {
    expect(dash).toMatch(/first 400 lines/);
  });

  // A log slice explains a bug. Offering it on "please add a dark mode" invites
  // data we asked for and do not need.
  it('hides the attach row entirely for ideas, and unticks it', () => {
    expect(dash).toContain("row.style.display = _wpFbKind === 'bug' ? 'flex' : 'none'");
    expect(dash).toContain('if (cb) cb.checked = false;');
  });

  // The card holds a half-typed report and the dashboard repaints every ~2s.
  it('builds once and never re-renders over the textarea', () => {
    expect(dash).toContain('if (el._wpBuilt) return;');
  });

  // Tray ↔ dashboard parity (CLAUDE.md): a tray route that lands on a collapsed
  // card has not delivered the thing it promised.
  it('opens itself when the tray deep-links to it', () => {
    expect(dash).toContain("wpKeep('feedback', _fbWanted)");
    expect(dash).toMatch(/location\.hash.*#feedback/);
    const tray = stripJs(readSource(path.join(ROOT, 'apps', 'mimic', 'main.js')));
    expect(tray).toContain("label: 'Send feedback — bug or idea'");
    expect(tray).toContain('/#feedback');
  });
});
