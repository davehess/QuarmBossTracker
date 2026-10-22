// The raidmimic layout, "Scene-first" (the guild lead's pick, Decision Desk 2026-10-22, with the raid-night beats of the
// story layout folded in): the hero (the mascot with the overlay captures around it, the guild lead's pick of 2026-10-21,
// kept), then one large stage that plays the real overlay recordings as a tabbed player
// organised by who they are for (raiders; raid leaders and guild leaders), each with the sentence of its beat. The four
// moments, the folded small print, the coming list and the ask follow.
// Server component; the only client code is the player (ClipTabs). Every word is in web/lib/raidmimicLanding.ts.
import {
  CLIPS, CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, MAP_CREDIT, MOMENTS, SHOTS_HEAD, WORKS_WITH, WORLDS,
} from '@/lib/raidmimicLanding';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Fold, Footer, Hero, StatusChip, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import ClipTabs from './ClipTabs';
import MascotHero from './MascotHero';

export default function SceneLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <BetaTag ctx={ctx} />
      <Hero ctx={ctx} compact />
      <MascotHero />
      <p className="mb-10 text-xs leading-5 text-dim">{SHOTS_HEAD.note} {MAP_CREDIT}</p>

      <section aria-label={CLIPS_HEAD.stageLabel} data-clips={CLIPS.length}>
        <h2 className="text-xl text-[#f2ede1]">{CLIPS_HEAD.title}</h2>
        <p className="mb-3 mt-1 max-w-[62ch] text-sm leading-6 text-text">{CLIPS_HEAD.lead}</p>
        <ClipTabs />
        <p className="mt-3 text-xs text-dim">{CLIPS_NOTE}</p>
      </section>

      <section aria-label="Four moments" className="mt-12">
        <ul className="m-0 grid list-none gap-3 p-0 sm:grid-cols-2">
          {MOMENTS.map(m => (
            <li key={m.id} id={`moment-${m.id}`} className="scroll-mt-4 rounded-md border border-border bg-panel p-4">
              <div className="mb-2"><StatusChip status={m.status} /></div>
              <h2 className="text-base text-[#f2ede1]">{m.title}</h2>
              <p className="mt-1 text-sm leading-6 text-text">{m.line}</p>
            </li>
          ))}
        </ul>
      </section>

      <section aria-label={FACTS_TITLE} className="mt-10 space-y-2">
        <Fold id="works-with" title={WORKS_WITH.title}><WorksWithBody /></Fold>
        <Fold id="data" title={DATA.title}><DataBody /></Fold>
        <Fold id="cost" title={COST.title}><CostBody /></Fold>
        <Fold id="worlds" title={WORLDS.title}><WorldsBody /></Fold>
      </section>

      <div className="mt-10"><ComingList /></div>
      <div className="mt-4"><CtaBand ctx={ctx} /></div>

      <Footer />
    </div>
  );
}
