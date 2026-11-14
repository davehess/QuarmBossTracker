'use client';
// Version B, "Captures first": a still first screen. The words and Download on the left, real overlay captures on the right
// (damage meters, debuffs on the boss). The story video is a button that swaps the captures for the video in place.
import { useState } from 'react';
import type { HeroCopy, HeroLinks, HeroMedia } from '@/lib/lab/fixtures/rm-first-screen';
import { Btn, H1, LEAD, Lockup, Shot } from './parts';

export default function HeroB({ copy, links, media }: { copy: HeroCopy; links: HeroLinks; media: HeroMedia }) {
  const [story, setStory] = useState(false);
  return (
    <section id="top" aria-label="Raid Mimic" data-hero="b" className="mx-auto max-w-5xl px-1 pb-10 pt-4 sm:pt-6">
      <Lockup />
      <div className="mt-6 grid items-center gap-7 lg:grid-cols-[minmax(0,1fr)_minmax(0,28rem)] lg:gap-10">
        <div>
          <h1 className={H1}>{copy.headline}</h1>
          <p className={LEAD}>{copy.sentence}</p>
          <div className="mt-6 flex flex-wrap items-center gap-3">
            <Btn gold href={links.download}>{copy.download}</Btn>
            <Btn pressed={story} onClick={() => setStory(!story)}>{story ? copy.closeStory : copy.watch}</Btn>
          </div>
        </div>
        {story ? (
          <figure className="m-0">
            <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-panel">
              <video autoPlay playsInline controls preload="auto" poster={media.video.poster} className="absolute inset-0 h-full w-full object-contain">
                <source src={media.video.src} type="video/mp4" />
                <track kind="captions" srcLang="en" label="English" src={media.video.captions} />
              </video>
            </div>
            <figcaption className="mt-2 text-xs text-dim">{copy.aiLabel}</figcaption>
          </figure>
        ) : (
          <div className="grid gap-3">
            <figure className="m-0"><Shot shot={media.dps} eager /><figcaption className="mt-1 text-xs text-dim">{media.dps.label}</figcaption></figure>
            <figure className="m-0 hidden sm:block"><Shot shot={media.stats} eager /><figcaption className="mt-1 text-xs text-dim">{media.stats.label}</figcaption></figure>
          </div>
        )}
      </div>
    </section>
  );
}
