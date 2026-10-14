// The landing page for someone new to Mimic (the guild lead, 2026-10-08, DECISIONS §209): what Mimic is,
// what each piece does, how to run it standalone, and how a guild gets the "hive mind". Served at the
// root of eqmimic.quest (middleware.ts rewrites there) and, for preview, at wolfpack.quest/eqmimic and
// b.wolfpack.quest/eqmimic. Public, no sign-in, marked [beta] until the guild lead says it is settled.
//
// One layout, video first (picked by the guild lead 2026-10-09; the three earlier layouts and the ?v= switch
// were retired). All words live in web/lib/eqmimicLanding.ts.
//
// ⚠ Not indexable yet, like the feedback page. The rights notice (Daybreak's, fan site) is deliberately
// the loudest block under the video here and is repeated in the footer; its words come verbatim from
// the wolfpack.quest footer in app/layout.tsx.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { isEqmimicHost } from '@/lib/eqmimicHost';
import { DOWNLOAD_PATH, LINUX_PATH, WOLFPACK_ORIGIN } from '@/lib/eqmimicLanding';
import type { Ctx } from './_landing/Parts';
import Landing from './_landing/Landing';

const TITLE = '[beta] Wolf Pack Mimic — a free overlay suite for Project Quarm';
const DESCRIPTION =
  'Overlays for Project Quarm: DPS, timers, charm, buffs, triggers and more, drawn over EverQuest. Free, open source, and an unofficial fan project.';

export const metadata: Metadata = {
  title: { absolute: TITLE },
  description: DESCRIPTION,
  robots: { index: false, follow: false },
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Wolf Pack Mimic', type: 'website' },
  twitter: { card: 'summary' },
};

export default function EqmimicLandingPage() {
  // On eqmimic.quest the installer lives on wolfpack.quest, so those links are absolute and the feedback
  // form is /feedback (Mimic's own address for it). On the Wolf Pack hosts /feedback is a different
  // page, so the form is reached by its real path and the page keeps the full site header above it.
  const eqmimic = isEqmimicHost(headers().get('host'));
  const ctx: Ctx = eqmimic
    ? {
        eqmimic, landing: '/', feedback: '/feedback',
        download: `${WOLFPACK_ORIGIN}${DOWNLOAD_PATH}`, linux: `${WOLFPACK_ORIGIN}${LINUX_PATH}`,
      }
    : {
        eqmimic, landing: '/eqmimic', feedback: '/eqmimic/feedback',
        download: DOWNLOAD_PATH, linux: LINUX_PATH,
      };

  return <Landing ctx={ctx} />;
}
