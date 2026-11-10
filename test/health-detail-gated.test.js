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
