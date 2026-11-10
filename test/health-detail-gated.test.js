// GET /health: readiness is public, operational detail needs a valid session token.
import { describe, it, expect } from 'vitest';
import { BOT_INDEX, readSource, stripJs } from './_source-slice.js';

describe('/health detail gating', () => {
  const src = stripJs(readSource(BOT_INDEX));
  const health = src.slice(src.indexOf("req.url === '/health'"));
  const body = health.slice(0, health.indexOf('// Default: health check'));

  it('detail fields sit behind peekAgentAuth, not in the base object', () => {
    expect(body).toMatch(/await mimicLink\.peekAgentAuth\(req\)\) \? \{[^}]*supabase_breaker[^}]*\} : \{\}/);
    expect(body).toMatch(/ok: ready, ready, shutting_down: _shuttingDown, version:[^}]*\.\.\._detailed/);
  });
});

describe('salt fallbacks fail closed in production', () => {
  const rd = (p) => stripJs(readSource(new URL('../' + p, import.meta.url).pathname));
  it('the bot replay window throws without DEMO_OBFUSCATE_SALT in production', () => {
    expect(rd('utils/raidReplayWindow.js')).toMatch(/NODE_ENV === 'production'[^\n]*throw new Error\('DEMO_OBFUSCATE_SALT is not set'\)/);
  });
  it('the website salts throw in production, and the feedback IP hash is an HMAC', () => {
    for (const f of ['lib/obfuscate.ts', 'lib/raidShareLookup.ts']) {
      expect(rd('web/' + f)).toMatch(/NODE_ENV === 'production'\) throw new Error\('DEMO_OBFUSCATE_SALT is not set'\)/);
    }
    for (const f of ['app/eqmimic/feedback/actions.ts', 'app/raidmimic/register/actions.ts']) {
      const s = rd('web/' + f);
      expect(s).toMatch(/createHmac\('sha256', salt\)\.update\(ip\)/);
      expect(s).not.toMatch(/createHash/);
    }
  });
});
