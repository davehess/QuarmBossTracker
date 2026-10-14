// test/member-lockout-web.test.js — the website half of the member lockout (the guild lead, 2026-10-13:
// "lock out members despite discord roles and invalidate mimic sessions"; DECISIONS-2026-09-21.md §252).
//
// The rule (web/lib/lockout.ts) is run for real: an active row is one with no end, or an end in the future, and a
// signed-in user is locked when their auth id OR their Discord id is in it. The read fails OPEN to the last known
// set. The wiring (middleware, sign-in callback, invite claim, the two officer actions) is held by source
// assertions with comments stripped, because a comment explaining the rule would otherwise satisfy the match.
//
// Run: npx vitest run test/member-lockout-web.test.js

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs } from './_source-slice.js';

// lockout.ts reads through the service client; the test hands it a scripted one.
const db = vi.hoisted(() => ({ rows: [], error: null, throws: false, calls: 0 }));
vi.mock('../web/lib/supabase.ts', () => ({
  supabaseAdmin: () => ({
    from: () => ({
      select: () => ({
        limit: async () => {
          db.calls++;
          if (db.throws) throw new Error('db down');
          return { data: db.error ? null : db.rows, error: db.error };
        },
      }),
    }),
  }),
}));

const src = (rel) => stripJs(fs.readFileSync(path.join(ROOT, rel), 'utf8'));
const NOW = Date.parse('2026-10-13T12:00:00Z');
const iso = (ms) => new Date(ms).toISOString();

async function fresh() {
  vi.resetModules();
  return await import('../web/lib/lockout.ts');
}

describe('which lockout rows are active', () => {
  it('no end date, or an end in the future, is active; a past end is not', async () => {
    const { isActiveRow, activeSets } = await fresh();
    expect(isActiveRow({ until: null }, NOW)).toBe(true);
    expect(isActiveRow({ until: iso(NOW + 1000) }, NOW)).toBe(true);
    expect(isActiveRow({ until: iso(NOW - 1000) }, NOW)).toBe(false);
    expect(isActiveRow({ until: iso(NOW) }, NOW)).toBe(false);
    const s = activeSets([
      { discord_id: '111', user_id: 'u-1', until: null },
      { discord_id: '222', user_id: 'u-2', until: iso(NOW - 5000) },   // expired: inert
      { discord_id: '333', user_id: null, until: iso(NOW + 5000) },
    ], NOW);
    expect([...s.byDiscord].sort()).toEqual(['111', '333']);
    expect([...s.byUser]).toEqual(['u-1']);
  });
});

describe('who a lockout matches', () => {
  const locks = { byDiscord: new Set(['111']), byUser: new Set(['u-9']) };

  it('by auth user id, by the OAuth provider id, by sub, and by the password-invite metadata id', async () => {
    const { matchesLockout, discordIdOf } = await fresh();
    expect(matchesLockout({ id: 'u-9' }, locks)).toBe(true);
    expect(matchesLockout({ id: 'x', user_metadata: { provider_id: '111' } }, locks)).toBe(true);
    expect(matchesLockout({ id: 'x', app_metadata: { provider_id: '111' } }, locks)).toBe(true);
    expect(matchesLockout({ id: 'x', user_metadata: { sub: '111' } }, locks)).toBe(true);
    expect(matchesLockout({ id: 'x', user_metadata: { discord_id: '111' } }, locks)).toBe(true);
    expect(discordIdOf({ user_metadata: { provider_id: 123 } })).toBe('123');   // always a string
  });

  it('does not match anyone else, nobody, or an empty set', async () => {
    const { matchesLockout } = await fresh();
    expect(matchesLockout({ id: 'u-1', user_metadata: { provider_id: '222' } }, locks)).toBe(false);
    expect(matchesLockout({ id: 'u-1' }, locks)).toBe(false);
    expect(matchesLockout(null, locks)).toBe(false);
    expect(matchesLockout({ id: 'u-9', user_metadata: { provider_id: '111' } }, { byDiscord: new Set(), byUser: new Set() })).toBe(false);
  });
});

