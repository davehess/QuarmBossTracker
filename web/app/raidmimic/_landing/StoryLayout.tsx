// The raidmimic layout, "Raid-night story" (`?v=e`, a PREVIEW beside the tour): the hero, then one boss told as
// beats, each a recording beside its sentence, alternating sides from lg and stacked on a phone. The tour's folds,
// coming list and ask follow. Server component (SceneClip is the only client piece). Words: web/lib/raidmimicLanding.ts.
import { CLIPS, CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, STORY, WORKS_WITH, WORLDS } from '@/lib/raidmimicLanding';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Footer, Hero, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { Fold } from './TourLayout';
import SceneClip from './SceneClip';

export default function StoryLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-6xl pb-12">
      <BetaTag ctx={ctx} />
      <Hero ctx={ctx} compact />

      <section aria-label={CLIPS_HEAD.storyTitle}>
        <h2 className="mb-6 text-xl text-[#f2ede1]">{CLIPS_HEAD.storyTitle}</h2>
        <ol className="m-0 list-none space-y-12 p-0">
          {STORY.map((b, i) => {
            const clip = CLIPS.find(c => c.id === b.clip);
            return (
              <li key={b.id} id={`beat-${b.id}`}
                className={`scroll-mt-4 grid items-center gap-5 lg:gap-10 ${clip ? 'lg:grid-cols-12' : ''}`}>
                <div className={clip ? `lg:col-span-5 ${i % 2 === 0 ? 'lg:order-1' : 'lg:order-2'}` : 'max-w-[62ch]'}>
                  <p className="text-xs uppercase tracking-widest text-gold">{`${i + 1}. ${b.step}`}</p>
                  <h3 className="mt-1 text-2xl leading-tight text-[#f2ede1]">{b.head}</h3>
                  <p className="mt-2 text-sm leading-6 text-text">{b.line}</p>
                  {clip && <p className="mt-2 text-xs leading-5 text-dim"><b className="font-semibold text-text">{clip.title}.</b> {clip.caption}</p>}
                </div>
                {clip && (
                  <div className={`lg:col-span-7 ${i % 2 === 0 ? 'lg:order-2' : 'lg:order-1'}`}>
                    <div className="overflow-hidden rounded-md border border-border bg-bg"><SceneClip id={clip.id} /></div>
                  </div>
                )}
              </li>
            );
          })}
        </ol>
        <p className="mt-6 text-xs text-dim">{CLIPS_NOTE}</p>
      </section>

      <section aria-label={FACTS_TITLE} className="mt-12 space-y-2">
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
