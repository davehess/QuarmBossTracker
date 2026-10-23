'use client';
// `?v=motion` on raidmimic: the "Layered" hero (the guild lead, 2026-10-23: "clean smooth animation. not jumpy, not stretched.
// Something that can scale on both mobile and desktop. Use our assets for the overlays and the 3d mimic").
//
//   - BEHIND: the 3D mimic, a looping video. The loop is a ping-pong (forward, then the same frames reversed, no frame
//     interpolation and no speed ramp), so there is no jump at the seam. Two aspects are shipped, 16:9 and 9:16, and each is
//     offered in a lighter width. The <source media> lists pick the file; the box around the video takes the SAME aspect from
//     the SAME media query (`.rm-stage-box` in globals.css), so object-fit: cover never has anything to crop and nothing is
//     ever stretched. A portrait window shows the 9:16 file in a 9:16 box, a landscape one the 16:9 file in a 16:9 box.
//   - ON TOP: the real overlay captures as ordinary images (never baked into the video, which would have its text rewritten).
//     Four beside the mimic on a wide screen, two above and below it on a phone, none over its face. They drift a few pixels
//     up and down (transform only, 7 to 10 s a cycle, each out of step with the next).
//   - The video is decoration (aria-hidden, no text in it); the captures carry their alt text.
//   - prefers-reduced-motion: the video is hidden and its sources dropped, so the poster stays up and nothing is downloaded,
//     and the drift is off. Off-screen: an IntersectionObserver pauses the video. A rotation re-picks the file.
import { useEffect, useRef } from 'react';
import { SHOTS, SHOTS_DIR, type Shot } from '@/lib/raidmimicLanding';

const DIR = '/raidmimic/motion';

/** Every file, with the media condition that picks it (first match wins, in this order). The sizes are the file's own. */
const MOTION_FILES = [
  { src: `${DIR}/mimic-9x16-720.mp4`,  w: 720,  h: 1280, media: '(orientation: portrait) and (max-width: 480px) and (max-resolution: 2dppx)' },
  { src: `${DIR}/mimic-9x16-1080.mp4`, w: 1080, h: 1920, media: '(orientation: portrait)' },
  { src: `${DIR}/mimic-16x9-1920.mp4`, w: 1920, h: 1080, media: '(min-width: 900px) and (min-resolution: 1.5dppx)' },
  { src: `${DIR}/mimic-16x9-1280.mp4`, w: 1280, h: 720,  media: '' },
] as const;
const MOTION_POSTERS = {
  portrait: { src: `${DIR}/mimic-9x16-poster.jpg`, w: 720, h: 1280 },
  landscape: { src: `${DIR}/mimic-16x9-poster.jpg`, w: 1280, h: 720 },
} as const;

// A capture floats at l / t (percent of the stage) and w (percent of its width). `d` = seconds a drift cycle takes, `o` =
// where in the cycle it starts (so no two move together). A wide screen carries four; a phone carries two, one above the
// mimic and one below it (the 9:16 frame leaves the top fifth and the bottom third empty).
type Card = { id: string; l: number; t: number; w: number; edge: string; d: number; o: number };
const WIDE: Card[] = [
  { id: 'hud-box',        l: 1.5,  t: 6,  w: 21, edge: '#56d364', d: 8.5, o: 0 },
  { id: 'dps-raid',       l: 1.5,  t: 72, w: 25, edge: '#58a6ff', d: 9.5, o: -4 },
  { id: 'target-debuffs', l: 74.5, t: 6,  w: 24, edge: '#f85149', d: 7.5, o: -2.5 },
  { id: 'ch-chain',       l: 78,   t: 56, w: 20, edge: '#d29922', d: 10,  o: -6.5 },
];
const PHONE: Card[] = [
  { id: 'target-debuffs', l: 4,  t: 3,    w: 56, edge: '#f85149', d: 7.5, o: 0 },
  { id: 'ch-chain',       l: 44, t: 74.5, w: 52, edge: '#d29922', d: 10,  o: -3 },
];

const shotById = (id: string): Shot => {
  const s = SHOTS.find(x => x.id === id);
  if (!s) throw new Error(`raidmimic: no capture "${id}"`);
  return s;
};

