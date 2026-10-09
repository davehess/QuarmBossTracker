// The landing page for someone new to Mimic (the guild lead, 2026-10-08, DECISIONS §209): what Mimic is,
// what each piece does, how to run it standalone, and how a guild gets the "hive mind". Served at the
// root of eqmimic.quest (middleware.ts rewrites there) and, for preview, at wolfpack.quest/eqmimic and
// b.wolfpack.quest/eqmimic?v=b. Public, no sign-in, marked [beta] until the guild lead says it is settled.
//
// Three layouts over ONE content module (web/lib/eqmimicLanding.ts), picked by ?v= as on the other
// previewed pages: none = A (walk-through), b = B (ledger), c = C (reel-led). Never promote a layout
// without the guild lead picking it; when one is picked, graduate it and delete the others.
//
// ⚠ Not indexable yet, like the feedback page. The rights notice (Daybreak's, fan site) is deliberately
// the loudest block under the hero here and is repeated in the footer; its words come verbatim from
// the wolfpack.quest footer in app/layout.tsx.
import { headers } from 'next/headers';
import type { Metadata } from 'next';
import { eqmimicLandingVariant, isEqmimicHost } from '@/lib/eqmimicHost';
import { DOWNLOAD_PATH, LINUX_PATH, WOLFPACK_ORIGIN } from '@/lib/eqmimicLanding';
import type { Ctx } from './_landing/Parts';
import LayoutA from './_landing/LayoutA';
import LayoutB from './_landing/LayoutB';
import LayoutC from './_landing/LayoutC';

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

export default async function EqmimicLandingPage({ searchParams }: { searchParams: Promise<{ v?: string | string[] }> }) {
  const { v } = await searchParams;
  const variant = eqmimicLandingVariant(Array.isArray(v) ? v[0] : v);

  // On eqmimic.quest the installer lives on wolfpack.quest, so those links are absolute and the feedback
  // form is /feedback (Mimic's own address for it). On the Wolf Pack hosts /feedback is a different
  // page, so the form is reached by its real path and the page keeps the full site header above it.
  const eqmimic = isEqmimicHost(headers().get('host'));
  const ctx: Ctx = eqmimic
    ? {
        eqmimic, landing: '/', feedback: '/feedback', stickyTop: 'top-0',
        download: `${WOLFPACK_ORIGIN}${DOWNLOAD_PATH}`, linux: `${WOLFPACK_ORIGIN}${LINUX_PATH}`,
      }
    : {
        eqmimic, landing: '/eqmimic', feedback: '/eqmimic/feedback', stickyTop: process.env.NEXT_PUBLIC_IS_BETA === '1' ? 'top-24' : 'top-14',
        download: DOWNLOAD_PATH, linux: LINUX_PATH,
      };

  return variant === 'b' ? <LayoutB ctx={ctx} /> : variant === 'c' ? <LayoutC ctx={ctx} /> : <LayoutA ctx={ctx} />;
}
