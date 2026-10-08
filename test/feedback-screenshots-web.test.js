// Screenshots on web feedback + roadmap suggestions (the guild lead, 2026-09-26: "feedback and
// suggestion needs to be able to take screenshots..top priority").
//
// Drives the shipped web/lib/feedbackShots.ts (vitest imports the TypeScript directly) and checks
// the two server actions' member-only rule on comment-stripped source.
//
// Run: npx vitest run test/feedback-screenshots-web.test.js

import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { readSource, stripJs, ROOT } from './_source-slice.js';
import * as shots from '../web/lib/feedbackShots.ts';

const JPEG = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(60, 1)]);
const PNG  = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(60, 2)]);
const dataUrl = (buf, mime) => 'data:' + mime + ';base64,' + buf.toString('base64');

function fakeAdmin() {
  const uploads = [];
  return {
    uploads,
    storage: { from: (bucket) => ({ upload: async (p, buf, opts) => { uploads.push({ bucket, p, buf, opts }); return { error: null }; } }) },
  };
}

describe('web screenshots: only real images are stored', () => {
  it('stores a JPEG and a PNG in the private bucket, under a month/source/random path', async () => {
    const admin = fakeAdmin();
    const paths = await shots.storeShots(admin, [dataUrl(JPEG, 'image/jpeg'), dataUrl(PNG, 'image/png')], 'web');
    expect(paths).toHaveLength(2);
    expect(admin.uploads.map(u => u.bucket)).toEqual(['feedback-screenshots', 'feedback-screenshots']);
    expect(paths[0]).toMatch(/^\d{4}-\d{2}\/web\/\d+-[0-9a-f]{12}\.jpg$/);
    expect(admin.uploads[1].opts).toEqual({ contentType: 'image/png', upsert: false });
  });
  it('drops a disguised file and anything past three', async () => {
    const admin = fakeAdmin();
    const html = Buffer.from('<svg onload=alert(1)>'.padEnd(80, ' '));
    const paths = await shots.storeShots(admin, [dataUrl(html, 'image/png'), ...Array(4).fill(dataUrl(JPEG, 'image/jpeg'))], 'roadmap');
    expect(paths).toHaveLength(2);                    // the first three, minus the fake
    expect(admin.uploads.every(u => shots.sniffImage(u.buf))).toBe(true);
  });
  it('a failed upload is left out rather than recorded', async () => {
    const admin = { storage: { from: () => ({ upload: async () => ({ error: { message: 'nope' } }) }) } };
    expect(await shots.storeShots(admin, [dataUrl(JPEG, 'image/jpeg')], 'web')).toEqual([]);
  });
});

describe('web screenshots: members only, on both forms', () => {
  const fb = stripJs(readSource(path.join(ROOT, 'web', 'app', 'feedback', 'actions.ts')));
  const rm = stripJs(readSource(path.join(ROOT, 'web', 'app', 'roadmap', 'actions.ts')));
  it('/feedback stores screenshots only for a signed-in pack member', () => {
    expect(fb).toContain("const shotPaths = discordId ? await storeShots(admin, input.screenshots, 'web') : [];");
    expect(fb).toContain('screenshot_paths: shotPaths');
  });
  it('roadmap suggestions do the same', () => {
    expect(rm).toContain("const shotPaths = discordId ? await storeShots(admin, input.screenshots, 'roadmap') : [];");
    expect(rm).toContain('screenshot_paths: shotPaths');
  });
  it('the officer inbox shows them through signed links, not public ones', () => {
    const page = stripJs(readSource(path.join(ROOT, 'web', 'app', 'admin', 'feedback', 'page.tsx')));
    expect(page).toContain('createSignedUrls(shotPaths, 3600)');
    expect(page).not.toContain('getPublicUrl');
  });
});
