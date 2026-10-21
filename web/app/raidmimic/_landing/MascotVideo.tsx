'use client';
// The mascot's clip, with `prefers-reduced-motion` honoured (raidmimic hero previews `?v=b` / `?v=c`, the guild lead,
// 2026-10-21). Both the <video> and its poster <img> are in the markup and CSS (`motion-reduce:`) picks one before any
// script runs, so a reduced-motion visitor never sees the clip flash; the effect then drops the clip's source so it is
// not downloaded for nothing. Autoplay needs the muted PROPERTY, which React does not put in the server HTML.
import { useEffect, useRef } from 'react';

export default function MascotVideo({ src, poster, loop = false, alt, className = '' }: {
  src: string; poster: string; loop?: boolean; alt: string; className?: string;
}) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    try {
      if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
        v.pause();
        v.removeAttribute('src');
        v.load();
        return;
      }
      v.muted = true;
      void v.play().catch(() => { /* autoplay refused (data saver, low power): the poster stays up */ });
    } catch { /* an old browser: the poster and the attributes still do the job */ }
  }, []);
  return (
    <>
      <video ref={ref} src={src} poster={poster} width={720} height={720} autoPlay muted loop={loop} playsInline preload="auto"
        aria-hidden="true" tabIndex={-1} className={`motion-reduce:hidden ${className}`} />
      <img src={poster} width={720} height={720} alt={alt} decoding="async" className={`hidden motion-reduce:block ${className}`} />
    </>
  );
}