describe('the cached read', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    db.rows = [{ discord_id: '111', user_id: 'u-1', until: null }];
    db.error = null; db.throws = false; db.calls = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('reads once per 20 seconds however many requests ask, then refreshes', async () => {
    const { isLockedOut } = await fresh();
    const u = { id: 'u-1' };
    expect(await isLockedOut(u)).toBe(true);
    expect(await isLockedOut(u)).toBe(true);
    await Promise.all([isLockedOut(u), isLockedOut(u), isLockedOut(u)]);
    expect(db.calls).toBe(1);
    vi.setSystemTime(NOW + 21_000);
    db.rows = [];
    expect(await isLockedOut(u)).toBe(false);   // the unlock is seen after the TTL
    expect(db.calls).toBe(2);
  });

  it('shares one in-flight read between concurrent first requests', async () => {
    const { isLockedOut } = await fresh();
    await Promise.all([isLockedOut({ id: 'a' }), isLockedOut({ id: 'b' }), isLockedOut({ id: 'c' })]);
    expect(db.calls).toBe(1);
  });

  it('fails OPEN: a failed read keeps the last known set, and is empty if there never was one', async () => {
    const { isLockedOut } = await fresh();
    db.throws = true;
    expect(await isLockedOut({ id: 'u-1' })).toBe(false);          // never had a set: empty, not locked
    db.throws = false;
    vi.setSystemTime(NOW + 6_000);                                   // past the failure back-off
    expect(await isLockedOut({ id: 'u-1' })).toBe(true);
    db.error = { message: 'boom' };
    vi.setSystemTime(NOW + 40_000);
    expect(await isLockedOut({ id: 'u-1' })).toBe(true);           // read failed: last known set stands
  });

  it('does not hammer the database while it is failing', async () => {
    const { isLockedOut } = await fresh();
    db.throws = true;
    await isLockedOut({ id: 'u-1' });
    await isLockedOut({ id: 'u-1' });
    await isLockedOut({ id: 'u-1' });
    expect(db.calls).toBe(1);
  });

  it('a signed-out request never reads', async () => {
    const { isLockedOut } = await fresh();
    expect(await isLockedOut(null)).toBe(false);
    expect(db.calls).toBe(0);
  });
});

describe('middleware enforces it on every request that has a user', () => {
  const mw = src('web/middleware.ts');

  it('asks the lockout check once a user is known, and before the page-view log', () => {
    expect(mw).toMatch(/import \{ isLockedOut \} from '\.\/lib\/lockout';/);
    const ask = mw.indexOf('await isLockedOut(user)');
    expect(ask).toBeGreaterThan(mw.indexOf('supabase.auth.getUser()'));
    expect(ask).toBeLessThan(mw.indexOf("from('page_views')"));
    expect(mw).toMatch(/if \(user && !lockoutExempt\(request\.nextUrl\.pathname\) && \(await isLockedOut\(user\)\)\)/);
  });

  it('signs them out and redirects to /auth/paused (303), clearing the auth cookies by hand', () => {
    const fn = mw.slice(mw.indexOf('async function lockedOutResponse'), mw.indexOf('export async function middleware'));
    expect(fn).toMatch(/supabase\.auth\.signOut\(\)/);
    expect(fn).toMatch(/NextResponse\.redirect\(new URL\('\/auth\/paused', request\.url\), 303\)/);
    expect(fn).toMatch(/sb-\.\*-auth-token/);
    expect(fn).toMatch(/maxAge: 0/);
  });

  it('never redirects /auth/paused to itself, and always enforces /api/', () => {
    const fn = mw.slice(mw.indexOf('function lockoutExempt'), mw.indexOf('async function lockedOutResponse'));
    expect(fn).toMatch(/pathname === '\/auth\/paused'\) return true/);
    expect(fn.indexOf("startsWith('/api/')")).toBeLessThan(fn.indexOf("startsWith('/_next/')"));
  });

  it('runs on the Edge: the lockout module uses no Node-only API', () => {
    const lib = src('web/lib/lockout.ts');
    expect(lib).not.toMatch(/from 'node:|from "node:|require\(|\bBuffer\b|process\.(?!env)|from 'fs'|from 'crypto'/);
  });
});

