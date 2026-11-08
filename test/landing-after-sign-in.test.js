// test/landing-after-sign-in.test.js — where a member lands after Discord sign-in (the guild lead, 2026-10-31: "when they
// auth, I want it to be the page they land on if they went to the main page /"). On the beta build, '/' becomes the /me
// hub; production keeps '/'. Any other asked-for page is untouched on both. The open-redirect sanitising
// (safeNext in app/auth/callback/route.ts) runs first and is not changed: a target it throws away arrives here as '/'.
//
// Run: npx vitest run test/landing-after-sign-in.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, sliceBlock, evalBlock } from './_source-slice.js';
import { landingAfterSignIn, HUB_LANDING } from '../web/lib/landing.ts';

const ROUTE = fs.readFileSync(path.join(ROOT, 'web', 'app', 'auth', 'callback', 'route.ts'), 'utf8');

// The REAL safeNext, with its TypeScript annotations taken off so it can be evaluated.
const safeNext = evalBlock(
  sliceBlock(ROUTE, 'function safeNext', '\n}\n').replace('raw: string | null', 'raw').replace('): string {', ') {'),
  ['safeNext'],
).safeNext;

describe('landingAfterSignIn', () => {
  it('beta: the main page lands on the hub', () => {
    expect(HUB_LANDING).toBe('/me?v=b');
    expect(landingAfterSignIn('/', true)).toBe('/me?v=b');
  });
  it('production: the main page stays the main page', () => {
    expect(landingAfterSignIn('/', false)).toBe('/');
  });
  it('any other target is unchanged on both builds', () => {
    for (const next of ['/me', '/pop/raid', '/character/Aldenmar/gear', '/me?v=b', '/?x=1', '/raid/review/2026-10-30']) {
      expect(landingAfterSignIn(next, true), next).toBe(next);
      expect(landingAfterSignIn(next, false), next).toBe(next);
    }
  });
});

describe('with the real sanitiser in front', () => {
  const landing = (raw, beta) => landingAfterSignIn(safeNext(raw), beta);
  it('no next, or the home page, lands on the hub on beta and home on production', () => {
    for (const raw of [null, '', '/']) {
      expect(landing(raw, true), String(raw)).toBe('/me?v=b');
      expect(landing(raw, false), String(raw)).toBe('/');
    }
  });
  it('a target the sanitiser throws away still lands safely (the hub on beta, home on production)', () => {
    for (const raw of ['//evil.example', 'https://x.example/phish', '/\\evil', 'javascript:alert(1)', '/%0d%0aSet-Cookie:x=1', '%2F%2Fevil.example']) {
      expect(safeNext(raw), raw).toBe('/');
      expect(landing(raw, true), raw).toBe('/me?v=b');
      expect(landing(raw, false), raw).toBe('/');
    }
  });
  it('a real page asked for survives untouched', () => {
    expect(landing('/pop/raid', true)).toBe('/pop/raid');
    expect(landing('%2Fme', true)).toBe('/me');
  });
});

describe('the callback', () => {
  const code = stripJs(ROUTE);
  it('applies it to the sanitised target, from the build-time beta flag, and nowhere else', () => {
    expect(code).toMatch(/const next = safeNext\(url\.searchParams\.get\('next'\)\);/);
    expect(code).toMatch(/NextResponse\.redirect\(`\$\{origin\}\$\{landingAfterSignIn\(next, process\.env\.NEXT_PUBLIC_IS_BETA === '1'\)\}`\)/);
    expect(code.match(/landingAfterSignIn\(/g)).toHaveLength(1);
  });
  it('the sanitiser still carries every one of its guards', () => {
    const body = sliceBlock(code, 'function safeNext', '\n}\n');
    expect(body).toContain("v.startsWith('//')");
    expect(body).toContain("v.startsWith('/\\\\')");
    expect(body).toContain('[\\r\\n]');
    expect(body).toMatch(/!v\.startsWith\('\/'\)/);
  });
});
