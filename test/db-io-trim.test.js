// test/db-io-trim.test.js — the hot database reads that exhausted the Disk IO budget on 2026-11-04 (DECISIONS §538).
// The short-TTL cache, the wishlist bust on the bot's own writes, and the mimic_sessions read/write trim run for
// real; the monolith's three call sites are checked as comment-stripped source (they sit inside HTTP handlers).
// Names are invented. Run: npx vitest run test/db-io-trim.test.js
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { ROOT, stripJs, BOT_INDEX } from './_source-slice.js';

const nodeRequire = createRequire(BOT_INDEX);
const { createHotReadCache, wishlistPriorities, bustWishlist } = nodeRequire('./utils/hotReadCache');
const supabase = nodeRequire('./utils/supabase');
const mimicLink = nodeRequire('./utils/mimicLink');

beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(Date.UTC(2026, 10, 5, 3, 0, 0)); });
afterEach(() => { vi.useRealTimers(); });

describe('hot read cache', () => {
  it('serves repeat calls inside the TTL with one read, and re-reads after it', async () => {
    const c = createHotReadCache({ ttlMs: 60_000 });
    const load = vi.fn(async () => [{ name: 'Aldenmar' }]);
    await c.get('k', load); await c.get('k', load); await c.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(61_000);
    await c.get('k', load);
    expect(load).toHaveBeenCalledTimes(2);
  });

  it('caches an empty result (a member with nothing is the common case)', async () => {
    const c = createHotReadCache({ ttlMs: 60_000 });
    const load = vi.fn(async () => []);
    await c.get('k', load); await c.get('k', load);
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('a failed read is not cached and keeps the last good value', async () => {
    const c = createHotReadCache({ ttlMs: 60_000 });
    expect(await c.get('k', async () => null)).toBeNull();           // nothing good yet: null, nothing stored
    const good = [{ name: 'Brackwyn' }];
    expect(await c.get('k', async () => good)).toBe(good);
    vi.advanceTimersByTime(61_000);
    expect(await c.get('k', async () => null)).toBe(good);           // stale beats empty
    expect(await c.get('k', async () => { throw new Error('x'); })).toBe(good);
  });

  it('is bounded', async () => {
    const c = createHotReadCache({ ttlMs: 60_000, max: 3 });
    for (let i = 0; i < 10; i++) await c.get('k' + i, async () => [i]);
    expect(c.size()).toBe(3);
  });

  it('bustWishlist drops the lowercased key, so the bot\'s own write shows at once', async () => {
    wishlistPriorities.clear();
    const load = vi.fn(async () => [{ item_id: 1, priority: 2 }]);
    await wishlistPriorities.get('corvale', load);
    await wishlistPriorities.get('corvale', load);
    expect(load).toHaveBeenCalledTimes(1);
    bustWishlist('Corvale');
    await wishlistPriorities.get('corvale', load);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe('call sites', () => {
  const src = (p) => stripJs(fs.readFileSync(path.join(ROOT, p), 'utf8'));
  it('index.js reads the three hot tables through the caches', () => {
    const s = src('index.js');
    expect(s).toMatch(/_uploaderCharsCache\.get\([^)]*\) => supabase\.select\(\s*'characters'/);
    expect(s).toMatch(/_assistRosterCache\.get\(guildId, \(\) => supabase\.select\(\s*'characters'/);
    expect(s).toMatch(/_wishlistPriorities\.get\([^\n]*\) => supabase\.select\(\s*'wishlists'/);
  });
  it('every bot wishlist write busts the cache', () => {
    const web = src('utils/webWishlist.js');
    expect((web.match(/bustWishlist\(name\)/g) || []).length).toBe(3);
    const cmd = src('commands/wishlist.js');
    expect((cmd.match(/bustWishlist\(rosterChar\.name\)/g) || []).length).toBe(2);
  });
});

describe('mimic_sessions trim', () => {
  const saved = {};
  let reads, writes, revoked;
  beforeEach(() => {
    for (const k of ['isEnabled', 'select', 'update']) saved[k] = supabase[k];
    supabase.isEnabled = () => true;
    reads = 0; writes = 0; revoked = false;
    supabase.update = async () => { writes++; return []; };
    supabase.select = async (table) => {
      if (table === 'mimic_sessions') { reads++; return [{ user_id: null, discord_id: '111111111111111111', revoked_at: revoked ? 'x' : null }]; }
      if (table === 'wolfpack_members') return [{ nickname: 'Nyssara', global_name: null, role_names: [] }];
      return [];
    };
  });
  afterEach(() => { for (const k of Object.keys(saved)) supabase[k] = saved[k]; });
  const req = (t) => ({ headers: { 'x-wolfpack-mimic-session': t } });
  const tok = () => 'wpms_' + nodeRequire('node:crypto').randomBytes(32).toString('hex');

  it('concurrent calls on a cold token share one read', async () => {
    const t = tok();
    await Promise.all(Array.from({ length: 8 }, () => mimicLink.resolveMimicSession(req(t))));
    expect(reads).toBe(1);
  });

  it('stays cached for 4 minutes, re-reads after 5 (the revoke bound did not grow)', async () => {
    const t = tok();
    await mimicLink.resolveMimicSession(req(t));
    vi.advanceTimersByTime(4 * 60_000);
    await mimicLink.resolveMimicSession(req(t));
    expect(reads).toBe(1);
    vi.advanceTimersByTime(90_000);
    await mimicLink.resolveMimicSession(req(t));
    expect(reads).toBe(2);
  });

  it('writes last_used_at once per token per hour, not once per refill', async () => {
    const t = tok();
    for (let i = 0; i < 7; i++) {            // a refill every 11 minutes for 77 minutes
      await mimicLink.resolveMimicSession(req(t));
      vi.advanceTimersByTime(11 * 60_000);
    }
    expect(reads).toBe(7);
    expect(writes).toBe(2);                  // minute 0 and minute 66
  });

  it('a revoke stops working within the TTL, and at once through invalidateSessionCache', async () => {
    const t = tok();
    expect(await mimicLink.resolveMimicSession(req(t))).toBeTruthy();
    revoked = true;
    mimicLink.invalidateSessionCache(t);
    expect(await mimicLink.resolveMimicSession(req(t))).toBeNull();
    const t2 = tok();
    revoked = false;
    expect(await mimicLink.resolveMimicSession(req(t2))).toBeTruthy();
    revoked = true;
    vi.advanceTimersByTime(5 * 60_000 + 1000);
    expect(await mimicLink.resolveMimicSession(req(t2))).toBeNull();
  });
});
