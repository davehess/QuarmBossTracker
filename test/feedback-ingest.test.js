// test/feedback-ingest.test.js — the bot half of in-Mimic feedback.
//
// Hitya, 2026-09-02: "give mimic a feedback entry point that allows for direct
// log collection timeframe."
//
// ⚠ THE BOT DOES NOT REDACT AND MUST NOT PRETEND TO. Redaction happens in the
// agent, before upload, using triggerVisibleLine — the same audited predicate
// the local trigger engine is gated on (test/feedback-log-slice.test.js). By the
// time bytes reach here, officer chat, tells, group and /who are already gone.
// Adding a second filter here would create the illusion of a safety net that
// only runs after the data has already left the reporter's machine.
//
// Run: npx vitest run test/feedback-ingest.test.js

import { describe, it, expect } from 'vitest';
import { readSource, BOT_INDEX, sliceBlock, stripJs } from './_source-slice.js';

const bot = stripJs(readSource(BOT_INDEX));
const fn  = sliceBlock(bot, 'async function _handleAgentFeedback(req, res) {', '\nasync function _handleTriggerRelayPost');

describe('what it stores', () => {
  it('requires auth like every other agent route', () => {
    expect(fn).toContain('await mimicLink.requireAgentAuth(req, res)');
  });

  it('attributes the report to the authenticated uploader, not to a client claim', () => {
    // The submitter id comes from the bearer identity. Trusting a body field
    // would let anyone file feedback as anyone.
    expect(fn).toContain('submitter_discord_id: identity.discord_id || null,');
    expect(fn).not.toMatch(/submitter_discord_id:\s*p\?\./);
  });

  it('rejects an empty report rather than storing a blank row', () => {
    expect(fn).toContain('if (message.length < 10)');
  });

  it('only ever records two categories', () => {
    expect(fn).toContain("category:             p?.category === 'bug' ? 'bug' : 'idea',");
  });

  it('bounds every free-text field it writes', () => {
    for (const cap of ['.slice(0, 4000)', '.slice(0, 64)', '.slice(0, 600_000)']) {
      expect(fn).toContain(cap);
    }
  });

  // A log excerpt is bigger than any other ingest payload, and a report larger
  // than the agent could have produced is malformed, not thorough.
  it('caps the request body', () => {
    expect(fn).toContain('if (total > 1024 * 1024)');
  });
});

describe('what it must not do', () => {
  // ⚠ See the header. A filter here would run after upload and imply a
  // protection that does not exist.
  it('does not re-implement redaction', () => {
    expect(fn).not.toMatch(/tells you|Wolfpackofficer|triggerVisibleLine|DROP_PATTERNS/);
  });

  // The reporter previewed exactly these bytes before ticking the box; storing
  // something else would make the preview a lie.
  it('stores the excerpt as sent rather than reprocessing it', () => {
    expect(fn).toContain("typeof p?.log_excerpt === 'string' ? p.log_excerpt.slice(0, 600_000) : null");
  });

  // Discord being slow or down must never cost someone their bug report.
  it('answers the agent before it posts to Discord', () => {
    const ackAt  = fn.indexOf("res.end(JSON.stringify({ ok: true, stored: !!saved }))");
    const postAt = fn.indexOf('channels.fetch(threadId)');
    expect(ackAt).toBeGreaterThan(-1);
    expect(postAt).toBeGreaterThan(ackAt);
  });

  it('survives a missing feedback thread without failing the submit', () => {
    expect(fn).toContain('if (!threadId) return;');
  });
});

describe('the officer notification', () => {
  // The point of showing the count: an officer can see the redaction ran, and
  // roughly how much was taken out, without opening the excerpt.
  it('reports how much was attached and how much was removed', () => {
    expect(fn).toMatch(/lines over/);
    expect(fn).toMatch(/private lines removed/);
  });

  it('flags a truncated slice so nobody reads it as the whole story', () => {
    expect(fn).toMatch(/truncated/);
  });
});
