// The raidmimic.com page: "Pick your path" (the guild lead's pick, 2026-10-23, from two previews; the Ladder and the earlier
// Scene-first layout are deleted). Organised by who is reading: a short hero, then three doors side by side (Player, Guild,
// Self-host), each with its own short story and its own next step. Under the doors, "See it run" holds the captures and the
// scene player (its two audience tabs are the Player and Guild doors again), then "How it works" (the four-step drawing, in
// a frame), the small print, the coming list and the ask.
// The door's arched top is the one distinctive thing here. Server component; the only client code is the player (ClipTabs)
// and the drawing's frame (HowItWorks). Every word is in web/lib/raidmimicPlayer.ts (and raidmimicLanding.ts for the facts).
import { Fragment, type ReactNode } from 'react';
import {
  CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, MAP_CREDIT, SHOTS_HEAD, WORKS_WITH, WORLDS,
} from '@/lib/raidmimicLanding';
import {
  DOORS, DOWNLOAD_URL, HERO, HOW, PATHS, SELFHOST_GUIDE_URL, TAG, type Door, type Tone,
} from '@/lib/raidmimicPlayer';
import {
  BetaTag, ComingList, CostBody, CtaBand, DataBody, EXT, Fold, Footer, MoreShots, PRIMARY_BTN, WorksWithBody, WorldsBody, type Ctx,
} from './Parts';
import ClipTabs from './ClipTabs';
import FeatureGrid from './FeatureIcons';
import HowItWorks from './HowItWorks';
import MascotHero from './MascotHero';
import MotionStage from './MotionStage';
import SignInTop from './SignInTop';

// Colour stays semantic (frontend-design): green = free and working today, blue = needs the guild's own server, gold =
// a choice for you; the dashed orange "Coming" chip from Parts is the only way a promise is ever drawn.
const TONE: Record<Tone, string> = {
  free: 'border-green/60 text-green',
  hub: 'border-blue/60 text-blue',
  choice: 'border-gold/70 text-gold',
};

function Tag({ tone }: { tone: Tone }): ReactNode {
  return (
    <span data-tone={tone} className={`inline-flex items-center rounded border px-1.5 py-0.5 text-[11px] leading-4 tracking-wide ${TONE[tone]}`}>
      {TAG[tone]}
    </span>
  );
}

/** A quiet button for the second action on a block; the one gold button on screen stays the primary. */
const OUTLINE_BTN =
  'inline-flex min-h-11 items-center justify-center rounded-md border border-blue/70 px-4 py-2 text-sm font-semibold text-blue no-underline transition-colors hover:border-blue hover:bg-blue/10 hover:no-underline motion-reduce:transition-none';

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

// `motion` is the `?v=motion` preview (beta only; a raidmimic host drops the query): the 3D mimic's vertical story video, with
// the real captures in a strip below it, takes the hero's place. The headline moves into the stage, so a desktop shows it
// beside the video (with the download button) and a phone shows it above, as before; the older mascot hero leaves "See it run".
// `signIn` is the `?v=b` variant (the guild lead's pick, 2026-10-31): the top, headline with the video and the three doors, is
// SignInTop instead (a sign-in card first); everything from the feature grid down is the same. See SignInTop.tsx.
export default function PathsLayout({ ctx, motion = false, signIn = false }: { ctx: Ctx; motion?: boolean; signIn?: boolean }) {
  // The headline is the same element either way; in the preview the stage owns it and lays it out beside the video.
  const Frame = motion ? MotionStage : Fragment;
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <BetaTag ctx={ctx} />

      {signIn ? <SignInTop ctx={ctx} /> : <>
        <Frame>
          <header className={motion ? 'mb-6 lg:mb-0' : 'mb-6'}>
            <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
            <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1] sm:text-5xl">{HERO.name}</h1>
            <p className="mt-3 max-w-[60ch] text-base leading-7 text-[#f2ede1] sm:text-xl sm:leading-8">{PATHS.line}</p>
            <p className="mt-3 max-w-[66ch] text-sm leading-6 text-text">{HERO.fine}</p>
            {motion && (
              <div className="mt-5 hidden flex-wrap items-center gap-x-4 gap-y-1 lg:flex">
                <a href={DOWNLOAD_URL} className={PRIMARY_BTN}>{HERO.download}</a>
                <a href={ctx.setup} className="inline-flex min-h-11 items-center text-sm">{HERO.setup} →</a>
              </div>
            )}
          </header>
        </Frame>

        <section aria-label={PATHS.doorsLabel}>
          <ul className="m-0 grid list-none gap-4 p-0 lg:grid-cols-3">
            {DOORS.map(d => <DoorCard key={d.id} door={d} ctx={ctx} />)}
          </ul>
        </section>
      </>}

      <FeatureGrid />

      <section id="see" aria-label={PATHS.seeTitle} className="mt-14 scroll-mt-4">
        <h2 className="text-xl text-[#f2ede1] sm:text-2xl">{PATHS.seeTitle}</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-sm leading-6 text-text">{PATHS.seeLead}</p>
        {!motion && <MascotHero />}
        <p className="mb-8 text-xs leading-5 text-dim">{SHOTS_HEAD.note} {MAP_CREDIT}</p>
        <section aria-label={CLIPS_HEAD.stageLabel} data-paths-player>
          <h3 className="text-lg text-[#f2ede1]">{CLIPS_HEAD.title}</h3>
          <div className="mt-3"><ClipTabs /></div>
          <p className="mt-3 text-xs text-dim">{CLIPS_NOTE}</p>
        </section>
        <MoreShots />
      </section>

      <section id={HOW.id} aria-label={HOW.title} className="mt-14 scroll-mt-4">
        <h2 className="text-xl text-[#f2ede1] sm:text-2xl">{HOW.title}</h2>
        <p className="mb-4 mt-1 max-w-[62ch] text-sm leading-6 text-text">{HOW.lead}</p>
        <HowItWorks />
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
