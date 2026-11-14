import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'pop-tonight-blockers',
  title: 'Raid night plan: who cannot enter tonight',
  site: 'wolfpack.quest',
  problem: 'Who cannot zone into tonight\'s target is spread over a raider table, a per-flag list that repeats names and per-zone chips.',
  variants: [
    { key: 'a', name: 'Blockers strip', diff: 'One row per zone, blocked names in red with a Copy names button; full table folded below.' },
    { key: 'b', name: 'One tonight page', diff: 'Raid and Mine tabs sharing one target header; the last tab you used is remembered.' },
    { key: 'c', name: 'Zone cards', diff: 'Each zone is one card: who is blocked, how to get there, what to expect.' },
  ],
  rec: 'a',
  why: 'It answers "who cannot enter" in one glance and gives the leader the names to paste, without moving the plan.',
  live: '/pop/raid',
  staged: '/pop/raid?v=a',
};
