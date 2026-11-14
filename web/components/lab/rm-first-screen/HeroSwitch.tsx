'use client';
// ?hero=a|b|c on the raidmimic landing swaps the first screen for a draft version (design lab, rm-first-screen). No ?hero=,
// or any other value, renders the children untouched: the default page. It reads the query here, not in page.tsx, which
// reads none by rule (test/raidmimic-landing-variants.test.js).
import type { ReactNode } from 'react';
import { useSearchParams } from 'next/navigation';
import RmFirstScreen from '@/components/lab/rm-first-screen';
import { COPY, MEDIA, type HeroLinks } from '@/lib/lab/fixtures/rm-first-screen';

export default function HeroSwitch({ links, enabled, children }: { links: HeroLinks; enabled: boolean; children: ReactNode }) {
  const hero = useSearchParams()?.get('hero');
  if (!enabled) return <>{children}</>;
  if (hero !== 'a' && hero !== 'b' && hero !== 'c') return <>{children}</>;
  return <RmFirstScreen which={hero} copy={COPY} links={links} media={MEDIA} />;
}
