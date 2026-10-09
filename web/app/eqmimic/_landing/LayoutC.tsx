// Layout C, reel-led. The highlights reel IS the hero and a gallery of the overlays follows it; the
// walk-through, privacy and the hive-mind steps are compressed below (pieces open on tap, the setup
// help folds away). For the visitor who wants to see it before reading about it. DECISIONS §209.
import {
  BetaBadge, GuideLink, Hero, Hive, Highlights, LandingFooter, LocalModeBox, OverlayGrid, OverlayKey,
  PiecesCompact, PrivacyStrip, RightsNotice, SectionHead, SetupSteps, Troubleshooting, type Ctx,
} from './Parts';
import { HIVE } from '@/lib/eqmimicLanding';

export default function LayoutC({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-6xl pb-16">
      <BetaBadge ctx={ctx} layout="c" />
      <Hero ctx={ctx} compact>
        <div id="overlays" className="mt-6 scroll-mt-16"><Highlights lead /></div>
      </Hero>
      <RightsNotice />

      <section className="mt-10">
        <SectionHead id="gallery" title="The overlays" lead="Each one is its own window over the game. Turn on only the ones you want." />
        <OverlayGrid />
        <OverlayKey />
      </section>

      <section className="mt-12">
        <SectionHead id="pieces" title="How it works" lead="Five parts, in the order a signal travels. Tap one to open it." />
        <PiecesCompact />
      </section>

      <section className="mt-12">
        <SectionHead id="setup" title="Set it up yourself, standalone" lead="Six steps, no account." />
        <SetupSteps />
        <details className="mt-5 rounded-md border border-border bg-panel px-4">
          <summary className="flex min-h-11 cursor-pointer list-none items-center text-sm text-[#f2ede1]">
            Local mode, and what to do if it does not connect
          </summary>
          <div className="grid gap-4 pb-4 md:grid-cols-2">
            <LocalModeBox />
            <Troubleshooting />
          </div>
        </details>
        <GuideLink />
      </section>

      <section className="mt-12">
        <SectionHead id="privacy" title="Privacy, in five lines" />
        <PrivacyStrip />
      </section>

      <section className="mt-14">
        <SectionHead id="hive" title={HIVE.title} />
        <Hive ctx={ctx} compact />
      </section>

      <LandingFooter ctx={ctx} />
    </div>
  );
}
