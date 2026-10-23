'use client';
// One looping overlay clip (raidmimic previews `?v=d`, `?v=e`, `?v=f`, the guild lead, 2026-10-22). Same approach as
// MascotVideo: both the <video> and its poster <img> are in the markup and CSS (`motion-reduce:`) picks one before any
// script runs; the effect then pauses the clip for a reduced-motion visitor, and pauses it whenever it is off screen
// so a page of three clips does not keep three decoders busy. Size comes from the clip's w / h in the content module.
import { useEffect, useRef } from 'react';
import { CLIPS, clipSrc } from '@/lib/raidmimicLanding';

export default function SceneClip({ id, className = '' }: { id: string; className?: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const clip = CLIPS.find(c => c.id === id);
  useEffect(() => {
    const v = ref.current;
    if (!v) return;
    let still = false;
    try { still = window.matchMedia('(prefers-reduced-motion: reduce)').matches; } catch { /* the CSS swap still applies */ }
    if (still) { v.pause(); return; }
    v.muted = true;
    const play = () => { void v.play().catch(() => { /* autoplay refused (data saver, low power): the poster stays up */ }); };
    if (typeof IntersectionObserver === 'undefined') { play(); return; }
    const io = new IntersectionObserver(entries => {
      for (const e of entries) { if (e.isIntersecting) play(); else v.pause(); }
    }, { threshold: 0.15 });
    io.observe(v);
    return () => io.disconnect();
  }, [id]);
  if (!clip) return null;
  return (
    <>
      <video ref={ref} src={clipSrc(clip.id, 'video')} poster={clipSrc(clip.id, 'poster')} width={clip.w} height={clip.h}
        autoPlay muted loop playsInline preload="metadata" aria-label={clip.alt}
        className={`block h-auto w-full motion-reduce:hidden ${className}`} />
      <img src={clipSrc(clip.id, 'poster')} width={clip.w} height={clip.h} alt={clip.alt} decoding="async"
        className={`hidden h-auto w-full motion-reduce:block ${className}`} />
    </>
  );
}
