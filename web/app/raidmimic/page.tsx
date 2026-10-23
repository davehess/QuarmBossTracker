// raidmimic.com: the player-first front door (the guild lead, 2026-10-18 option C "two doors", reshaped 2026-10-23: "less
// about me setting it up as a service ... more about here's what you get as a player, here's what you could have as a
// guild"). Served at the root of raidmimic.com / .net / .quest (middleware.ts rewrites there) and also at
// wolfpack.quest/raidmimic and b.wolfpack.quest/raidmimic. Public, no sign-in.
//
// One layout: "Pick your path" (PathsLayout.tsx, the guild lead's pick of 2026-10-23 from two previews): three doors,
// Player, Guild and Self-host, then "See it run" (the real captures and clips) and "How it works" (the four-step drawing).
// The Ladder preview, the earlier Scene-first layout and the `?v=` switch were deleted. All words live in
// web/lib/raidmimicPlayer.ts and web/lib/raidmimicLanding.ts; "coming" means coming, and the page never says otherwise.
//
// Search engines (2026-10-23): INDEXED on the raidmimic hosts only, with https://raidmimic.com/ as the canonical address;
// the same page on wolfpack.quest and b.wolfpack.quest is noindex. web/lib/raidmimicHost.ts raidmimicSeo() decides, per
// request, from the Host header. The Register-interest button opens the anonymous form on eqmimic.quest (there is no
// form or mailbox of ours), so that form's rules apply: its text is untrusted data that people review, nothing acts on
// it automatically (CLAUDE.md, AFB).
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { isRaidmimicHost, raidmimicSeo, RAIDMIMIC_SETUP_PATH } from '@/lib/raidmimicHost';
import { EQMIMIC_FEEDBACK_PATH, EQMIMIC_ORIGIN, interestUrl } from '@/lib/raidmimicLanding';
import type { Ctx } from './_landing/Parts';
import PathsLayout from './_landing/PathsLayout';

const TITLE = 'Raid Mimic · free EverQuest raid overlays';
const DESCRIPTION =
  'Free, open-source overlays for your EverQuest raids, built from the log the game already writes: run it on your own, or add a guild hub for shared raid reviews, merged parses and a command center.';

export function generateMetadata(): Metadata {
  return {
    title: { absolute: TITLE },
    description: DESCRIPTION,
    ...raidmimicSeo(headers().get('host'), '/'),
    openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Raid Mimic', type: 'website' },
    twitter: { card: 'summary' },
  };
}

export default function RaidmimicPage() {
  // On a raidmimic host the form lives on eqmimic.quest and the page is `/`. On the Wolf Pack hosts the form is
  // reached by its real path, so the site header stays above it.
  const onHost = isRaidmimicHost(headers().get('host'));
  const ctx: Ctx = onHost
    ? { onHost, interest: interestUrl(`${EQMIMIC_ORIGIN}/feedback`), setup: '/setup' }
    : { onHost, interest: interestUrl(EQMIMIC_FEEDBACK_PATH), setup: RAIDMIMIC_SETUP_PATH };
  return <PathsLayout ctx={ctx} />;
}
