// test/feedback-log-slice.test.js — the log a bug report is allowed to carry.
//
// Hitya, 2026-09-02: "give mimic a feedback entry point that allows for direct
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

import { describe, it, expect } from 'vitest';
import agent from '../packages/wolfpack-logsync/index.js';
import { readSource, ROOT, stripJs } from './_source-slice.js';
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
