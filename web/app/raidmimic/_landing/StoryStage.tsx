'use client';
// `?v=c` "Story stage" (the guild lead, 2026-11-01: "it'd be cool if [the video] started as the primary view ... then menus
// appear as the video progresses ... the mimic icon [when] he turns from a chest into a mimic ... menus show up when the
// overlays do, the sign in link at the end"). The video IS the first screen, a full viewport tall; the page chrome starts hidden
// and appears on the video's timeline from ONE cue list (STORY_CUES in web/lib/raidmimicStory.ts, via revealAt):
//   icon  (top-left)  when the chest becomes the mimic     menu  (top)  when the overlays first land on the monitor
//   end   the video dims and a centred card offers "Sign up with Discord" and "Start free · Pro for your guild or for you".
// One `timeupdate` listener (StoryVideo) feeds `revealAt`; the rest is CSS transitions on opacity. Skip, finishing, and
// reduced motion all show everything at once. Without script the chrome is shown by the <noscript> rule below.
// The page under it (FeatureBlocks, Pricing) is server-rendered by the page; this file is only the first screen.
import { useRef, useState } from 'react';
import SignInButton from '@/components/SignInButton';
import { GOLD_BTN, revealAt, sameReveal, STORY_WORDS as W, type Reveal } from '@/lib/raidmimicStory';
import StoryVideo, { useReducedMotion, type StoryVideoHandle } from './StoryVideo';

const FADE = 'transition-[opacity,visibility] duration-700 motion-reduce:transition-none';
const on = (show: boolean) => (show ? 'visible opacity-100' : 'invisible opacity-0');
const GHOST = 'inline-flex min-h-11 items-center rounded-md px-2 text-sm text-[#f2ede1] no-underline hover:bg-white/10 hover:no-underline focus-visible:outline focus-visible:outline-2 focus-visible:outline-gold sm:px-3';

export default function StoryStage({ downloadUrl }: { downloadUrl: string }) {
  const handle = useRef<StoryVideoHandle>(null);
  const reduced = useReducedMotion();
  const [timed, setTimed] = useState<Reveal>(() => revealAt(0));
  const [skipped, setSkipped] = useState(false);
  const [ended, setEnded] = useState(false);
  const all = skipped || ended || reduced;
  const show: Reveal = all ? revealAt(0, true) : timed;

  const onTime = (t: number) => {
    const next = revealAt(t);
    setTimed(prev => (sameReveal(prev, next) ? prev : next));
  };
  const again = () => {
    setSkipped(false);
    setEnded(false);
    setTimed(revealAt(0));
    handle.current?.replay();
  };

  return (
    <section id="top" aria-label="Raid Mimic: the story" data-story-stage
      className="relative h-[calc(100svh-1.5rem)] min-h-[32rem] overflow-hidden rounded-lg border border-border bg-[#0f1219]">
      <noscript><style>{'[data-reveal]{opacity:1!important;visibility:visible!important}'}</style></noscript>

      <StoryVideo ref={handle} onTime={onTime} onEnd={() => setEnded(true)} halted={skipped || ended} reduced={reduced}
        fit="object-contain portrait:object-cover" />

      {/* Chrome that arrives on the timeline. */}
      <header className="pointer-events-none absolute inset-x-0 top-0 z-30 flex items-center gap-2 p-2 sm:gap-3 sm:p-3">
        <a href="#top" data-reveal="icon" aria-label={W.brand} tabIndex={show.icon ? 0 : -1}
          className={`pointer-events-auto ${FADE} ${on(show.icon)}`}>
          <img src="/mimic-logo.png" alt="" width={44} height={44} className="block h-10 w-10 rounded-lg sm:h-11 sm:w-11" />
        </a>
        <nav data-reveal="menu" aria-label="Raid Mimic" className={`pointer-events-auto ml-auto flex items-center gap-1 rounded-lg bg-black/55 p-1 ${FADE} ${on(show.menu)}`}>
          {W.menu.map(m => <a key={m.href} href={m.href} tabIndex={show.menu ? 0 : -1} className={GHOST}>{m.label}</a>)}
          <a href={downloadUrl} tabIndex={show.menu ? 0 : -1} className={`${GHOST} hidden sm:inline-flex`}>Download</a>
          <SignInButton next={W.after} label={W.signIn} className={`${GHOST} bg-transparent`} />
        </nav>
      </header>

      {!show.end && (
        <button type="button" onClick={() => setSkipped(true)}
          className="absolute bottom-2 right-2 z-20 min-h-11 rounded-md border border-border bg-black/70 px-4 text-xs text-[#f2ede1] hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:bottom-3 sm:right-3 sm:text-sm">
          {W.skip}
        </button>
      )}

      {/* The end: the video dims and the sign-up card appears. */}
      <div data-reveal="end" aria-hidden={!show.end}
        className={`absolute inset-0 z-40 flex items-center justify-center bg-black/70 p-4 ${FADE} ${on(show.end)}`}>
        <div className="w-full max-w-sm rounded-lg border border-border bg-panel p-5 text-center shadow-xl shadow-black/50">
          <img src="/mimic-logo.png" alt="" width={56} height={56} className="mx-auto block h-14 w-14 rounded-xl" />
          <h2 className="mt-3 text-2xl text-[#f2ede1]">{W.brand}</h2>
          <div className="mt-4"><SignInButton next={W.after} label={W.signUp} className={`${GOLD_BTN} w-full`} /></div>
          <p className="mb-0 mt-3 text-sm leading-6 text-text">{W.startFree}</p>
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
