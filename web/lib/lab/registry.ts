// The design lab: draft page designs shown with MADE-UP data (the guild lead, 2026-11-14: "do everything as drafts, a
// few versions of each graphical change and let me choose in the decision deck"). Lives on the `beta` branch only, at
// b.wolfpack.quest/lab. Nothing here reads the database, so a draft can be opened by anyone, signed in or not, and
// shows no member's data.
//
// One entry per draft. Each draft is its own page at web/app/lab/<slug>/page.tsx and takes ?v=a|b|c. The entry also
// says where the recommended version is staged on the REAL page (behind ?v=, so the default is untouched), which is
// what graduates when the guild lead picks it.
import { draft as boardsNextUp } from './drafts/boards-next-up';
import { draft as raidRosterCalm } from './drafts/raid-roster-calm';
import { draft as siteHeader } from './drafts/site-header';
import { draft as parseResultFirst } from './drafts/parse-result-first';
import { draft as popTonightBlockers } from './drafts/pop-tonight-blockers';
import { draft as rmFirstScreen } from './drafts/rm-first-screen';

export type LabVariant = {
  key: 'a' | 'b' | 'c';
  name: string;        // short name, e.g. "Scoreboard"
  diff: string;        // a few words on what makes it different
};
export type LabDraft = {
  slug: string;
  title: string;       // the page or part being redesigned
  site: 'wolfpack.quest' | 'raidmimic.com';
  problem: string;     // one sentence: what is wrong today
  variants: LabVariant[];
  rec: 'a' | 'b' | 'c';
  why: string;         // one sentence: why that one
  live: string | null; // the real page, as a path on this site (null: no single page)
  staged: string | null; // where the recommended version runs on real data, e.g. "/raid?v=b" (null: lab only)
};

export const LAB_DRAFTS: LabDraft[] = [
  boardsNextUp, raidRosterCalm, siteHeader, parseResultFirst, popTonightBlockers, rmFirstScreen,
];

export const labDraft = (slug: string): LabDraft | null => LAB_DRAFTS.find((d) => d.slug === slug) ?? null;
export const labVariant = (v: string | string[] | undefined, draft: Pick<LabDraft, 'variants' | 'rec'>): LabVariant['key'] => {
  const s = (Array.isArray(v) ? v[0] : v) ?? '';
  return draft.variants.some((x) => x.key === s) ? (s as LabVariant['key']) : draft.rec;
};
