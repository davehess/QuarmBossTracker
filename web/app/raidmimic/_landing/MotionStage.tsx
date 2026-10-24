'use client';
// `?v=motion` on raidmimic: the "coming to life" hero (the guild lead, 2026-10-24: a story, then the captures in a strip below it;
// before that, 2026-10-23: "clean smooth animation. not jumpy, not stretched. Something that can scale on both mobile and desktop").
//
//   - ON TOP: the video, alone and big, always 16:9 (phones get the same picture at full width). It is a story of about 35 s: a
//     chest on a desk comes alive, howls, and the real overlays end up on its monitor. It plays ONCE. When it ends the file is
//     swapped for a short loop (the last six seconds, the mimic rocking proudly from corner to corner). The loop file starts and
//     ends on the same frame, so `loop` on it has no seam. A small "Watch again" button, in a corner of the stage, replays the story.
//     The story carries sound effects (the guild lead, 2026-10-24: "generate it with sound effects"); it autoplays muted, as
//     browsers require, and a "Sound on" button in the other corner unmutes it.
//   - Two widths of each file. The <source media> list picks the story's width; when it ends the same media query (matchMedia)
//     picks the loop's width, so a phone never fetches the 1920 file. The box around the video is 16:9 (`.rm-stage-box` in
//     globals.css), so object-fit: cover has nothing to crop and nothing is stretched.
//   - BELOW: the "Strip" (the guild lead's pick on the Decision Desk): the four real overlay captures as ordinary images that
//     link to the full-size file, each with its name and a one-line description. Four across on a wide screen, two by two on a
//     phone. Never baked into the video, which would have its text rewritten.
//   - The video is decoration (aria-hidden, no text in it); the captures carry their alt text.
//   - prefers-reduced-motion: the video is hidden and its sources dropped, so the poster (the story's last frame) stays up and
//     nothing is downloaded. The strip is the same. Off-screen and in a hidden tab: the video is paused.
import { useEffect, useRef, useState } from 'react';
import { SHOTS, SHOTS_DIR, type Shot } from '@/lib/raidmimicLanding';

const DIR = '/raidmimic/motion';

/** The story's files, with the media condition that picks each (first match wins, in this order). The sizes are the file's own. */
const MOTION_FILES = [
  { src: `${DIR}/story-1920.mp4`, w: 1920, h: 1080, media: '(min-width: 900px) and (min-resolution: 1.5dppx)' },
  { src: `${DIR}/story-1280.mp4`, w: 1280, h: 720,  media: '' },
] as const;
/** The loop that takes over when the story ends: the same two widths, chosen with the same query. */
const LOOP_FILES = { wide: `${DIR}/loop-1920.mp4`, plain: `${DIR}/loop-1280.mp4` } as const;
const STORY_FILES = { wide: MOTION_FILES[0].src, plain: MOTION_FILES[1].src } as const;
const WIDE_QUERY = MOTION_FILES[0].media;
const POSTER = { src: `${DIR}/story-poster.jpg`, w: 1280, h: 720 } as const;

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

export default function MotionStage() {
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
    <section aria-label="The mimic, and the overlays it shows" data-motion-stage
      className="rm-stage relative mb-8 overflow-hidden rounded-lg border border-border" style={{ backgroundColor: '#0f1219' }}>
      <div ref={box} className="rm-stage-box relative mx-auto">
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

      <ul className="m-0 grid list-none grid-cols-2 gap-4 p-4 lg:grid-cols-4">
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
