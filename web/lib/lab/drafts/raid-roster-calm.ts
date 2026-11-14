import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'raid-roster-calm',
  title: 'Raid HQ, calm roster',
  site: 'wolfpack.quest',
  problem: 'A pitch, a banner and a 13-button class bar sit above a roster whose rows each carry nine same-weight items, so a curse or a dry healer is easy to miss.',
  variants: [
    { key: 'a', name: 'Alert first', diff: 'One header line, a red strip only when something is wrong, four columns per raider.' },
    { key: 'b', name: 'Group tiles', diff: 'Each group is a tile of six name chips coloured by state, like the in-game raid window.' },
    { key: 'c', name: 'Job tabs', diff: 'Roster, Buffs, Mana and Curses as four short lists with counts on the tabs.' },
  ],
  rec: 'a',
  why: 'A healthy raid shows almost nothing extra and a curse or a dry healer is the only red thing on the screen, with no tab to open first.',
  live: '/raid',
  staged: '/raid?v=a',
};