describe('sign-in is refused for a locked member', () => {
  it('the OAuth callback checks after the role gate, before the member upsert, signs out and goes to /auth/paused', () => {
    const cb = src('web/app/auth/callback/route.ts');
    const check = cb.indexOf('await isLockedOut(');
    expect(check).toBeGreaterThan(cb.indexOf('hasAllowedRole'));
    expect(check).toBeLessThan(cb.indexOf("from('wolfpack_members').upsert"));
    const block = cb.slice(check, cb.indexOf("from('wolfpack_members').upsert"));
    expect(block).toMatch(/provider_id: member\.user\.id/);
    expect(block).toMatch(/supabase\.auth\.signOut\(\)/);
    expect(block).toMatch(/\/auth\/paused/);
  });

  it('the invite claim refuses a locked member in the action and on the page', () => {
    const claim = src('web/app/auth/claim/page.tsx');
    expect(claim).toMatch(/import \{ isLockedOut \} from '@\/lib\/lockout';/);
    expect(claim.match(/await isLockedOut\(/g)).toHaveLength(2);
    expect(claim.match(/redirect\('\/auth\/paused'\)/g)).toHaveLength(2);
    // the action's check sits before any account is created or reset
    expect(claim.indexOf('await isLockedOut(')).toBeLessThan(claim.indexOf('auth.admin.createUser'));
  });

  it('the paused page is public and says the plain words', () => {
    const page = fs.readFileSync(path.join(ROOT, 'web/app/auth/paused/page.tsx'), 'utf8');
    expect(page).toMatch(/Your access to the guild(&apos;|')s tools is paused\. Ask an officer if you think this is a mistake\./);
    expect(stripJs(page)).not.toMatch(/supabase|requireOfficer|getUser/);
  });
});

describe('the officer actions', () => {
  const act = src('web/app/admin/access/actions.ts');
  const lock = act.slice(act.indexOf('export async function lockMember'), act.indexOf('export async function unlockMember'));
  const unlock = act.slice(act.indexOf('export async function unlockMember'));

  it('both are server actions that check the officer role first', () => {
    expect(act).toMatch(/^'use server';/);
    expect(lock).toMatch(/^[^\n]*\n\s*const userId = await requireOfficer\(\);/);
    expect(unlock).toMatch(/^[^\n]*\n\s*const userId = await requireOfficer\(\);/);
  });

  it('lock: refuses locking yourself, requires a reason of at most 200 characters', () => {
    expect(lock).toMatch(/discordId === actor!\.discordId\) redirect\(`\$\{PAGE\}\?err=self`\)/);
    expect(lock).toMatch(/if \(!reason\) redirect/);
    expect(lock).toMatch(/reason\.length > REASON_MAX/);
    expect(act).toMatch(/const REASON_MAX = 200;/);
  });

  it('lock: officers cannot be locked out (refused before the row is written), and the picker leaves them out', () => {
    const refuse = lock.search(/if \(roleNamesAreOfficer\(target!\.role_names\)\) redirect\(`\$\{PAGE\}\?err=officer`\)/);
    expect(refuse).toBeGreaterThan(-1);
    expect(refuse).toBeLessThan(lock.indexOf(".from('member_lockouts').upsert("));
    expect(lock).toMatch(/\.select\('discord_id, user_id, nickname, global_name, role_names'\)/);
    const page = src('web/app/admin/access/page.tsx');
    expect(page).toMatch(/\.filter\(m => !lockedIds\.has\(m\.discord_id\) && !roleNamesAreOfficer\(m\.role_names\)\)/);
    const off = src('web/lib/officer.ts');
    expect(off).toMatch(/export function roleNamesAreOfficer\(names: unknown\): boolean \{\n\s*if \(!Array\.isArray\(names\)\) return false;\n\s*const allow = new Set\(_officerNames\(\)\);\n\s*return names\.some/);
  });

  it('lock: upserts the row with the member user id and who locked, clears expired rows', () => {
    expect(lock).toMatch(/from\('member_lockouts'\)\.upsert\(\{[^}]*discord_id:[^}]*user_id:[^}]*reason,[^}]*locked_by_discord_id: actor!\.discordId[^}]*until,/s);
    expect(lock).toMatch(/from\('member_lockouts'\)\.delete\(\)\.not\('until', 'is', null\)\.lt\('until', now\)/);
  });

  it('lock: revokes only this member\'s live Mimic sessions', () => {
    expect(lock).toMatch(/from\('mimic_sessions'\)\s*\.update\(\{ revoked_at: now \}\)\s*\.eq\('discord_id', discordId\)\s*\.is\('revoked_at', null\)/);
  });

  it('lock and unlock each write an audit_log row, and revalidate the page', () => {
    expect(lock).toMatch(/from\('audit_log'\)\.insert\(\{\s*action:\s*'member_lockout',\s*actor_discord_id:[^}]*actor_name:[^}]*payload:\s*\{[^}]*sessions_revoked/s);
    expect(unlock).toMatch(/from\('audit_log'\)\.insert\(\{\s*action:\s*'member_unlock'/);
    expect(unlock).toMatch(/from\('member_lockouts'\)\.delete\(\)\.eq\('discord_id', discordId\)/);
    expect(lock).toMatch(/revalidatePath\(PAGE\)/);
    expect(unlock).toMatch(/revalidatePath\(PAGE\)/);
  });

  it('the page gates itself first and is marked [beta]', () => {
    const page = src('web/app/admin/access/page.tsx');
    const at = page.indexOf('export default async function');
    expect(page.slice(at)).toMatch(/\)\s*\{\s*await requireOfficer\(\);/);
    expect(page).toMatch(/<NewPageTag \/>/);
    expect(page).toMatch(/title: '\[beta\]/);
    expect(src('web/app/admin/page.tsx')).toMatch(/href="\/admin\/access"/);
  });
});
