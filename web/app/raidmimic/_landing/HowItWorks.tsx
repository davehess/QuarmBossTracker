'use client';
// "How it works": the four-step isometric scene, shipped as ONE static file (web/public/raidmimic/how/scene.html, drawn with
// ISO-GLOW, MIT) and shown in a frame. A frame, not a port: the drawing is ~700 lines of its own script and styles that
// would otherwise have to live inside this page's React tree, and an iframe keeps both sides from touching the other.
//
// The frame is lazy (nothing loads until it is near the screen) and sized by the drawing itself: the file posts its own
// height to this window (same origin only) and the frame takes it, so there is no scrolling inside it for a phone's thumb
// to get caught in. Until that first message the frame holds a 4:5 box on a phone and 4:3 from sm up. If the script never
// runs, the link under it opens the same drawing on a page of its own.
import { useEffect, useRef, useState } from 'react';
import { HOW } from '@/lib/raidmimicPlayer';

export default function HowItWorks() {
  const frame = useRef<HTMLIFrameElement>(null);
  const [height, setHeight] = useState<number | null>(null);

  useEffect(() => {
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== window.location.origin || e.source !== frame.current?.contentWindow) return;
      const d = e.data as { rmScene?: string; h?: unknown } | null;
      if (d && d.rmScene === 'height' && typeof d.h === 'number' && d.h > 100 && d.h < 4000) setHeight(Math.ceil(d.h));
    };
    window.addEventListener('message', onMessage);
    return () => window.removeEventListener('message', onMessage);
  }, []);

  return (
    <div>
      <iframe
        ref={frame}
        src={HOW.src}
        title={HOW.frameTitle}
        loading="lazy"
        scrolling="no"
        className={`block w-full rounded-md border border-border bg-bg ${height ? '' : 'aspect-[4/5] sm:aspect-[4/3]'}`}
        style={height ? { height } : undefined}
      />
      <p className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs leading-5 text-dim">
        <span>{HOW.note}</span>
        <a href={HOW.src} className="inline-flex min-h-11 items-center">{HOW.openLink} →</a>
      </p>
    </div>
  );
}
