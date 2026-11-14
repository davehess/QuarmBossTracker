import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'parse-result-first',
  title: 'Parse breakdown of one fight',
  site: 'wolfpack.quest',
  problem: 'The page for "how did the fight go" is eight same-weight panels with the ranked table buried and the kill time in grey 14px.',
  variants: [
    { key: 'a', name: 'Result, then table', diff: 'Big result strip, full table next, your rows marked, rest folded with headlines.' },
    { key: 'b', name: 'Tabs', diff: 'Sticky tab row, one panel at a time, last tab remembered in the browser.' },
    { key: 'c', name: 'Your role first', diff: 'Tank sees Tank, healer sees Heal, others Damage; the rest fold.' },
  ],
  rec: 'a',
  why: 'It answers "how did it go" and "where am I" without a tap, keeps the whole table as a plain scroll, and needs no script.',
  live: '/parses',
  staged: '/parses/<fight id>?v=a',
};
