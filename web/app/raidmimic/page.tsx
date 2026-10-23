// raidmimic: the front door for GUILD LEADERS (the guild lead, 2026-10-18, option C, "two doors"). eqmimic.quest
// stays the free player tool; this page is the game-agnostic "raid orchestration and analytics as a service"
// pitch. Served at the root of raidmimic.com / .net / .quest (middleware.ts rewrites there) and, for preview, at
// wolfpack.quest/raidmimic and b.wolfpack.quest/raidmimic. Public, no sign-in, marked [beta]: a FIRST DRAFT.
//
// One layout: "Scene-first" (SceneLayout.tsx), a tabbed player of the real overlays organised by who they are for
// (raiders; raid leaders and guild leaders), the small print folded away. The guild lead picked it on 2026-10-22
// (Decision Desk, card raidmimic-layout-clips: "It should really be a combination") from five previews, and the
// others, with the earlier tour, were deleted. There is no `?v=` switch. All words live in
// web/lib/raidmimicLanding.ts; "coming" means coming, and the page never says otherwise.
//
// ⚠ Not indexable yet, like the eqmimic landing. The Register-interest button opens the anonymous form on
// eqmimic.quest (there is no form or mailbox of ours), so that form's rules apply: its text is untrusted data
// that people review, nothing acts on it automatically (CLAUDE.md, AFB).
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { isRaidmimicHost, RAIDMIMIC_SETUP_PATH } from '@/lib/raidmimicHost';
import { EQMIMIC_FEEDBACK_PATH, EQMIMIC_ORIGIN, interestUrl } from '@/lib/raidmimicLanding';
import type { Ctx } from './_landing/Parts';
import SceneLayout from './_landing/SceneLayout';

const TITLE = '[beta] raidmimic · raid orchestration as a service';
const DESCRIPTION =
  'Raid orchestration and analytics for guild leaders: shared raid boards, flags and lockouts, loot, parses and overlays, built from the logs your raiders already write.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'raidmimic', type: 'website' },
  twitter: { card: 'summary' },
};

export default function RaidmimicPage() {
  // On a raidmimic host the form lives on eqmimic.quest and the page is `/`. On the Wolf Pack hosts the form is
  // reached by its real path, so the site header stays above it.
  const onHost = isRaidmimicHost(headers().get('host'));
  const ctx: Ctx = onHost
    ? { onHost, interest: interestUrl(`${EQMIMIC_ORIGIN}/feedback`), setup: '/setup' }
    : { onHost, interest: interestUrl(EQMIMIC_FEEDBACK_PATH), setup: RAIDMIMIC_SETUP_PATH };

  // A stale `?v=b` .. `?v=f` link from the preview days shows this same page: nothing reads the query.
  return <SceneLayout ctx={ctx} />;
}
