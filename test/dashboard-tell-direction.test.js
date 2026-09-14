// test/dashboard-tell-direction.test.js — the dashboard's tells read from the speaker.
//
// Hitya, 2026-09-14: "These are still going the wrong direction." Both Recent
// Tells renderers on the dashboard drew a received tell as "Other ← You",
// which reads as You speaking. Now both read SPEAKER → LISTENER, matching the
// bot's DM relay (test/tell-relay-direction.test.js). Text assertions on the
// comment-stripped renderers, sliced by their own code lines.
//
// Run: npx vitest run test/dashboard-tell-direction.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

const raw = fs.readFileSync(path.join(ROOT, 'packages', 'wolfpack-logsync', 'dashboard.html'), 'utf8');
const between = (a, b) => { const i = raw.indexOf(a); const j = raw.indexOf(b, i); if (i < 0 || j < 0) throw new Error('anchor missing'); return stripJs(raw.slice(i, j)); };

const card  = between("const tells = (s.recentTells || []).slice(-5).reverse();", "esc(String(t.text || '').slice(0, 48))");
const table = between("const _rtVisible = _rt.slice(-15).reverse();", "const tsMs = t.capturedAt || (t.ts ? new Date(t.ts).getTime() : Date.now());");

describe('Recent tells, compact card', () => {
  it('reads speaker → listener and never draws a left arrow', () => {
    expect(card).toMatch(/t\.direction === 'outgoing' \? meSpan \+ ' → ' \+ otherSpan : otherSpan \+ ' → ' \+ meSpan/);
    expect(card).not.toMatch(/←/);
  });
});

describe('Recent Tells table', () => {
  it('reads speaker → listener and never draws a left arrow', () => {
    expect(table).toMatch(/\? '<span class="dim">' \+ esc\(t\.character\) \+ '<\/span> → ' \+ otherLink/);
    expect(table).toMatch(/: otherLink \+ ' → <span class="dim">' \+ esc\(t\.character\) \+ '<\/span>'/);
    expect(table).not.toMatch(/←/);
  });
});
