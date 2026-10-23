// raidmimic layout preview ?v=paths, "Pick your path" (the guild lead, 2026-10-23). The same facts as the Ladder, organised by who
// is reading instead of in one scroll: a short hero, then three doors side by side (Player, Guild, Self-host), each with its own
// short story and its own next step. Under the doors, "See it run" holds the existing captures and the scene player (its two
// audience tabs are the Player and Guild doors again), then the small print, the coming list and the ask.
// The door's arched top is the one distinctive thing here. Server component; the only client code is the player (ClipTabs).
// Every word is in web/lib/raidmimicPlayer.ts (and raidmimicLanding.ts for the facts the default page already states).
import {
  CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, MAP_CREDIT, SHOTS_HEAD, WORKS_WITH, WORLDS,
} from '@/lib/raidmimicLanding';
import {
  DOORS, DOWNLOAD_URL, HERO, PATHS, SELFHOST_GUIDE_URL, type Door,
} from '@/lib/raidmimicPlayer';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, Fold, Footer, MoreShots, PRIMARY_BTN, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import { EXT, OUTLINE_BTN, PreviewBar, Tag } from './VariantParts';
import ClipTabs from './ClipTabs';
import MascotHero from './MascotHero';

const ARCH: Record<Door['tone'], string> = {
  free: 'border-t-green',
  hub: 'border-t-blue',
  choice: 'border-t-gold',
};

// The door's next step (the button) and its quiet second link. The wording is in the module; only the addresses are here.
function DoorActions({ door, ctx }: { door: Door; ctx: Ctx }) {
  const interest = { href: ctx.interest, ...(ctx.onHost ? EXT : {}) };
  const textLink = 'inline-flex min-h-11 items-center text-sm';
  if (door.id === 'player') {
    return (
      <>
        <a href={DOWNLOAD_URL} className={PRIMARY_BTN}>{door.next}</a>
        <a href={ctx.setup} className={textLink}>{door.more} →</a>
      </>
    );
  }
  if (door.id === 'guild') {
    return (
      <>
        <a {...interest} className={OUTLINE_BTN}>{door.next}</a>
        <a href="#see" className={textLink}>{door.more} →</a>
      </>
    );
  }
  return (
    <>
      <a href={SELFHOST_GUIDE_URL} {...EXT} className={OUTLINE_BTN}>{door.next}</a>
      <a {...interest} className={textLink}>{door.more} →</a>
    </>
  );
}

function DoorCard({ door, ctx }: { door: Door; ctx: Ctx }) {
  return (
    <li id={`door-${door.id}`} className="scroll-mt-4">
      <article aria-labelledby={`door-${door.id}-name`}
        className={`flex h-full flex-col rounded-t-[2rem] rounded-b-md border border-t-[3px] border-border bg-panel px-4 pb-4 pt-6 sm:px-5 ${ARCH[door.tone]}`}>
        <p className="text-xs uppercase tracking-widest text-gold">{door.label}</p>
        <h2 id={`door-${door.id}-name`} className="mt-1 text-2xl leading-tight text-[#f2ede1]">{door.name}</h2>
        <p className="mt-1 text-base leading-snug text-[#f2ede1]">{door.head}</p>
        <div className="mt-3"><Tag tone={door.tone} /></div>
        <p className="mt-3 text-sm leading-6 text-text">{door.story}</p>
        <ul className="m-0 mt-3 list-disc space-y-1 pl-5 text-sm leading-6 text-text marker:text-dim">
          {door.points.map(p => <li key={p}>{p}</li>)}
        </ul>
        <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-5">
          <DoorActions door={door} ctx={ctx} />
        </div>
        {door.nextNote && <p className="mt-1 text-xs text-dim">{door.nextNote}</p>}
      </article>
    </li>
  );
}

export default function PathsLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <BetaTag ctx={ctx} />
      <PreviewBar current="paths" />

      <header className="mb-6">
        <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
        <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1] sm:text-5xl">{HERO.name}</h1>
        <p className="mt-3 max-w-[60ch] text-base leading-7 text-[#f2ede1] sm:text-xl sm:leading-8">{PATHS.line}</p>
        <p className="mt-3 max-w-[66ch] text-sm leading-6 text-text">{HERO.fine}</p>
      </header>

      <section aria-label={PATHS.doorsLabel}>
        <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
          {DOORS.map(d => <DoorCard key={d.id} door={d} ctx={ctx} />)}
        </ul>
      </section>

      <section id="see" aria-label={PATHS.seeTitle} className="mt-14 scroll-mt-4">
        <h2 className="text-xl text-[#f2ede1] sm:text-2xl">{PATHS.seeTitle}</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-sm leading-6 text-text">{PATHS.seeLead}</p>
        <MascotHero />
        <p className="mb-8 text-xs leading-5 text-dim">{SHOTS_HEAD.note} {MAP_CREDIT}</p>
        <section aria-label={CLIPS_HEAD.stageLabel} data-paths-player>
          <h3 className="text-lg text-[#f2ede1]">{CLIPS_HEAD.title}</h3>
          <div className="mt-3"><ClipTabs /></div>
          <p className="mt-3 text-xs text-dim">{CLIPS_NOTE}</p>
        </section>
        <MoreShots />
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
