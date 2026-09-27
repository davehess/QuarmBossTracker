// test/feedback-ingest.test.js — the bot half of in-Mimic feedback.
//
// The guild lead, 2026-09-02: "give mimic a feedback entry point that allows for direct
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
import { readSource, BOT_INDEX, ROOT, sliceBlock, stripJs } from './_source-slice.js';

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
  // Raised 2026-09-26 from 1 MB to 16 MB for up to three screenshots.
  it('caps the request body', () => {
    expect(fn).toContain('if (total > 16 * 1024 * 1024)');
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
    const ackAt  = fn.indexOf("res.end(JSON.stringify({ ok: true, stored: !!saved, screenshots: shotPaths.length }))");
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

// ── Screenshots (the guild lead, 2026-09-26: "feedback and suggestion needs to be able to take
// screenshots..top priority") ────────────────────────────────────────────────
import { createRequire } from 'node:module';
const shots = createRequire(import.meta.url)('../utils/feedbackShots.js');
const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);
const WEBP = Buffer.concat([Buffer.from('RIFF'), Buffer.alloc(4), Buffer.from('WEBP'), Buffer.alloc(60, 3)]);
const dataUrl = (buf, mime) => 'data:' + mime + ';base64,' + buf.toString('base64');

describe('screenshots: only real images get in', () => {
  it('knows a JPEG, a PNG and a WebP by their bytes', () => {
    expect(shots.sniffImage(JPEG)).toBe('image/jpeg');
    expect(shots.sniffImage(PNG)).toBe('image/png');
    expect(shots.sniffImage(WEBP)).toBe('image/webp');
  });
  it('trusts the bytes, not the label: an HTML file called image/png is dropped', () => {
    const html = Buffer.from('<html><script>alert(1)</script></html>'.padEnd(80, ' '));
    expect(shots.decodeShot(dataUrl(html, 'image/png'))).toBe(null);
    expect(shots.decodeShot(dataUrl(PNG, 'text/html')).mime).toBe('image/png');
  });
  it('drops anything over the 5 MB cap, and keeps at most three', () => {
    const big = Buffer.concat([JPEG, Buffer.alloc(shots.MAX_BYTES)]);
    expect(shots.decodeShot(dataUrl(big, 'image/jpeg'))).toBe(null);
    // Three bytes over: short enough to pass the base64-length pre-check, so
    // this one is caught by the decoded-size check itself.
    const justOver = Buffer.concat([JPEG, Buffer.alloc(shots.MAX_BYTES + 3 - JPEG.length)]);
    expect(shots.decodeShot(dataUrl(justOver, 'image/jpeg'))).toBe(null);
    const four = [JPEG, PNG, WEBP, JPEG].map(b => dataUrl(b, 'image/jpeg'));
    expect(shots.decodeShots(four)).toHaveLength(3);
  });
  it('ignores junk instead of throwing', () => {
    expect(shots.decodeShots('not a list')).toEqual([]);
    expect(shots.decodeShots([null, 42, '', 'data:image/png;base64,@@@'])).toEqual([]);
  });
  it('names stored files by month, source and a random id — never by who sent them', () => {
    const p = shots.shotPath('mimic', 'image/jpeg', Date.UTC(2026, 8, 26));
    expect(p).toMatch(/^2026-09\/mimic\/\d+-[0-9a-f]{12}\.jpg$/);
    expect(shots.shotPath('../../etc Aldenmar', 'image/png')).toMatch(/^\d{4}-\d{2}\/etcAldenmar\//);
  });
  it('turns stored images into Discord attachments, and skips anything that is not one', () => {
    const files = shots.discordFiles([JPEG, Buffer.from('nope'), { buf: PNG }]);
    expect(files.map(f => f.name)).toEqual(['screenshot-1.jpg', 'screenshot-3.png']);
  });
  it('refuses a path that could walk out of the bucket', async () => {
    const was = [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, globalThis.fetch];
    process.env.SUPABASE_URL = 'http://storage.test'; process.env.SUPABASE_SERVICE_ROLE_KEY = 'x';
    const asked = [];
    // A storage that would happily serve anything, so only the path check can say no.
    globalThis.fetch = async (url) => { asked.push(url); return { ok: true, arrayBuffer: async () => JPEG }; };
    try {
      expect(await shots.downloadShot('2026-09/mimic/1-abc.jpg')).toEqual(JPEG);
      expect(await shots.downloadShot('../other-bucket/x.jpg')).toBe(null);
      expect(asked).toHaveLength(1);
    } finally { [process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, globalThis.fetch] = was; }
  });
});

describe('screenshots: every feedback path stores and posts them', () => {
  it('the Mimic/Parser route stores them before the row, and posts them as attachments', () => {
    const up = fn.indexOf("await shotsMod.uploadShots(shots, 'mimic')");
    const ins = fn.indexOf("supabase.insert('feedback', [row])");
    expect(up).toBeGreaterThan(-1);
    expect(ins).toBeGreaterThan(up);
    expect(fn).toContain('if (shotPaths.length) row.screenshot_paths = shotPaths;');
    expect(fn).toContain('files: shotsMod.discordFiles(shots),');
  });
  // The double post: relayWebFeedback posts every row with no discord_msg_id.
  it('stamps its Discord post on the row so the web relay does not post it again', () => {
    expect(fn).toMatch(/supabase\.update\('feedback', `id=eq\.\$\{encodeURIComponent\(id\)\}`, \{ discord_msg_id: sent\.id/);
  });
  it('the web relay attaches stored screenshots', () => {
    const relay = sliceBlock(bot, 'async function relayWebFeedback(readyClient) {', '\n}\n');
    expect(relay).toContain('screenshot_paths');
    expect(relay).toContain('downloadShot(pth)');
    expect(relay).toMatch(/thread\.send\(\{ embeds: \[embed\], components: \[row\], files \}\)/);
  });
  it('Discord /feedback copies an image instead of linking the expiring CDN url', () => {
    const cmd = stripJs(readSource(ROOT + '/commands/feedback.js'));
    expect(cmd).not.toContain('embed.setImage(screenshot.url)');
    expect(cmd).toContain("await shotsMod.uploadShots([shot], 'discord')");
    expect(cmd).toContain('screenshot_paths: shotPaths');
  });
});
