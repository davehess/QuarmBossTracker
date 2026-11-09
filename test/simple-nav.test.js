// Beta preview of the five-item top nav (the guild lead, 2026-11-09). Pure data + the switch.
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import {
  SIMPLE_GROUPS, resolveVariant, groupsFor, cookieFor, groupOfPath,
} from '../web/lib/navVariant.ts';
import { stripJs } from './_source-slice.js';

const navSrc = fs.readFileSync(path.join(__dirname, '..', 'web', 'components', 'Nav.tsx'), 'utf8');
const todayHrefs = [...stripJs(navSrc).matchAll(/href: '(\/[a-z]*)'/g)].map(m => m[1]);

describe('simple nav data', () => {
  const simple = SIMPLE_GROUPS.flatMap(g => g.items.map(i => i.href));

  it('top items are exactly /me, Flagging, Guild, Raids, Spectator', () => {
    expect(SIMPLE_GROUPS.map(g => g.label)).toEqual(['/me', 'Flagging', 'Guild', 'Raids', 'Spectator']);
  });

  it('every page in today\'s nav (plus /me) is still reachable', () => {
    expect(todayHrefs.length).toBeGreaterThan(15);
    for (const h of [...todayHrefs, '/me']) expect(simple).toContain(h);
  });

  it('no page is listed twice', () => {
    expect(new Set(simple).size).toBe(simple.length);
  });

  it('finds the group a path belongs to', () => {
    expect(groupOfPath(SIMPLE_GROUPS, '/raid')?.id).toBe('raids');
    expect(groupOfPath(SIMPLE_GROUPS, '/pop/raid')?.id).toBe('flagging');
    expect(groupOfPath(SIMPLE_GROUPS, '/nowhere')).toBeUndefined();
  });
});

describe('variant switch', () => {
  it('ignores ?nav= and the cookie when not beta', () => {
    expect(resolveVariant(false, '?nav=a', 'wp-nav=b')).toBeNull();
  });
  it('reads the query on beta, ?nav=0 clears', () => {
    expect(resolveVariant(true, '?nav=a', '')).toBe('a');
    expect(resolveVariant(true, '?x=1&nav=b', 'wp-nav=a')).toBe('b');
    expect(resolveVariant(true, '?nav=0', 'wp-nav=a')).toBeNull();
  });
  it('falls back to the cookie, and to nothing', () => {
    expect(resolveVariant(true, '', 'x=1; wp-nav=b')).toBe('b');
    expect(resolveVariant(true, '', 'wp-nav=zzz')).toBeNull();
    expect(resolveVariant(true, '', '')).toBeNull();
  });
  it('no variant renders today\'s groups', () => {
    const today = ['t'], simple = ['s'];
    expect(groupsFor(null, today, simple)).toBe(today);
    expect(groupsFor('a', today, simple)).toBe(simple);
  });
  it('cookie is 30 days at path /, and clears on 0', () => {
    expect(cookieFor('a')).toBe('wp-nav=a; path=/; max-age=2592000; samesite=lax');
    expect(cookieFor(null)).toContain('max-age=0');
  });
  it('the hook is gated on the build-time beta flag', () => {
    const hook = stripJs(fs.readFileSync(path.join(__dirname, '..', 'web', 'components', 'useNavVariant.ts'), 'utf8'));
    expect(hook).toContain("process.env.NEXT_PUBLIC_IS_BETA !== '1'");
  });
});
