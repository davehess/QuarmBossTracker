import type { HeroCopy, HeroLinks, HeroMedia } from '@/lib/lab/fixtures/rm-first-screen';
import HeroA from './HeroA';
import HeroB from './HeroB';
import HeroC from './HeroC';

/** The chosen first-screen version. The lab page and the real landing page both render through this. */
export default function RmFirstScreen({ which, copy, links, media }: { which: 'a' | 'b' | 'c'; copy: HeroCopy; links: HeroLinks; media: HeroMedia }) {
  const Hero = which === 'b' ? HeroB : which === 'c' ? HeroC : HeroA;
  return <Hero copy={copy} links={links} media={media} />;
}
