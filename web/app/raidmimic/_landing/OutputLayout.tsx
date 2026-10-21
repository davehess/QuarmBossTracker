// The raidmimic layout, "Output first" (`?v=b`, a PREVIEW beside the tour; the guild lead, 2026-10-21: "We still want
// to show the output first. Anonymize names."). The page opens on the product itself: captures of the running Mimic
// overlays, each with one plain sentence of what it does for a raid. The tour's text follows (four moments as words,
// the folded small print, what is not built yet, the ask), and the page ends on "Set it up yourself".
// Server component, no client JS. Every word comes from web/lib/raidmimicLanding.ts; the captures are made by
// scripts/raidmimic-shots from invented player names.
import {
  COST, FACTS_TITLE, HERO, MOMENTS, SETUP_LINK, SHOTS, SHOTS_DIR, SHOTS_HEAD, DATA, WORKS_WITH, WORLDS, type Shot,
} from '@/lib/raidmimicLanding';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Footer, InterestButton, StatusChip, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { Fold } from './TourLayout';
import MascotHero from './MascotHero';

const byId = (id: string): Shot => {
  const s = SHOTS.find(x => x.id === id);
  if (!s) throw new Error(`raidmimic: no capture "${id}"`);
  return s;
};

// One capture: a tap opens the full-size file (on a phone the overlay text is small; this is the way to read it).
function ShotFigure({ s }: { s: Shot }) {
  const src = `${SHOTS_DIR}/${s.file}`;
  return (
    <figure id={`shot-${s.id}`} className="m-0 scroll-mt-4">
      <a href={src} target="_blank" rel="noreferrer" aria-label={`${s.title}: open the full-size capture`}
        className="block overflow-hidden rounded-md border border-border bg-bg">
        <img src={src} width={s.w} height={s.h} alt={s.alt} loading="lazy" decoding="async" className="block h-auto w-full" />
      </a>
      <figcaption className="mt-2 text-sm leading-6 text-text">
        <b className="font-semibold text-[#f2ede1]">{s.title}.</b> {s.line}
        {s.credit && <span className="mt-1 block text-xs leading-5 text-dim">{s.credit}</span>}
      </figcaption>
    </figure>
  );
}

// `hero` is the mascot preview: 'howl' (?v=b) puts the clip beside the headline, 'layered' (?v=c) puts the mascot
// and the captures around it under it. Neither set: the page as it was.
export default function OutputLayout({ ctx, hero }: { ctx: Ctx; hero?: 'howl' | 'layered' }) {
  return (
    <div className="mx-auto max-w-6xl pb-12">
      <BetaTag ctx={ctx} />

      <header className={hero === 'howl' ? 'mb-6 grid items-center gap-4 lg:grid-cols-2' : 'mb-6'}>
        <div>
          <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
          <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1]">{HERO.name}</h1>
          <p className="mt-2 max-w-[62ch] text-base leading-7 text-[#f2ede1]">{HERO.line}</p>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <InterestButton ctx={ctx} />
            <a href={SETUP_LINK.href} className="inline-flex min-h-11 items-center text-sm">{SETUP_LINK.label} →</a>
          </div>
        </div>
        {hero === 'howl' && <MascotHero variant="howl" />}
      </header>
      {hero === 'layered' && <MascotHero variant="layered" />}

      <section aria-label={SHOTS_HEAD.title} className="space-y-6">
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-8"><ShotFigure s={byId('map')} /></div>
          <div className="lg:col-span-4"><ShotFigure s={byId('cc')} /></div>
        </div>
        <div className="grid gap-6 lg:grid-cols-2 lg:items-start">
          <ShotFigure s={byId('target-stats')} />
          <ShotFigure s={byId('target-quest')} />
        </div>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-start">
          <div className="lg:col-span-7"><ShotFigure s={byId('dps')} /></div>
          <div className="lg:col-span-5"><ShotFigure s={byId('rolls')} /></div>
        </div>
        <div className="grid gap-6 lg:grid-cols-12 lg:items-center">
          <div className="lg:col-span-7"><ShotFigure s={byId('timeline')} /></div>
          <div className="lg:col-span-5">
            <p className="text-sm leading-6 text-text">{SHOTS_HEAD.note}</p>
            <p className="mt-3 text-sm leading-6 text-text">{HERO.honest}</p>
            <p className="mt-3 text-xs leading-5 text-dim">{HERO.playerLine}</p>
          </div>
        </div>
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

      <section id="setup" aria-label={SETUP_LINK.label} className="mt-4 scroll-mt-4 rounded-md border border-border bg-panel p-5">
        <a href={SETUP_LINK.href} className="inline-flex min-h-11 items-center text-lg">{SETUP_LINK.label} →</a>
        <p className="mt-1 max-w-[62ch] text-xs leading-5 text-dim">{COST.notTurnkey}</p>
      </section>

      <Footer />
    </div>
  );
}
