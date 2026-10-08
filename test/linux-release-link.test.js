// /mimic/linux (#156): the newest Linux build of Mimic can sit far down the
// release list behind many Windows betas. On 2026-09-25 the only Linux build
// was ~97th and the old newest-30 search fell back to the releases page.
import { describe, it, expect } from 'vitest';
import { findLinuxRelease, PER_PAGE } from '../web/lib/linuxRelease.ts';

const win = (i) => ({ tag_name: `v2.7.2-beta.${i}`, html_url: `https://x/beta.${i}`, draft: false,
  published_at: `2026-09-2${i % 10}T00:00:00Z`, assets: [{ name: 'Wolf-Pack-Mimic-Setup.exe', browser_download_url: 'https://x/setup.exe' }] });
const linux = (n, at) => ({ tag_name: `v2.6.1-linux.${n}`, html_url: `https://x/linux.${n}`, draft: false,
  published_at: at, assets: [{ name: `wolf-pack-mimic-2.6.1-linux.${n}.AppImage`, browser_download_url: `https://x/linux.${n}.AppImage` }] });
const pagesOf = (list) => {
  const calls = [];
  const fetchPage = async (p) => { calls.push(p); return list.slice((p - 1) * PER_PAGE, p * PER_PAGE); };
  return { fetchPage, calls };
};

describe('finding the Linux build', () => {
  it('finds one sitting past the first page of Windows betas', async () => {
    const list = [...Array.from({ length: 130 }, (_, i) => win(i)), linux(26, '2026-08-26T12:35:31Z'), linux(25, '2026-08-26T12:29:51Z')];
    const { fetchPage, calls } = pagesOf(list);
    const r = await findLinuxRelease(fetchPage);
    expect(r && r.tag_name).toBe('v2.6.1-linux.26');
    expect(calls).toEqual([1, 2]);
  });

  it('picks the newest by publish time when a page holds several, and skips drafts', async () => {
    const draft = { ...linux(27, '2026-08-27T00:00:00Z'), draft: true };
    const { fetchPage } = pagesOf([draft, linux(25, '2026-08-26T12:29:51Z'), linux(26, '2026-08-26T12:35:31Z')]);
    expect((await findLinuxRelease(fetchPage)).tag_name).toBe('v2.6.1-linux.26');
  });

  it('stops at the last page, and on an error, with nothing found', async () => {
    const { fetchPage, calls } = pagesOf(Array.from({ length: 150 }, (_, i) => win(i)));
    expect(await findLinuxRelease(fetchPage)).toBeNull();
    expect(calls).toEqual([1, 2]);
    expect(await findLinuxRelease(async () => null)).toBeNull();
  });

  it('never reads more than five pages', async () => {
    const calls = [];
    const r = await findLinuxRelease(async (p) => { calls.push(p); return Array.from({ length: PER_PAGE }, (_, i) => win(i)); });
    expect(r).toBeNull();
    expect(calls).toEqual([1, 2, 3, 4, 5]);
  });
});
