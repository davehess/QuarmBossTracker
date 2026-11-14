import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'site-header',
  title: 'Top bar on every page',
  site: 'wolfpack.quest',
  problem: 'Signed in, the bar is up to 13 controls; folded it keeps download glyphs and a Menu button, so every page is two clicks away and nothing says if a raid is on.',
  variants: [
    { key: 'a', name: 'Doors stay', diff: 'Raid, Stats, Prep and /me stay in the folded bar; panels overlay the page; one account menu.' },
    { key: 'b', name: 'Tonight in the bar', diff: 'Doors stay, plus a pill by the brand: raid tonight with a countdown, raid on now, or the next raid.' },
    { key: 'c', name: 'Jump box', diff: 'Brand, one search-or-jump field (/ or Ctrl+K) with recent pages, and the account menu.' },
  ],
  rec: 'a',
  why: 'It fixes the real complaint (destinations two clicks away) with the least new behaviour, and B can be added to it later without rework.',
  live: '/',
  staged: '/?hdr=1&v=a',
};
