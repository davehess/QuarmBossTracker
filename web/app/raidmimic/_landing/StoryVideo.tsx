'use client';
// The story video of the raidmimic landing's story stage. It plays the story files once, muted, and tells its parent two things:
// the time (one `timeupdate` listener) and the end.
//
// CAPTIONS, and why the old ones were cut off (the guild lead, 2026-11-01: "some of the closed captions are cut off"):
// MotionStage lets the browser draw story.vtt's cues. Every cue says `line:78% size:86%`, which pins the cue's FIRST line at 78%
// of the picture's height and lets the rest grow DOWNWARD. In the 9:16 box a long cue ("RAID LEADER: Is this one even slowed?
// We're losing healers!") wraps to three or four lines, the last of which falls past the bottom edge, where the box's
// `overflow-hidden` cuts it; the Sound button then sits over whatever is left. (Read from the cue settings and the CSS; not
// reproduced in a browser from this session.) Here the track runs 'hidden' (the cues still load and fire `cuechange`, the
// browser draws nothing) and the active cue text is drawn by this component in a box anchored by its BOTTOM edge, above the
// buttons, with a backing, wrapping balanced onto as many lines as it needs and growing UPWARD: it cannot leave the picture.
import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react';
import { STORY_WORDS as W } from '@/lib/raidmimicStory';

const DIR = '/raidmimic/motion';
// Three files by screen (the square one on a wide landscape screen: the SAME query as `.rm-frame` in globals.css).
const SQUARE_QUERY = '(min-width: 1024px) and (orientation: landscape)';
const FILES = [
  { src: `${DIR}/story-sq-1080.mp4`, media: SQUARE_QUERY },
  { src: `${DIR}/story-1080.mp4`, media: '(min-width: 600px) and (min-resolution: 1.5dppx), (min-width: 561px) and (max-width: 639px)' },
  { src: `${DIR}/story-720.mp4`, media: '' },
] as const;
const CAPTIONS = `${DIR}/story.vtt`;
const FIRST = { portrait: `${DIR}/story-first-poster.jpg`, square: `${DIR}/story-first-sq-poster.jpg` } as const;   // frame 0: the chest
const LAST = { portrait: `${DIR}/story-poster.jpg`, square: `${DIR}/story-sq-poster.jpg` } as const;             // the last frame, for reduced motion

export interface StoryVideoHandle { seek(t: number): void; replay(): void }

/** True while the visitor asks for reduced motion (false until the page has mounted). */
export function useReducedMotion(): boolean {
  const [r, setR] = useState(false);
  useEffect(() => {
    try {
      const q = window.matchMedia('(prefers-reduced-motion: reduce)');
      setR(q.matches);
      const on = () => setR(q.matches);
      q.addEventListener('change', on);
      return () => q.removeEventListener('change', on);
    } catch { /* an old browser: motion stays on */ }
  }, []);
  return r;
}

interface Props {
  onTime: (t: number) => void;
  onEnd: () => void;
  /** The parent wants the picture still (skipped, or finished). */
  halted: boolean;
  reduced: boolean;
  /** Tailwind object-fit classes for the video and its poster. */
  fit: string;
  /** Distance of the caption box from the bottom edge, as a Tailwind class (it must clear the buttons). */
  captionBottom?: string;
  /** Extra buttons for the bottom row (Skip, Hide). */
  children?: ReactNode;
}

/** The quiet text buttons of the bottom row (still a 44px tap target). */
export const QUIET_BTN = 'min-h-11 rounded-md bg-transparent px-3 text-xs text-[#f2ede1]/70 hover:bg-white/10 hover:text-[#f2ede1] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold';

const BTN = 'min-h-11 rounded-md border border-border bg-black/70 px-3 text-xs text-[#f2ede1] hover:bg-black/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:text-sm';

