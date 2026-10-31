// test/guest-extend-web.test.js — the website half of "extend a guest link by 1 or 3 hours" and the /admin/guests review
// page (the guild lead, 2026-10-30). The bot half is test/guest-extend.test.js; the two apply the same rule, so the math
// is pinned here with the same cases. Source assertions run on comment-stripped text.
import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { ROOT, readSource, stripJs } from './_source-slice.js';
import { extendedGuestExpiry, canExtendGuest, GUEST_EXTEND_HOURS } from '../web/lib/guestLink.ts';

const NOW = new Date('2026-10-31T01:00:00Z');
const H = 3600_000;
const iso = (ms) => new Date(ms).toISOString();
const read = (p) => stripJs(readSource(path.join(ROOT, p)));

describe('extendedGuestExpiry', () => {
  it('adds the hours on top of a key that still has time', () => {
    expect(extendedGuestExpiry(iso(NOW.getTime() + 2 * H), 1, NOW)).toBe(iso(NOW.getTime() + 3 * H));
    expect(extendedGuestExpiry(iso(NOW.getTime() + 2 * H), 3, NOW)).toBe(iso(NOW.getTime() + 5 * H));
  });
  it('counts from now for a key that has lapsed', () => {
    expect(extendedGuestExpiry(iso(NOW.getTime() - 300_000), 1, NOW)).toBe(iso(NOW.getTime() + H));
    expect(extendedGuestExpiry(null, 3, NOW)).toBe(iso(NOW.getTime() + 3 * H));
  });
  it('refuses any hours but 1 and 3', () => {
    expect(GUEST_EXTEND_HOURS).toEqual([1, 3]);
    for (const h of [0, 2, 4, 24, -1, 1.5, NaN]) expect(extendedGuestExpiry(iso(NOW.getTime()), h, NOW), String(h)).toBeNull();
  });
});

describe('canExtendGuest', () => {
  it('is true while running and for 12 hours after, false past that or with no expiry', () => {
    expect(canExtendGuest(iso(NOW.getTime() + H), NOW)).toBe(true);
    expect(canExtendGuest(iso(NOW.getTime() - 11.9 * H), NOW)).toBe(true);
    expect(canExtendGuest(iso(NOW.getTime() - 12 * H), NOW)).toBe(false);
    expect(canExtendGuest(null, NOW)).toBe(false);
  });
});

describe('extendGuestSession (server action)', () => {
  const src = read('web/app/admin/links/guest-link-actions.ts');
  const fn = src.slice(src.indexOf('export async function extendGuestSession'));
  it('starts with requireOfficer, and only ever touches guest sessions', () => {
    expect(fn).toMatch(/^export async function extendGuestSession\(formData: FormData\) \{\s*const userId = await requireOfficer\(\);/);
    expect(fn).toContain(".eq('scope', 'guest')");
  });
  it('refuses a revoked or long-lapsed link and writes only while revoked_at is null', () => {
    expect(fn).toContain('row!.revoked_at');
    expect(fn).toContain('canExtendGuest(row!.expires_at)');
    expect(fn).toContain(".is('revoked_at', null)");
    expect(fn).toContain('extendedGuestExpiry(row!.expires_at, hours)');
  });
  it('writes a guest_link_extended audit row', () => {
    expect(fn).toMatch(/action:\s+'guest_link_extended'/);
  });
});

describe('/admin/links and /admin/guests', () => {
  it('the Guest links section has +1h / +3h buttons on active rows and on recently lapsed, unrevoked ones', () => {
    const page = read('web/app/admin/links/page.tsx');
    expect(page).toContain('action={extendGuestSession}');
    expect(page).toContain('GUEST_EXTEND_HOURS.map');
    expect(page).toMatch(/!g\.revoked_at && canExtendGuest\(g\.expires_at\)/);
    expect(page).toContain('href="/admin/guests"');
  });
  it('the review page is officer-only, reads guest sessions and their contributions, and links each fight', () => {
    const page = read('web/app/admin/guests/page.tsx');
    expect(page).toMatch(/export default async function AdminGuestsPage\(\) \{\s*await requireOfficer\(\);/);
    expect(page).toContain(".eq('scope', 'guest')");
    expect(page).toContain("`guest:${s.id}`");
    expect(page).toContain(".in('uploaded_by_discord_id', part)");
    expect(page).toContain('href={`/parses/${f.encounter_id}`}');
  });
  it('the new page has an unfurl title', () => {
    const meta = read('web/lib/pageMeta.ts');
    expect(meta).toContain("'/admin/guests':");
  });
});
