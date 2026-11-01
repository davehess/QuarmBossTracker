'use client';
// The raidmimic front door: the "Story stage" (the guild lead picked C on 2026-11-01: "C, but start truly as the only thing on
// the page, fit is the video, fade it into the background color. Slowly add the logos as we go into the video. Skip/hide at the
// bottom."). At first load the video is ALL there is: a full viewport, nothing else drawn (no logo, no menu, no label; the
// site header and beta banner do not exist on the raidmimic hosts). The picture is shown whole (object-contain, never cropped)
// in a box whose edges fade into the page colour (.rm-frame in globals.css). Then the chrome arrives on the video's own
// timeline from ONE cue list (STORY_CUES in web/lib/raidmimicStory.ts, via revealAt):
//   icon + name  (top-left)  when the chest becomes the mimic   menu  (top-right)  when the overlays first land
//   marks        (the edges) one feature mark per moment: Overlays, Calls, Loot, Hail, each fading in over 1.2 s
//   end          the video dims and a centred card offers "Sign up with Discord".
// Skip (jump to the end card) and Hide (collapse the stage to a slim bar, reading on) sit with Sound and CC in a quiet row at the
// bottom. Skipping, finishing, hiding and reduced motion all show everything at once. Without script the chrome is shown by
// the <noscript> rule below. The page under it (FeatureBlocks, Pricing) is server-rendered by the page.
import { useRef, useState } from 'react';
import SignInButton from '@/components/SignInButton';
import AgreeLine from '@/components/AgreeLine';
import { GOLD_BTN, MARKS, revealAt, sameReveal, STORY_WORDS as W, type Reveal } from '@/lib/raidmimicStory';
import { ICONS } from './FeatureIcons';
import StoryVideo, { QUIET_BTN, useReducedMotion, type StoryVideoHandle } from './StoryVideo';

