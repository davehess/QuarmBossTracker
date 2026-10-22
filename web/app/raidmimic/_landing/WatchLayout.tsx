// The raidmimic layout, "Scene-first" (`?v=d`, a PREVIEW beside the tour): a short headline, then one large stage
// that plays the three overlay recordings as a tabbed player, then the tour's moments, folds, coming list and ask.
// Server component; the only client code is the player (ClipTabs). Every word is in web/lib/raidmimicLanding.ts.
import { CLIPS, CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, HERO, MOMENTS, WORKS_WITH, WORLDS } from '@/lib/raidmimicLanding';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Footer, InterestButton, StatusChip, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { Fold } from './TourLayout';
import ClipTabs from './ClipTabs';

export default function WatchLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <BetaTag ctx={ctx} />

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
        <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1]">{HERO.name}</h1>
        <p className="mt-2 max-w-[62ch] text-base leading-7 text-[#f2ede1]">{HERO.line}</p>
        <div className="mt-4"><InterestButton ctx={ctx} /></div>
      </header>

      <section aria-label={CLIPS_HEAD.stageLabel} data-clips={CLIPS.length}>
        <h2 className="text-xl text-[#f2ede1]">{CLIPS_HEAD.title}</h2>
        <p className="mb-3 mt-1 text-sm leading-6 text-text">{CLIPS_HEAD.lead}</p>
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
