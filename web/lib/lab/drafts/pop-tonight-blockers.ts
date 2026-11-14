import type { LabDraft } from '@/lib/lab/registry';

export const draft: LabDraft = {
  slug: 'pop-tonight-blockers',
  title: 'Raid night plan: who is missing a preflag',
  site: 'wolfpack.quest',
  problem: 'Who is missing a preflag for tonight\'s targets is spread over a raider table, a per-flag list that repeats names and per-zone chips.',
  variants: [
    { key: 'a', name: 'Preflag strip', diff: 'One row per target zone: who is missing a preflag and which, with Copy names; the full table folds below.' },
    { key: 'b', name: 'One tonight page', diff: 'Raid and Mine tabs sharing one target header; the last tab you used is remembered.' },
    { key: 'c', name: 'Zone cards', diff: 'Each zone is one card: who is missing a preflag, how to get there, what to expect.' },
  ],
  rec: 'a',
  why: 'It answers "who is missing a preflag" in one glance and gives the leader the names to paste, without moving the plan.',
  live: '/pop/raid',
  staged: '/pop/raid?v=a',
};
