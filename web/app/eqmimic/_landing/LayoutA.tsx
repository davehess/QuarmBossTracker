// Layout A, the walk-through (default). One calm column, a numbered journey in the order a newcomer needs
// it: what it is, the pieces, setting it up, what you get, privacy, then the hive-mind section for guilds.
// A sticky mini-nav of the sections. Reads like a guide. DECISIONS §209.
import {
  BetaBadge, GuideLink, Hero, Hive, Highlights, LandingFooter, LocalModeBox, OverlayKey, OverlayList, Pieces,
  PrivacyList, RightsNotice, SectionHead, SectionNav, SetupSteps, Troubleshooting, type Ctx,
} from './Parts';
import { HIVE } from '@/lib/eqmimicLanding';

export default function LayoutA({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-3xl pb-16">
      <BetaBadge ctx={ctx} layout="a" />
      <Hero ctx={ctx} />
      <RightsNotice />
      <SectionNav ctx={ctx} />

      <section className="mt-10">
        <SectionHead id="pieces" n={1} title="What each piece does"
          lead="Mimic is a chain of small parts. Here they are in the order a signal travels, from the game to your screen." />
        <Pieces />
      </section>

      <section className="mt-14">
        <SectionHead id="setup" n={2} title="Set it up yourself, standalone"
          lead="No account, no guild, no server of ours. Six steps." />
        <SetupSteps />
        <div className="mt-6 space-y-4">
          <LocalModeBox />
          <Troubleshooting />
        </div>
        <GuideLink />
      </section>

      <section className="mt-14">
        <SectionHead id="overlays" n={3} title="What you get" />
        <div className="mt-4"><Highlights /></div>
        <OverlayList />
        <OverlayKey />
      </section>

      <section className="mt-14">
        <SectionHead id="privacy" n={4} title="Privacy, in five lines" />
        <PrivacyList />
      </section>

      <section className="mt-14">
        <SectionHead id="hive" n={5} title={HIVE.title} />
        <Hive ctx={ctx} />
      </section>

      <LandingFooter ctx={ctx} />
    </div>
  );
}
