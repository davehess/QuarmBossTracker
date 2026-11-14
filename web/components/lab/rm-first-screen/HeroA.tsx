'use client';
// Version A, "Hook beside the video": the headline, one sentence and two buttons from the first frame, with the story video
// beside them on a wide screen and under them on a phone. The three skip controls (big Skip, bottom Skip, Hide) become one
// button that stops the video on its last frame and turns into "Watch again". Sound and captions are the browser's own.
import { useEffect, useRef, useState } from 'react';
import type { HeroCopy, HeroLinks, HeroMedia } from '@/lib/lab/fixtures/rm-first-screen';
import { Btn, H1, LEAD, Lockup } from './parts';

export default function HeroA({ copy, links, media }: { copy: HeroCopy; links: HeroLinks; media: HeroMedia }) {
  const vid = useRef<HTMLVideoElement>(null);
  const [skipped, setSkipped] = useState(false);
  useEffect(() => {
    try { if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) { vid.current?.pause(); setSkipped(true); } } catch { /* motion stays on */ }
  }, []);
  const toggle = () => {
    const v = vid.current;
    if (skipped) { setSkipped(false); if (v) { v.currentTime = 0; void v.play().catch(() => {}); } }
    else { v?.pause(); setSkipped(true); }
  };
  return (
    <section id="top" aria-label="Raid Mimic" data-hero="a" className="mx-auto max-w-5xl px-1 pb-10 pt-4 sm:pt-6">
      <Lockup />
      <div className="mt-6 grid gap-7 lg:items-start lg:grid-cols-[minmax(0,1fr)_minmax(0,25rem)] lg:gap-12">
        <div>
          <h1 className={H1}>{copy.headline}</h1>
          <p className={LEAD}>{copy.sentence}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Btn gold href={links.download}>{copy.download}</Btn>
            <Btn href={links.demo}>{copy.demo}</Btn>
          </div>
        </div>
        <figure className="m-0">
          <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-panel">
            <video ref={vid} autoPlay muted playsInline controls preload="metadata" poster={media.video.poster}
              className={`absolute inset-0 h-full w-full object-contain ${skipped ? 'invisible' : ''}`}>
              <source src={media.video.src} type="video/mp4" />
              <track kind="captions" srcLang="en" label="English" src={media.video.captions} />
            </video>
            {skipped && <img src={media.video.endPoster} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-contain" />}
          </div>
          <figcaption className="mt-2 flex items-center justify-between gap-3 text-xs text-dim">
            <span>{copy.aiLabel}</span>
            <button type="button" onClick={toggle} className="inline-flex min-h-11 items-center bg-transparent px-2 text-sm text-blue underline">
              {skipped ? copy.again : copy.skip}
            </button>
          </figcaption>
        </figure>
      </div>
    </section>
  );
}
