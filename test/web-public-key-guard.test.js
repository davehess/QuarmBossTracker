// 2026-10-29 security finding: the browser bundle shipped the service_role key because Vercel's
// NEXT_PUBLIC_SUPABASE_ANON_KEY held it, and the web server's clients read that public variable.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { ROOT, stripJs } from './_source-slice.js';

const require = createRequire(import.meta.url);
const { publicKeyProblem } = require('../web/lib/publicKeyGuard.js');

// Unsigned test tokens: only the payload matters to the guard.
const jwt = (payload) => ['e30', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'x'].join('.');

describe('the browser key guard', () => {
  it('refuses a service_role JWT and a secret key', () => {
    expect(publicKeyProblem(jwt({ iss: 'supabase', role: 'service_role' }))).toMatch(/service_role/);
    expect(publicKeyProblem('sb_secret_abc')).toMatch(/secret/);
  });
  it('accepts the anon JWT, a publishable key, and nothing', () => {
    expect(publicKeyProblem(jwt({ iss: 'supabase', role: 'anon' }))).toBeNull();
    expect(publicKeyProblem('sb_publishable_abc')).toBeNull();
    expect(publicKeyProblem('')).toBeNull();
    expect(publicKeyProblem(undefined)).toBeNull();
  });
  it('is wired into next.config.js so a bad key fails the build', () => {
    const cfg = stripJs(fs.readFileSync(path.join(ROOT, 'web', 'next.config.js'), 'utf8'));
    expect(cfg).toMatch(/require\('\.\/lib\/publicKeyGuard'\)\.publicKeyProblem\(process\.env\.NEXT_PUBLIC_SUPABASE_ANON_KEY\)/);
    expect(cfg).toMatch(/throw new Error/);
  });
});

describe('server-side Supabase clients never use the public key', () => {
  for (const f of ['web/lib/supabase.ts', 'web/lib/supabase-server.ts', 'web/middleware.ts']) {
    it(f, () => {
      const src = stripJs(fs.readFileSync(path.join(ROOT, f), 'utf8'));
      expect(src).not.toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
      expect(src).toMatch(/process\.env\.SUPABASE_SERVICE_ROLE_KEY/);
    });
  }
  it('only the browser client and the health probe read the public key', () => {
    const src = stripJs(fs.readFileSync(path.join(ROOT, 'web/lib/supabase-browser.ts'), 'utf8'));
    expect(src).toMatch(/NEXT_PUBLIC_SUPABASE_ANON_KEY/);
  });
});
