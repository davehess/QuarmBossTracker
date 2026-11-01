'use client';
// `?v=d` "Chapters" (the guild lead, 2026-11-01). The story video at an ordinary size, a chapter rail under it, and the feature
// card for the chapter beside it (below it on a phone). Pressing a chapter seeks the video there and swaps the card; as the
// video plays, the chapter it is in lights up and its card follows (chapterAt, web/lib/raidmimicStory.ts, from the same cue
// list as `?v=c`). The sign-up is pinned from the first second: a sticky header button from sm up, a bottom bar on a phone.
// `children` is the rest of the page (pricing, footer), rendered by the server: it has to live INSIDE this root, because a
// sticky header only sticks within its parent.
import { useRef, useState, type ReactNode } from 'react';
import SignInButton from '@/components/SignInButton';
import { CHAPTERS, chapterAt, featureById, GOLD_BTN, STORY_WORDS as W } from '@/lib/raidmimicStory';
import { ComingChip, FeaturePicture } from './StoryBits';
import StoryVideo, { useReducedMotion, type StoryVideoHandle } from './StoryVideo';

export default function ChaptersStage({ downloadUrl, onHost, children }: { downloadUrl: string; onHost: boolean; children?: ReactNode }) {
  const handle = useRef<StoryVideoHandle>(null);
  const reduced = useReducedMotion();
  const [time, setTime] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);   // a chapter just pressed, until the video's own time takes over
  const [ended, setEnded] = useState(false);

  const current = chapterAt(time);
  // Nothing is lit before the first chapter starts (the intro); the card then shows the first feature.
  const lit = picked ?? (time >= CHAPTERS[0].at ? current.id : null);
  const card = featureById((CHAPTERS.find(c => c.id === lit) ?? CHAPTERS[0]).feature);

  const pickedAt = useRef<number | null>(null);   // where a pressed chapter starts, until the video has actually got there
  const onTime = (t: number) => {
    if (pickedAt.current != null) {
      if (t < pickedAt.current - 0.1) return;       // a tick from before the seek landed: ignore it
      pickedAt.current = null;
      setPicked(null);
    }
    setTime(prev => (Math.abs(prev - t) < 0.25 ? prev : t));   // a quarter-second grain: the card does not repaint on every tick
  };
  const go = (id: string, at: number) => {
    pickedAt.current = at;
    setPicked(id);
    setEnded(false);
    setTime(at);
    handle.current?.seek(at);
  };

  return (
    <div className="pb-20 sm:pb-0">
      <header className={`sticky z-30 -mx-3 mb-4 flex items-center gap-3 border-b border-border bg-bg/95 px-3 py-2 backdrop-blur sm:-mx-4 sm:px-4 ${onHost ? 'top-0' : 'top-24'}`}>
        <img src="/mimic-logo.png" alt="" width={32} height={32} className="h-8 w-8 rounded-md" />
        <p className="m-0 text-lg font-bold uppercase tracking-wide text-[#f2ede1]">{W.brand}</p>
        <nav aria-label="Raid Mimic" className="ml-auto hidden items-center gap-4 text-sm sm:flex">
          {W.menu.map(m => <a key={m.href} href={m.href}>{m.label}</a>)}
          <a href={downloadUrl}>Download</a>
          <SignInButton next={W.after} label={W.signUp} className={GOLD_BTN} />
        </nav>
      </header>

      <div className="mx-auto max-w-5xl lg:grid lg:grid-cols-[auto_minmax(0,1fr)] lg:items-start lg:gap-8">
        <div className="mx-auto w-full [--rm-w:calc(min(68svh,700px)*9/16)] sm:max-w-[var(--rm-w)] lg:landscape:[--rm-w:min(60svh,560px)] lg:w-[var(--rm-w)]">
          <div className="relative overflow-hidden rounded-lg border border-border bg-[#0f1219]">
            <div className="rm-stage-box relative">
              <StoryVideo ref={handle} onTime={onTime} onEnd={() => setEnded(true)} halted={false} reduced={reduced} fit="object-cover" />
              {ended && !reduced && (
                <button type="button" onClick={() => { setEnded(false); setPicked(null); handle.current?.replay(); }}
                  className="absolute bottom-2 right-2 z-20 min-h-11 rounded-md border border-border bg-black/70 px-4 text-xs text-[#f2ede1] hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:bottom-3 sm:right-3 sm:text-sm">
                  {W.again}
                </button>
              )}
            </div>
          </div>
          <ol aria-label="Chapters" className="m-0 mt-2 grid list-none grid-cols-4 gap-2 p-0">
            {CHAPTERS.map(c => (
              <li key={c.id} className="min-w-0">
                <button type="button" onClick={() => go(c.id, c.at)} aria-current={lit === c.id ? 'true' : undefined}
                  className={`min-h-11 w-full rounded-md border px-1 text-xs sm:text-sm ${lit === c.id ? 'border-gold bg-gold/15 text-[#f2ede1]' : 'border-border bg-panel text-text hover:border-dim'} focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold`}>
                  {c.label}
                </button>
              </li>
            ))}
          </ol>
        </div>

        <section aria-live="polite" aria-label="About this part" data-chapter-card={card.id} id="features" className="mt-5 min-w-0 scroll-mt-24 lg:mt-0">
          <FeaturePicture f={card} />
          <h2 className="mt-3 text-xl text-[#f2ede1]">{card.name}</h2>
          <p className="mb-0 mt-1 text-sm leading-6 text-text">{card.line}</p>
          {card.chip && <p className="mb-0 mt-2"><ComingChip>{card.chip}</ComingChip></p>}
          <p className="mb-0 mt-4 text-sm text-dim">{W.startFree}</p>
        </section>
      </div>

      {children}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-bg/95 p-3 backdrop-blur sm:hidden">
        <SignInButton next={W.after} label={W.signUp} className={`${GOLD_BTN} w-full`} />
      </div>
    </div>
  );
}
