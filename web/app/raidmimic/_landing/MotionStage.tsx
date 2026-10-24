'use client';
// `?v=motion` on raidmimic: the "coming to life" hero (the guild lead, 2026-10-24: a story, then the captures in a strip below it;
// before that, 2026-10-23: "clean smooth animation. not jumpy, not stretched. Something that can scale on both mobile and desktop").
// The story went VERTICAL the same day (the guild lead, 2026-10-24: "vertical is great for both mobile and desktop").
//
//   - THE VIDEO: always 9:16. It is a story of about 35 s: a chest on a desk comes alive, howls, and the real overlays end up on
//     its monitor. It plays ONCE. When it ends the file is swapped for a short loop (the last six seconds, the mimic rocking
//     proudly from corner to corner). The loop file starts and ends on the same frame, so `loop` on it has no seam. A small
//     "Watch again" button, in a corner of the stage, replays the story.
//     The story carries sound effects (the guild lead, 2026-10-24: "generate it with sound effects"); it autoplays muted, as
//     browsers require, and a "Sound on" button in the other corner unmutes it.
//   - LAYOUT, from the brand kit's rule "wide formats with room for a headline on the left". On a desktop (lg and up) the page's
//     own headline (passed in as children, with its download button) sits on the LEFT and the video on the right, in a box that
//     is never taller than min(78svh, 820px), so a tall picture does not tower. On a phone the headline is above, as before, and
//     the video is full width.
//   - Two sizes of each file. The <source media> list picks the story's size; when it ends the same media query (matchMedia)
//     picks the loop's size, so a plain phone never fetches the 1080 file. The box around the video is 9:16 (`.rm-stage-box` in
//     globals.css), so object-fit: cover has nothing to crop and nothing is stretched.
//   - BELOW the whole thing: the "Strip" (the guild lead's pick on the Decision Desk): the four real overlay captures as ordinary
//     images that link to the full-size file, each with its name and a one-line description. Four across on a wide screen, two by
//     two on a phone. Never baked into the video, which would have its text rewritten.
//   - The video is decoration (aria-hidden, no text in it); the captures carry their alt text.
//   - prefers-reduced-motion: the video is hidden and its sources dropped, so the poster (the story's last frame) stays up and
//     nothing is downloaded. The strip is the same. Off-screen and in a hidden tab: the video is paused.
import { useEffect, useRef, useState, type ReactNode } from 'react';
import { SHOTS, SHOTS_DIR, type Shot } from '@/lib/raidmimicLanding';

const DIR = '/raidmimic/motion';

/** The story's files, with the media condition that picks each (first match wins, in this order). The sizes are the file's own.
 *  The 1080 file is for a sharp screen at least 600 px wide, or a box wider than 560 px (a big phone or small tablet at 1x); the
 *  box is never wider than the viewport, and from 640 px up it is capped, so that second clause only needs to span 561-639. */
const MOTION_FILES = [
  { src: `${DIR}/story-1080.mp4`, w: 1080, h: 1920, media: '(min-width: 600px) and (min-resolution: 1.5dppx), (min-width: 561px) and (max-width: 639px)' },
  { src: `${DIR}/story-720.mp4`,  w: 720,  h: 1280, media: '' },
] as const;
/** The loop that takes over when the story ends: the same two sizes, chosen with the same query. */
const LOOP_FILES = { wide: `${DIR}/loop-1080.mp4`, plain: `${DIR}/loop-720.mp4` } as const;
const STORY_FILES = { wide: MOTION_FILES[0].src, plain: MOTION_FILES[1].src } as const;
const WIDE_QUERY = MOTION_FILES[0].media;
const POSTER = { src: `${DIR}/story-poster.jpg`, w: 720, h: 1280 } as const;
const STAGE_BG = '#0f1219';

// The strip: four captures, each with a one-line description of its own (the gallery's longer sentences do not fit four across).
type Card = { id: string; edge: string; line: string };
const STRIP: Card[] = [
  { id: 'hud-box',        edge: '#56d364', line: 'Your health, mana, song and group in one panel.' },
  { id: 'dps-raid',       edge: '#58a6ff', line: 'Who is doing the damage, ranked, for the whole raid.' },
  { id: 'target-debuffs', edge: '#f85149', line: 'Every debuff on the boss, with the time it has left.' },
  { id: 'ch-chain',       edge: '#d29922', line: 'The heal rotation, and a warning when one is late.' },
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
      className="block overflow-hidden rounded-md border border-border border-t-[3px] bg-bg hover:no-underline"
      style={{ borderTopColor: c.edge }}>
      <div className="aspect-[4/3] w-full">
        <img src={src} width={s.w} height={s.h} alt={s.alt} decoding="async" loading="lazy" className="block h-full w-full object-contain" />
      </div>
    </a>
  );
}

