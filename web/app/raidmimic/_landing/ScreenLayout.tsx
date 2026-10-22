// The raidmimic layout, "Your screen" (`?v=f`, a PREVIEW beside the tour): the headline, then one wide monitor
// frame (a plain dark gradient, no game art) in which the three recordings play at once, each in its own titled
// window like an overlay on a screen. A phone stacks them. A short list says what each is doing. Then the moments,
// folds, coming list and ask. Server component. Windows are sized by each clip's w / h (flex-grow = aspect ratio, so
// the windows in a row share one height), with no pixel widths. Words: web/lib/raidmimicLanding.ts.
import type { CSSProperties } from 'react';
import {
  CLIPS, CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, HERO, MOMENTS, SCREEN_NOTES, WORKS_WITH, WORLDS, type Clip,
} from '@/lib/raidmimicLanding';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Footer, InterestButton, StatusChip, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { Fold } from './TourLayout';
import SceneClip from './SceneClip';

const clipById = (id: string): Clip => {
  const c = CLIPS.find(x => x.id === id);
  if (!c) throw new Error(`raidmimic: no clip "${id}"`);
  return c;
};

function Window({ c }: { c: Clip }) {
  const grow = { '--grow': (c.w / c.h).toFixed(4) } as CSSProperties;
  return (
    <figure id={`window-${c.id}`} style={grow} className="m-0 min-w-0 scroll-mt-4 lg:[flex:var(--grow)_1_0%]">
      <div className="overflow-hidden rounded-md border border-border bg-bg shadow-lg">
        <div className="flex min-h-8 items-center gap-2 border-b border-border bg-panel px-3 text-xs text-dim">
          <span aria-hidden="true" className="h-2 w-2 rounded-full bg-green" />{c.title}
        </div>
        <SceneClip id={c.id} />
      </div>
    </figure>
  );
}

export default function ScreenLayout({ ctx }: { ctx: Ctx }) {
  const top = [clipById('target-debuffs'), clipById('xtarget-split')];
  const wide = clipById('grummus-hail');
  return (
    <div className="mx-auto max-w-6xl pb-12">
      <BetaTag ctx={ctx} />

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
        <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1]">{HERO.name}</h1>
        <p className="mt-2 max-w-[62ch] text-base leading-7 text-[#f2ede1]">{HERO.line}</p>
        <div className="mt-4"><InterestButton ctx={ctx} /></div>
      </header>

      <section aria-label={CLIPS_HEAD.screenTitle}>
        <h2 className="text-xl text-[#f2ede1]">{CLIPS_HEAD.screenTitle}</h2>
        <p className="mb-3 mt-1 max-w-[62ch] text-sm leading-6 text-text">{CLIPS_HEAD.screenLead}</p>
        <div className="rounded-lg border border-border bg-gradient-to-br from-[#0a0e14] via-[#111827] to-[#161b22] p-3 shadow-xl sm:p-5">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start">
            {top.map(c => <Window key={c.id} c={c} />)}
          </div>
          <div className="mt-4"><Window c={wide} /></div>
        </div>
        <p className="mt-3 text-xs text-dim">{CLIPS_NOTE}</p>

        <dl className="m-0 mt-5 grid gap-3 md:grid-cols-3">
          {SCREEN_NOTES.map(n => (
            <div key={n.id} className="rounded-md border border-border bg-panel p-4">
              <dt className="text-base text-[#f2ede1]">{clipById(n.id).title}</dt>
              <dd className="m-0 mt-1 text-sm leading-6 text-text">{n.line}</dd>
            </div>
          ))}
        </dl>
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
