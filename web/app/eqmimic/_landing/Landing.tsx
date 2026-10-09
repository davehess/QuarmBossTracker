// The eqmimic.quest landing page, video first (the guild lead, 2026-10-09: "landing page should be a large
// video page to start, where people can click in and view each recorded scenario. then highlights of the
// overlays, then setup."; DECISIONS §209). One layout; the three it replaced are in git history.
//
// Order is the content: compact header, the big player with its scenario picker, the fan-site notice right
// under it (so it is read without scrolling past the video), the overlay gallery, standalone setup, then the
// smaller things (what each piece does, privacy, hive mind) and the footer.
import {
  Header, Hive, Ledger, LandingFooter, LocalModeBox, OverlayGallery, OverlayKey, PiecesCompact, PrivacyStrip,
  RightsNotice, SectionHead, SetupSteps, GuideLink, Troubleshooting, type Ctx,
} from './Parts';
import ScenarioPlayer from './ScenarioPlayer';
import { HIVE } from '@/lib/eqmimicLanding';

export default function Landing({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-6xl pb-12">
      <Header ctx={ctx} />

      <section id="watch" aria-label="Recorded scenarios">
        <ScenarioPlayer />
      </section>

      <RightsNotice id="rights" />

      <section className="mt-10">
        <SectionHead id="overlays" title="The overlays" lead="Each one is its own window over the game. Turn on only the ones you want." />
        <OverlayGallery />
        <OverlayKey />
      </section>

      <section className="mt-12">
        <SectionHead id="setup" title="Set it up yourself, standalone" lead="No account, no guild, no server of ours. Six steps." />
        <SetupSteps />
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          <LocalModeBox />
          <Troubleshooting />
        </div>
        <GuideLink />
        <div className="mt-8">
          <SectionHead id="ledger" small title="What you get, and what it needs"
            lead="Everything on the left runs on your own PC, free, with no account. The right column is what changes when a guild runs the server side." />
          <Ledger />
        </div>
      </section>

      <section className="mt-12">
        <SectionHead id="pieces" title="What each piece does" lead="Five parts, in the order a signal travels. Tap one to open it." />
        <PiecesCompact />
      </section>

      <section className="mt-10">
        <SectionHead id="privacy" title="Privacy, in five lines" />
        <PrivacyStrip />
      </section>

      <section className="mt-10">
        <SectionHead id="hive" title={HIVE.title} />
        <Hive ctx={ctx} />
      </section>

      <LandingFooter ctx={ctx} />
    </div>
  );
}
