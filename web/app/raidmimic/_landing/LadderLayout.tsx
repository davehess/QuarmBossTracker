// raidmimic layout preview ?v=player, "Ladder" (the guild lead, 2026-10-23: "less about me setting it up as a service for
// them and more about here's what you get as a player, here's what you could have as a guild"). ONE scroll, four rungs in the
// order he said them: what you get as a player, jump in now, what your guild could have, and what to do once your guild is
// using it (run your own, or have it hosted). The vertical rail with its numbered markers is the one distinctive thing here;
// everything else is the page's existing parts (the mascot and captures, the scene player, the coming list, the ask).
// Server component; the only client code is the player (ClipTabs), pinned to one audience per rung.
// Every word is in web/lib/raidmimicPlayer.ts (and raidmimicLanding.ts for the facts the default page already states).
import type { ReactNode } from 'react';
import {
  CLIPS_HEAD, CLIPS_NOTE, COST, DATA, FACTS_TITLE, MAP_CREDIT, SHOTS_HEAD, WORLDS,
} from '@/lib/raidmimicLanding';
import {
  ASK, DOWNLOAD_URL, GUILD, HERO, JUMP, LINUX_URL, PLAYER, RUN, SELFHOST_GUIDE_URL, type Tone,
} from '@/lib/raidmimicPlayer';
import {
  BetaTag, ComingList, CtaBand, DataBody, Fold, Footer, MoreShots, PRIMARY_BTN, StatusChip, WorldsBody, type Ctx,
} from './Parts';
import { ComingCard, EXT, OUTLINE_BTN, Points, PreviewBar, Tag } from './VariantParts';
import ClipTabs from './ClipTabs';
import MascotHero from './MascotHero';

const MARK: Record<Tone, string> = {
  free: 'border-green/70 text-green',
  hub: 'border-blue/70 text-blue',
  choice: 'border-gold/70 text-gold',
};

