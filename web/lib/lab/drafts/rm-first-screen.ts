import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'rm-first-screen',
  title: 'Raid Mimic: the first screen',
  site: 'raidmimic.com',
  problem: 'A first-time visitor gets a full-screen 81-second video with three skip controls, no headline, no sentence about what it is and no download or demo button.',
  variants: [
    { key: 'a', name: 'Hook beside the video', diff: 'Headline, sentence and two buttons next to the video from frame one; one skip control.' },
    { key: 'b', name: 'Captures first', diff: 'A still hero of real overlay captures; the video is a button that plays in place.' },
    { key: 'c', name: 'Two doors', diff: 'Two panels, I raid and I run a guild, one capture and one button each; video below.' },
  ],
  rec: 'a',
  why: 'It answers what, is it real and what to click in the first glance and keeps the story video, which is the page\'s best proof, in view.',
  live: '/raidmimic',
  staged: '/raidmimic?hero=a&v=a',
};
