// Version C, "Two doors": one headline, then two side-by-side panels, one for the person who raids and one for the person who
// runs a guild. Each has one real capture, one button and one quieter next step. The story video sits under them.
import type { HeroCopy, HeroLinks, HeroMedia } from '@/lib/lab/fixtures/rm-first-screen';
import { Btn, H1, LEAD, Lockup } from './parts';

const FRAME = 'block w-full rounded-md border border-border bg-panel object-contain';
const LINK = 'inline-flex min-h-11 items-center text-sm text-blue underline';

export default function HeroC({ copy, links, media }: { copy: HeroCopy; links: HeroLinks; media: HeroMedia }) {
  return (
    <section id="top" aria-label="Raid Mimic" data-hero="c" className="mx-auto max-w-5xl px-1 pb-10 pt-4 sm:pt-6">
      <Lockup />
      <h1 className={`${H1} mt-6 max-w-[26ch]`}>{copy.headline}</h1>
      <p className={LEAD}>{copy.sentence}</p>
      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="rm-door-raid" className="flex flex-col rounded-md border border-border bg-panel p-4">
          <h2 id="rm-door-raid" className="m-0 text-xl text-text">{copy.raidTitle}</h2>
          <img src={media.dps.src} alt={media.dps.alt} width={media.dps.w} height={media.dps.h} loading="eager" className={`${FRAME} mt-3 h-auto`} />
          <p className="m-0 mt-3 text-sm leading-6 text-text">{copy.raidLine}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4">
            <Btn gold href={links.download}>{copy.download}</Btn>
            <a href={links.setup} className={LINK}>{copy.setup}</a>
          </div>
        </section>
        <section aria-labelledby="rm-door-guild" className="flex flex-col rounded-md border border-border bg-panel p-4">
          <h2 id="rm-door-guild" className="m-0 text-xl text-text">{copy.guildTitle}</h2>
          <img src={media.cc.src} alt={media.cc.alt} width={media.cc.w} height={media.cc.h} loading="eager" className={`${FRAME} mt-3 h-64`} />
          <p className="m-0 mt-3 text-sm leading-6 text-text">{copy.guildLine}</p>
          <div className="mt-auto flex flex-wrap items-center gap-x-4 gap-y-1 pt-4">
            <Btn href={links.demo}>{copy.demoShort}</Btn>
            <a href={links.register} className={LINK}>{copy.register}</a>
          </div>
        </section>
      </div>
      <figure className="mx-auto mt-10 max-w-md">
        <h2 className="m-0 mb-2 text-lg text-text">{copy.storyTitle}</h2>
        <div className="relative aspect-square overflow-hidden rounded-md border border-border bg-panel">
          <video controls playsInline preload="none" poster={media.video.poster} className="absolute inset-0 h-full w-full object-contain">
            <source src={media.video.src} type="video/mp4" />
            <track kind="captions" srcLang="en" label="English" src={media.video.captions} />
          </video>
        </div>
        <figcaption className="mt-2 text-xs text-dim">{copy.aiLabel}</figcaption>
      </figure>
    </section>
  );
}