// One rung: the marker and title on a row, the rail down the left from sm up, the content under it. On a phone the rail is
// not drawn and the content takes the full width, so a capture is as wide as the screen allows.
function Rung({ n, id, tone, title, lead, tag, last = false, children }: {
  n: string; id: string; tone: Tone; title: string; lead: string; tag?: ReactNode; last?: boolean; children: ReactNode;
}) {
  return (
    <li id={id} className={`relative scroll-mt-4 ${last ? '' : 'pb-12'}`}>
      {!last && <span aria-hidden className="absolute bottom-0 left-[15px] top-10 hidden w-px bg-border sm:block" />}
      <div className="flex items-center gap-3">
        <span aria-hidden className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full border bg-bg text-sm ${MARK[tone]}`}>{n}</span>
        <h2 className="text-xl leading-tight text-[#f2ede1] sm:text-2xl"><span className="sr-only">Step {n}: </span>{title}</h2>
      </div>
      <div className="mt-3 sm:pl-12">
        <div className="mb-3">{tag ?? <Tag tone={tone} />}</div>
        <p className="mb-5 max-w-[62ch] text-sm leading-6 text-text sm:text-base sm:leading-7">{lead}</p>
        {children}
      </div>
    </li>
  );
}

export default function LadderLayout({ ctx }: { ctx: Ctx }) {
  return (
    <div className="mx-auto max-w-5xl pb-12">
      <BetaTag ctx={ctx} />
      <PreviewBar current="player" />

      <header className="mb-8">
        <p className="text-xs uppercase tracking-widest text-gold">{HERO.kicker}</p>
        <h1 className="mt-1 text-3xl leading-tight text-[#f2ede1] sm:text-5xl">{HERO.name}</h1>
        <p className="mt-3 max-w-[60ch] text-base leading-7 text-[#f2ede1] sm:text-xl sm:leading-8">{HERO.line}</p>
        <p className="mt-3 max-w-[66ch] text-sm leading-6 text-text">{HERO.fine}</p>
        <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a href={DOWNLOAD_URL} className={PRIMARY_BTN}>{HERO.download}</a>
          <a href={ctx.setup} className="inline-flex min-h-11 items-center text-sm">{HERO.setup} →</a>
          <a href="#guild" className="inline-flex min-h-11 items-center text-sm">{HERO.guildLink} →</a>
        </div>
        <p className="mt-2 text-xs text-dim">{HERO.downloadNote}</p>
      </header>

      <MascotHero />
      <p className="mb-10 text-xs leading-5 text-dim">{SHOTS_HEAD.note} {MAP_CREDIT}</p>

      <ol className="m-0 list-none p-0">
        <Rung {...PLAYER}>
          <Points points={PLAYER.points} cols />
          <p className="mt-3 text-xs leading-5 text-dim">{PLAYER.aside}</p>

          <section aria-label={CLIPS_HEAD.stageLabel} className="mt-8">
            <h3 className="text-lg text-[#f2ede1]">{CLIPS_HEAD.title}</h3>
            <div className="mt-3"><ClipTabs only="raiders" /></div>
            <p className="mt-3 text-xs text-dim">{CLIPS_NOTE}</p>
          </section>
          <MoreShots />
        </Rung>

        <Rung {...JUMP}>
          <ol className="m-0 list-none space-y-3 p-0">
            {JUMP.steps.map(s => (
              <li key={s.head} className="rounded-md border border-border bg-panel p-4">
                <h3 className="text-base leading-snug text-[#f2ede1]">{s.head}</h3>
                <p className="mt-1 text-sm leading-6 text-text">{s.body}</p>
              </li>
            ))}
          </ol>
          <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
            <a href={DOWNLOAD_URL} className={PRIMARY_BTN}>{HERO.download}</a>
            <a href={ctx.setup} className="inline-flex min-h-11 items-center text-sm">{JUMP.guide} →</a>
          </div>
          <p className="mt-2 max-w-[66ch] text-xs leading-5 text-dim">
            {HERO.platformNote} <a href={LINUX_URL} {...EXT}>{HERO.platformLink}</a>.
          </p>
          <div className="mt-6">
            <ComingCard chip={<StatusChip status="coming" />} head={JUMP.comingHead} body={JUMP.comingBody} />
          </div>
        </Rung>

        <Rung {...GUILD}>
          <Points points={GUILD.points} cols />
          <section aria-label={CLIPS_HEAD.stageLabel} className="mt-8">
            <h3 className="text-lg text-[#f2ede1]">{GUILD.mediaHead}</h3>
            <div className="mt-3"><ClipTabs only="leaders" /></div>
            <p className="mt-3 text-xs text-dim">{GUILD.mediaNote}</p>
          </section>
          <div className="mt-6">
            <ComingCard chip={<StatusChip status="coming" />} head={GUILD.comingHead} body={GUILD.comingBody} />
          </div>
          <div className="mt-4"><Fold id="data" title={DATA.title}><DataBody /></Fold></div>
        </Rung>

        <Rung {...RUN} last>
          <div className="grid gap-3 lg:grid-cols-2">
            <article aria-label={RUN.own.head} className="flex flex-col rounded-md border border-border bg-panel p-4 sm:p-5">
              <div className="mb-2"><Tag tone="free" label={RUN.own.tag} /></div>
              <h3 className="text-lg text-[#f2ede1]">{RUN.own.head}</h3>
              <ul className="m-0 mt-2 list-none space-y-3 p-0">
                {RUN.own.points.map(p => (
                  <li key={p.head} className="text-sm leading-6">
                    <b className="font-semibold text-[#f2ede1]">{p.head}.</b> <span className="text-text">{p.body}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-sm leading-6 text-[#f2ede1]">{COST.scale}</p>
              <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4">
                <a href={SELFHOST_GUIDE_URL} {...EXT} className={OUTLINE_BTN}>{RUN.own.guide}</a>
                <a href={ctx.interest} {...(ctx.onHost ? EXT : {})} className="inline-flex min-h-11 items-center text-sm">{ASK.link} →</a>
              </div>
            </article>

            <article aria-label={RUN.hosted.head} className="flex flex-col rounded-md border border-dashed border-orange/70 p-4 sm:p-5">
              <div className="mb-2"><StatusChip status="coming" /></div>
              <h3 className="text-lg text-[#f2ede1]">{RUN.hosted.head}</h3>
              <p className="mt-2 text-sm leading-6 text-[#f2ede1]">{RUN.hosted.lead}</p>
              <ul className="m-0 mt-2 list-none space-y-3 p-0">
                {COST.points.slice(0, 2).map(p => (
                  <li key={p.head} className="text-sm leading-6">
                    <b className="font-semibold text-[#f2ede1]">{p.head}.</b> <span className="text-text">{p.body}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-xs leading-5 text-dim">{RUN.hosted.fine}</p>
            </article>
          </div>
        </Rung>
      </ol>

      <section aria-label={FACTS_TITLE} className="mt-10 space-y-2">
        <Fold id="worlds" title={WORLDS.title}><WorldsBody /></Fold>
      </section>

      <div className="mt-10"><ComingList /></div>
      <div className="mt-4"><CtaBand ctx={ctx} /></div>

      <Footer />
    </div>
  );
}
