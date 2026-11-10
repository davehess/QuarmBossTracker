// test/web-member-gate.test.js — member pages re-check guild membership on every request (2026-11-10).
//
// A signed-in session is not proof of membership: some sign-in doors ask for no guild, and a session outlives a
// departure. So every page and route handler under web/app that reads with the server key (supabaseAdmin) must ask
// web/lib/member.ts (requireMember / isGuildMember), go through the officer gate (which implies membership), or be
// on the list below with its reason. A new route that reads with the server key fails here until it does one of those.
//
// Comments are stripped before matching (CLAUDE.md "comments satisfy text assertions"): this file's own header and the
// sources' headers name these helpers.
//
// Run: npx vitest run test/web-member-gate.test.js

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';

const APP = path.join(ROOT, 'web', 'app');

// Routes that are deliberately NOT member-gated. Keys are paths under web/app; a key ending in "/" covers the subtree.
const OPEN = {
  'auth/callback/route.ts': 'the sign-in callback itself: it establishes membership (and refuses non-members on wolfpack.quest); raidmimic hosts take the open path by design',
  'about/page.tsx': 'public page: aggregate stats only',
  'shortabout/page.tsx': 'public page: aggregate stats only',
  'opendkp/page.tsx': 'public status page by design (its header explains)',
  'feedback/page.tsx': 'public feedback form, open to everyone; only reads the submitter\'s own display name',
  'feedback/[ref]/page.tsx': 'a report opens only for its own submitter or an officer (lib access check); a departed member keeps their own report',
  'share/raid/[token]/page.tsx': 'public share link: the token is the credential',
  'api/share/': 'public share link routes: the token is the credential',
  'api/hubs/route.ts': 'public guild directory read by Mimic\'s picker and raidmimic.com',
  'guilds/': 'raidmimic open path (isRaidmimicOpenPath): any signed-in Discord user, by design (DECISIONS §492)',
  'auth/claim/page.tsx': 'sign-in surface: an officer-issued invite is redeemed here by someone who is not yet signed in',
  'me/': 'own-data pages keyed to the signed-in user; a departed member must still reach them to export or delete their data',
};

// Admin: the officer gate asks the same question (isOfficer requires a current-member row), so these only need to call it.
const ADMIN_PREFIX = 'admin/';

const GATE = [
  /\brequireMember\(/,
  /\bisGuildMember\(/,
  /\brequireOfficer\(/,
  /!\s*\(?\s*await isOfficer\(/,      // officer-only route handlers answer 403 on this
];

function walk(dir, rel = '') {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const r = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(path.join(dir, e.name), r));
    else if (e.name === 'page.tsx' || e.name === 'route.ts') out.push(r);
  }
  return out;
}

const isOpen = (rel) => Object.keys(OPEN).some(k => (k.endsWith('/') ? rel.startsWith(k) : rel === k));
const usesServerKey = (src) => /\bsupabaseAdmin\(/.test(src) || /SUPABASE_SERVICE_ROLE_KEY/.test(src);

describe('member pages re-check guild membership', () => {
  const all = walk(APP);
  const reading = all.filter(rel => usesServerKey(stripJs(readSource(path.join(APP, rel)))));

  it('finds the routes (the walk is not vacuous)', () => {
    expect(all.length).toBeGreaterThan(100);
    expect(reading.length).toBeGreaterThan(50);
    expect(reading).toContain('parses/page.tsx');
  });

  it('every route that reads with the server key is gated or on the open list', () => {
    const ungated = reading.filter(rel => {
      if (isOpen(rel)) return false;
      const src = stripJs(readSource(path.join(APP, rel)));
      return !GATE.some(rx => rx.test(src));
    });
    expect(ungated).toEqual([]);
  });

  it('the open list names only routes that exist (no stale entries)', () => {
    for (const k of Object.keys(OPEN)) {
      const hit = k.endsWith('/') ? all.some(r => r.startsWith(k)) : all.includes(k);
      expect(hit, k).toBe(true);
    }
  });

  it('every open entry carries a reason', () => {
    for (const [k, why] of Object.entries(OPEN)) expect(why.length, k).toBeGreaterThan(10);
  });

  it('page-level gates run before the page reads anything (the call follows the signed-in check)', () => {
    // A gate placed after the page's first read would guard nothing. Helpers above the page may hold supabaseAdmin(,
    // so compare inside the default-exported function's own body.
    let checked = 0;
    for (const rel of reading.filter(r => r.endsWith('page.tsx') && !isOpen(r) && !r.startsWith(ADMIN_PREFIX))) {
      const src = stripJs(readSource(path.join(APP, rel)));
      const body = src.slice(src.search(/export default async function/));
      const gate = body.search(/\brequireMember\(|\bisGuildMember\(/);
      if (gate === -1) continue;
      const read = body.search(/\bsupabaseAdmin\(|\bawait load\w*\(/);
      if (read !== -1) expect(gate, rel).toBeLessThan(read);
      checked++;
    }
    expect(checked).toBeGreaterThan(40);
  });
});

describe('the helper and the officer gate', () => {
  const MEMBER = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'member.ts')));
  const OFFICER = stripJs(readSource(path.join(ROOT, 'web', 'lib', 'officer.ts')));

  it('membership means is_member = true, read per request and failing closed', () => {
    expect(MEMBER).toMatch(/\.select\('is_member'\)/);
    expect(MEMBER).toMatch(/\.eq\('user_id', userId\)/);
    expect(MEMBER).toMatch(/is_member\?: boolean \| null \} \| null\)\?\.is_member === true/);
    expect(MEMBER).toMatch(/cache\(async/);
    expect(MEMBER).toMatch(/catch \{\s*return false;/);
  });

  it('a non-member page request is sent to sign-in with an explanation', () => {
    expect(MEMBER).toMatch(/redirect\(`\/auth\/signin\?error=/);
  });

  it('an officer is a member first', () => {
    expect(OFFICER).toMatch(/select\('role_names, is_member'\)/);
    expect(OFFICER).toMatch(/\.is_member !== true\) return false/);
  });
});
