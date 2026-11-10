// Standard browser security headers on every route (2026-11-10). Loads web/next.config.js for real.
import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';
import path from 'node:path';
import { ROOT } from './_source-slice.js';

const cfg = createRequire(import.meta.url)(path.join(ROOT, 'web', 'next.config.js'));

describe('next.config headers()', async () => {
  const rules = await cfg.headers();
  const all = rules.find(r => r.source === '/(.*)');
  const h = Object.fromEntries(all.headers.map(x => [x.key, x.value]));

  it('sets the standard header set on /(.*)', () => {
    expect(h['X-Content-Type-Options']).toBe('nosniff');
    expect(h['Referrer-Policy']).toBe('strict-origin-when-cross-origin');
    expect(h['Strict-Transport-Security']).toBe('max-age=31536000; includeSubDomains');
    for (const f of ['camera', 'microphone', 'geolocation', 'payment']) expect(h['Permissions-Policy']).toContain(`${f}=()`);
  });

  it('enforces same-origin framing only (the site frames its own pages)', () => {
    expect(h['X-Frame-Options']).toBe('SAMEORIGIN');
    expect(h['Content-Security-Policy']).toBe("frame-ancestors 'self'");
  });

  it('ships the full CSP report-only, with the known hosts', () => {
    const csp = h['Content-Security-Policy-Report-Only'];
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain('https://zhtoekwakucbckvatfky.supabase.co');
    expect(csp).toContain('wss://zhtoekwakucbckvatfky.supabase.co');
    expect(csp).toContain('https://medal.tv');
    expect(csp).toContain("object-src 'none'");
  });

  it('keeps the /share noindex rules', () => {
    expect(rules.find(r => r.source === '/share/:path*').headers[0].key).toBe('X-Robots-Tag');
  });
});