function Capture({ c, s }: { c: Card; s: Shot }) {
  const src = `${SHOTS_DIR}/${s.file}`;
  return (
    <a href={src} target="_blank" rel="noreferrer" aria-label={`${s.title}: open the full-size capture`}
      className="block overflow-hidden rounded-md border border-border border-t-[3px] bg-bg shadow-lg shadow-black/50 hover:no-underline"
      style={{ borderTopColor: c.edge }}>
      <img src={src} width={s.w} height={s.h} alt={s.alt} decoding="async" loading="lazy" className="block h-auto w-full" />
    </a>
  );
}

function Cards({ cards, className }: { cards: Card[]; className: string }) {
  return (
    <ul className={`m-0 list-none p-0 ${className}`}>
      {cards.map(c => (
        <li key={c.id} className="absolute" style={{ left: `${c.l}%`, top: `${c.t}%`, width: `${c.w}%` }}>
          <div className="rm-drift" style={{ '--dur': `${c.d}s`, '--off': `${c.o}s` } as React.CSSProperties}>
            <Capture c={c} s={shotById(c.id)} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function MotionStage() {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);

  useEffect(() => {
    const v = vid.current;
    const el = box.current;
    if (!v || !el) return;
    let visible = true;
    try {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
      const portrait = window.matchMedia('(orientation: portrait)');
      v.muted = true;
      const sync = () => {
        if (reduce.matches || !visible || document.hidden) v.pause();
        else void v.play().catch(() => { /* autoplay refused (data saver, low power): the poster stays up */ });
      };
      if (reduce.matches) {
        // Nothing to play: drop the sources so no file is fetched, and the CSS shows the poster.
        v.pause();
        v.querySelectorAll('source').forEach(s => s.remove());
        v.load();
        return;
      }
      sync();
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.05 });
      io.observe(el);
      const onVis = () => sync();
      document.addEventListener('visibilitychange', onVis);
      // <source media> is read once; a rotation has to ask the element to choose again (the box flips its aspect by CSS).
      const onTurn = () => { v.load(); sync(); };
      portrait.addEventListener('change', onTurn);
      const onReduce = () => sync();
      reduce.addEventListener('change', onReduce);
      return () => {
        io.disconnect();
        document.removeEventListener('visibilitychange', onVis);
        portrait.removeEventListener('change', onTurn);
        reduce.removeEventListener('change', onReduce);
      };
    } catch { /* an old browser: the attributes and the poster still do the job */ }
  }, []);

  return (
    <section aria-label="The mimic, and the overlays it shows" data-motion-stage
      className="rm-stage relative mb-8 overflow-hidden rounded-lg border border-border" style={{ backgroundColor: '#0f1219' }}>
      <div ref={box} className="rm-stage-box relative mx-auto">
        {/* The poster layer: the first frame, in the box's aspect. The video above has no poster of its own (one attribute
            cannot follow a media query) and is transparent until its first frame, so this shows through. */}
        <picture>
          <source media="(orientation: portrait)" srcSet={MOTION_POSTERS.portrait.src} width={MOTION_POSTERS.portrait.w} height={MOTION_POSTERS.portrait.h} />
          <img src={MOTION_POSTERS.landscape.src} width={MOTION_POSTERS.landscape.w} height={MOTION_POSTERS.landscape.h} alt="" aria-hidden="true"
            decoding="async" className="absolute inset-0 h-full w-full object-cover" />
        </picture>
        <video ref={vid} autoPlay muted loop playsInline preload="metadata" aria-hidden="true" tabIndex={-1}
          className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden">
          {MOTION_FILES.map(f => <source key={f.src} src={f.src} type="video/mp4" {...(f.media ? { media: f.media } : {})} />)}
        </video>

        {/* Wide: four captures beside the mimic. Portrait: two, above and below it. (The hidden list is display: none, so its
            images are lazy and never fetched.) */}
        <Cards cards={WIDE} className="hidden landscape:block" />
        <Cards cards={PHONE} className="hidden portrait:block" />
      </div>
    </section>
  );
}
