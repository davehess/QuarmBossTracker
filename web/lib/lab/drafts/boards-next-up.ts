import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'boards-next-up',
  title: 'Spawn boards',
  site: 'wolfpack.quest',
  problem: 'The page exists to answer "when does it spawn" but opens on a title card and five folded sections, with no search.',
  variants: [
    { key: 'a', name: 'Next up', diff: 'One list across every expansion, soonest first, the top 10 open; countdown is the biggest thing.' },
    { key: 'b', name: 'Watch list', diff: 'A filter box plus pins you keep in the browser; pinned bosses sit on top.' },
    { key: 'c', name: 'One table', diff: 'Boss, zone, opens in and window in one sortable dense table with a sticky header, no cards.' },
  ],
  rec: 'a',
  why: 'It answers the question on the first screen for everyone with no setup, and leaves the per-expansion sections untouched underneath.',
  live: '/boards',
  staged: '/boards?v=a',
};