const StoryVideo = forwardRef<StoryVideoHandle, Props>(function StoryVideo(
  { onTime, onEnd, halted, reduced, fit, captionBottom = 'bottom-14 sm:bottom-16', children }, ref,
) {
  const vid = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const [stalled, setStalled] = useState(false);
  const [sound, setSound] = useState(false);
  const [cc, setCc] = useState(true);
  const [caption, setCaption] = useState('');
  const cb = useRef({ onTime, onEnd });
  cb.current = { onTime, onEnd };
  const hold = useRef(false);
  hold.current = halted || reduced;
  const visible = useRef(true);
  const sync = useRef<() => void>(() => {});

  useImperativeHandle(ref, () => ({
    seek(t) { const v = vid.current; if (v) { v.currentTime = t; void v.play().catch(() => setStalled(true)); } },
    replay() { const v = vid.current; if (v) { v.currentTime = 0; void v.play().catch(() => setStalled(true)); } },
  }), []);

  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    v.muted = true;
    const track = v.textTracks[0];
    if (track) track.mode = 'hidden';
    const onCue = () => {
      const cues = track?.activeCues;
      setCaption(cues ? Array.from(cues, c => (c as VTTCue).text).join('\n') : '');
    };
    track?.addEventListener('cuechange', onCue);
    const onTimeUpdate = () => cb.current.onTime(v.currentTime);
    const onEnded = () => cb.current.onEnd();   // the last frame stays up; the poster does not come back
    const onPlaying = () => { setPlaying(true); setStalled(false); };
    v.addEventListener('timeupdate', onTimeUpdate);
    v.addEventListener('ended', onEnded);
    v.addEventListener('playing', onPlaying);
    sync.current = () => {
      if (hold.current || !visible.current || document.hidden) v.pause();
      else if (v.paused && !v.ended) void v.play().catch(() => setStalled(true));   // autoplay refused: a Play button appears
    };
    const io = new IntersectionObserver(([e]) => { visible.current = e.isIntersecting; sync.current(); }, { threshold: 0.05 });
    io.observe(v);
    const onVis = () => sync.current();
    document.addEventListener('visibilitychange', onVis);
    return () => {
      track?.removeEventListener('cuechange', onCue);
      v.removeEventListener('timeupdate', onTimeUpdate);
      v.removeEventListener('ended', onEnded);
      v.removeEventListener('playing', onPlaying);
      document.removeEventListener('visibilitychange', onVis);
      io.disconnect();
    };
  }, []);

  // Skipped / finished / reduced motion: hold still. Reduced motion also drops the sources so nothing is downloaded.
  useEffect(() => {
    const v = vid.current;
    if (!v) return;
    if (reduced) {
      v.pause();
      v.querySelectorAll('source').forEach(s => s.remove());
      v.load();
      return;
    }
    sync.current();
  }, [halted, reduced]);

  const toggleSound = () => {
    const v = vid.current;
    if (!v) return;
    v.muted = sound;
    setSound(!sound);
    setCc(sound);                       // sound on hides the captions, like the default page; the CC button brings them back
    if (!sound) void v.play().catch(() => {});
  };

  const first = reduced ? LAST : FIRST;
  return (
    <>
      {/* The poster layer: frame 0 (the chest) until the video is playing; under reduced motion the story's last frame, for good. */}
      {/* Picture and poster live in the faded frame (.rm-frame in globals.css); the captions and buttons below do not, so the
          mask never touches them. */}
      <div data-story-frame className="rm-frame">
        {(!playing || reduced) && (   // `playing` means "has started" and never goes back
          <picture>
            <source media={SQUARE_QUERY} srcSet={first.square} />
            <img src={first.portrait} alt="" aria-hidden="true" decoding="async" className={`absolute inset-0 h-full w-full ${fit}`} />
          </picture>
        )}
        <video ref={vid} autoPlay muted playsInline preload="auto" aria-hidden="true" tabIndex={-1}
          className={`absolute inset-0 h-full w-full ${fit} motion-reduce:hidden`}>
          {FILES.map(f => <source key={f.src} src={f.src} type="video/mp4" {...(f.media ? { media: f.media } : {})} />)}
          <track kind="captions" srcLang="en" label="English" src={CAPTIONS} />
        </video>
      </div>

      {cc && caption && !reduced && (
        <div data-story-caption className={`pointer-events-none absolute inset-x-0 z-10 flex justify-center px-3 ${captionBottom}`}>
          <p className="m-0 max-w-[min(36rem,94%)] whitespace-pre-line rounded-md bg-black/80 px-3 py-1.5 text-center text-sm leading-snug text-[#f2ede1] [overflow-wrap:anywhere] [text-wrap:balance] sm:text-base">
            {caption}
          </p>
        </div>
      )}

      {stalled && !reduced && (
        <button type="button" onClick={() => { void vid.current?.play(); }}
          className={`${BTN} absolute left-1/2 top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 px-5`}>
          Play the story
        </button>
      )}

      {/* The bottom row: small and quiet (the guild lead, 2026-11-01: "Skip/hide at the bottom"). Sound and CC here; the stage's
          own Skip and Hide arrive as `children`. */}
      <div data-story-controls className="absolute inset-x-0 bottom-0 z-20 flex flex-wrap items-center justify-center gap-x-1 p-1 sm:p-2">
        <span className="contents motion-reduce:hidden">
          <button type="button" onClick={toggleSound} aria-pressed={sound} className={QUIET_BTN}>{sound ? W.soundOff : W.soundOn}</button>
          <button type="button" onClick={() => setCc(!cc)} aria-pressed={cc} className={QUIET_BTN}>CC</button>
        </span>
        {children}
      </div>
    </>
  );
});
export default StoryVideo;