const FADE = 'transition-[opacity,visibility] duration-700 motion-reduce:transition-none';
const SLOW = 'transition-[opacity,visibility] duration-[1200ms] ease-out motion-reduce:transition-none';
const on = (show: boolean) => (show ? 'visible opacity-100' : 'invisible opacity-0');
const GHOST = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm text-[#f2ede1] no-underline hover:bg-white/10 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold sm:px-3';

export default function StoryStage({ downloadUrl, onHost = false }: { downloadUrl: string; onHost?: boolean }) {
  const handle = useRef<StoryVideoHandle>(null);
  const reduced = useReducedMotion();
  const [timed, setTimed] = useState<Reveal>(() => revealAt(0));
  const [skipped, setSkipped] = useState(false);
  const [ended, setEnded] = useState(false);
  const [hidden, setHidden] = useState(false);
  const all = skipped || ended || reduced || hidden;
  const show: Reveal = all ? revealAt(0, true) : timed;

  const onTime = (t: number) => {
    const next = revealAt(t);
    setTimed(prev => (sameReveal(prev, next) ? prev : next));
  };
  const again = () => {
    setSkipped(false);
    setEnded(false);
    setHidden(false);
    setTimed(revealAt(0));
    handle.current?.replay();
  };

  // On a raidmimic host the layout wraps the page in 12/16px of padding: the stage reaches out to the viewport's edges.
  const place = onHost ? '-mx-3 -mt-3 sm:-mx-4 sm:-mt-4' : 'rm-stage-in-site';

  // The lockup (icon + name) and the menu: the header, on the timeline.
  const header = (
    <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
      <a href="#top" data-reveal="icon" aria-label={W.brand} tabIndex={show.icon ? 0 : -1}
        className={`pointer-events-auto flex items-center gap-2 rounded-lg text-[#f2ede1] no-underline hover:no-underline ${SLOW} ${on(show.icon)}`}>
        <img src="/mimic-logo.png" alt="" width={44} height={44} className="block h-10 w-10 rounded-lg sm:h-11 sm:w-11" />
        <span className="text-base font-semibold sm:text-lg">{W.brand}</span>
      </a>
      <nav data-reveal="menu" aria-label="Raid Mimic" className={`pointer-events-auto ml-auto flex items-center gap-1 rounded-lg bg-black/55 p-1 ${SLOW} ${on(show.menu)}`}>
        {/* A phone keeps only Sign in up here: three more links wrapped to three lines and crowded the name (2026-11-01). */}
        {W.menu.map(m => <a key={m.href} href={m.href} tabIndex={show.menu ? 0 : -1} className={`${GHOST} hidden sm:inline-flex`}>{m.label}</a>)}
        <a href={downloadUrl} tabIndex={show.menu ? 0 : -1} className={`${GHOST} hidden sm:inline-flex`}>Download</a>
        <SignInButton next={W.after} label={W.signIn} className={`${GHOST} bg-transparent`} />
      </nav>
    </header>
  );

  // Hidden: the stage is a slim bar (lockup, menu, a way back) and the page reads on straight under it.
  if (hidden) {
    return (
      <section id="top" aria-label="Raid Mimic" data-story-stage="hidden" className={`relative ${place} min-h-[4.5rem] border-b border-border`}>
        {header}
        <div className="absolute inset-x-0 bottom-0 flex justify-center p-1">
          <button type="button" onClick={again} className={QUIET_BTN}>{W.show}</button>
        </div>
        <div aria-hidden className="h-[4.5rem]" />
      </section>
    );
  }

  return (
    <section id="top" aria-label="Raid Mimic: the story" data-story-stage={onHost ? 'host' : 'site'}
      className={`rm-stage relative ${place} overflow-hidden bg-bg`}>
      <noscript><style>{'[data-reveal]{opacity:1!important;visibility:visible!important}'}</style></noscript>

      <StoryVideo ref={handle} onTime={onTime} onEnd={() => setEnded(true)} halted={skipped || ended} reduced={reduced}
        fit="object-contain">
        {!show.end && <button type="button" onClick={() => setSkipped(true)} className={QUIET_BTN}>{W.skip}</button>}
        <button type="button" onClick={() => setHidden(true)} className={QUIET_BTN}>{W.hide}</button>
      </StoryVideo>

      {header}

      {/* The feature marks: one fades in as each moment passes. A row under the header on a phone; a column in the left gutter
          beside the (square) picture on a wide screen. They sit on the faded edge, never over the middle of the picture. */}
      <ul aria-label="What Raid Mimic does" className="pointer-events-none absolute inset-x-0 top-20 z-20 m-0 flex list-none justify-center gap-x-5 p-0 sm:top-[4.5rem] lg:inset-y-0 lg:left-5 lg:right-auto lg:top-0 lg:flex-col lg:items-start lg:justify-center lg:gap-y-7">
        {MARKS.map(m => {
          const Icon = ICONS[m.icon];
          return (
            <li key={m.id} data-reveal="mark" data-mark={m.id}
              className={`flex flex-col items-center gap-1 ${SLOW} ${on(show.marks.includes(m.id))}`}>
              <span aria-hidden="true" className="block h-7 w-7 text-[#e0a92c] sm:h-8 sm:w-8"><Icon /></span>
              <span className="text-[11px] uppercase tracking-widest text-[#f2ede1]/80">{m.label}</span>
            </li>
          );
        })}
      </ul>

      {/* The end: the video dims and the sign-up card appears. */}
      <div data-reveal="end" aria-hidden={!show.end}
        className={`absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 ${FADE} ${on(show.end)}`}>
        <div className="w-full max-w-sm rounded-lg border border-border bg-panel p-5 text-center shadow-xl shadow-black/50">
          <img src="/mimic-logo.png" alt="" width={56} height={56} className="mx-auto block h-14 w-14 rounded-xl" />
          <h2 className="mt-3 text-2xl text-[#f2ede1]">{W.brand}</h2>
          <div className="mt-4"><SignInButton next={W.after} label={W.signUp} className={`${GOLD_BTN} w-full`} /></div>
          <AgreeLine onHost={onHost} />          <p className="mb-0 mt-3 text-sm leading-6 text-text">{W.startFree}</p>
          <div className="mt-3 flex flex-wrap items-center justify-center gap-x-4">
            <a href="#features" tabIndex={show.end ? 0 : -1} className="inline-flex min-h-11 items-center text-sm">{W.scroll} ↓</a>
            {!reduced && <button type="button" onClick={again} tabIndex={show.end ? 0 : -1}
              className="inline-flex min-h-11 items-center bg-transparent text-sm text-blue underline">{W.again}</button>}
          </div>
        </div>
      </div>
    </section>
  );
}