/** `children` is the page's headline block; it sits left of the video on a desktop and above it on a phone. */
export default function MotionStage({ children }: { children?: ReactNode }) {
  const box = useRef<HTMLDivElement>(null);
  const vid = useRef<HTMLVideoElement>(null);
  const [ended, setEnded] = useState(false);
  const [sound, setSound] = useState(false);
  const replay = useRef<() => void>(() => {});
  // Autoplay is only allowed muted; the sound effects play once someone presses Sound on (a click is the permission).
  const toggleSound = () => {
    const v = vid.current;
    if (!v) return;
    v.muted = sound;
    setSound(!sound);
    if (!sound) void v.play().catch(() => {});
  };

  useEffect(() => {
    const v = vid.current;
    const el = box.current;
    if (!v || !el) return;
    let visible = true;
    try {
      const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
      const wide = window.matchMedia(WIDE_QUERY);
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
      // The story is over: the same media query picks the loop's width, and `loop` makes it seamless.
      const onEnded = () => {
        if (v.loop) return;
        v.loop = true;
        v.src = wide.matches ? LOOP_FILES.wide : LOOP_FILES.plain;
        setEnded(true);
        sync();
      };
      v.addEventListener('ended', onEnded);
      replay.current = () => {
        v.loop = false;
        v.src = wide.matches ? STORY_FILES.wide : STORY_FILES.plain;
        setEnded(false);
        sync();
      };
      sync();
      const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; sync(); }, { threshold: 0.05 });
      io.observe(el);
      const onVis = () => sync();
      document.addEventListener('visibilitychange', onVis);
      const onReduce = () => sync();
      reduce.addEventListener('change', onReduce);
      return () => {
        io.disconnect();
        v.removeEventListener('ended', onEnded);
        document.removeEventListener('visibilitychange', onVis);
        reduce.removeEventListener('change', onReduce);
      };
    } catch { /* an old browser: the attributes and the poster still do the job */ }
  }, []);

  return (
    <section aria-label="The mimic, and the overlays it shows" data-motion-stage className="rm-stage mb-8">
      {/* Phone: the headline, then the video, stacked. Desktop: the headline on the left, the video on the right. The video's
          column is exactly as wide as a 9:16 box of the capped height, so the box never needs a max-height of its own. */}
      <div className="lg:grid lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-10">
        {children}
        <div className="mx-auto w-full [--rm-w:calc(min(78svh,820px)*9/16)] sm:max-w-[var(--rm-w)] lg:w-[var(--rm-w)]">
          <div className="overflow-hidden rounded-lg border border-border" style={{ backgroundColor: STAGE_BG }}>
            <div ref={box} className="rm-stage-box relative">
              {/* The poster layer: the story's last frame. The video above has no poster of its own and is transparent until its
                  first frame, so this shows through (and stays, under reduced motion). */}
              <img src={POSTER.src} width={POSTER.w} height={POSTER.h} alt="" aria-hidden="true"
                decoding="async" className="absolute inset-0 h-full w-full object-cover" />
              <video ref={vid} autoPlay muted playsInline preload="metadata" aria-hidden="true" tabIndex={-1}
                className="absolute inset-0 h-full w-full object-cover motion-reduce:hidden">
                {MOTION_FILES.map(f => <source key={f.src} src={f.src} type="video/mp4" {...(f.media ? { media: f.media } : {})} />)}
              </video>
              <button type="button" onClick={toggleSound} aria-pressed={sound}
                className="absolute bottom-2 left-2 min-h-[44px] rounded-md border border-border bg-black/60 px-3 text-xs text-[#f2ede1] sm:bottom-3 sm:left-3 sm:px-4 sm:text-sm hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:hidden">
                {sound ? 'Sound off' : 'Sound on'}
              </button>
              {ended && (
                <button type="button" onClick={() => replay.current()}
                  className="absolute bottom-2 right-2 min-h-[44px] rounded-md border border-border bg-black/60 px-3 text-xs text-[#f2ede1] sm:bottom-3 sm:right-3 sm:px-4 sm:text-sm hover:bg-black/85 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:hidden">
                  Watch again
                </button>
              )}
            </div>
          </div>
        </div>
      </div>

      <ul className="m-0 mt-4 grid list-none grid-cols-2 gap-4 rounded-lg border border-border p-4 lg:grid-cols-4" style={{ backgroundColor: STAGE_BG }}>
        {STRIP.map(c => {
          const s = shotById(c.id);
          return (
            <li key={c.id} className="min-w-0">
              <Capture c={c} s={s} />
              <p className="mb-0 mt-2 text-sm font-semibold leading-5 text-[#f2ede1]">{s.title}</p>
              <p className="mb-0 mt-1 text-xs leading-5 text-text">{c.line}</p>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
