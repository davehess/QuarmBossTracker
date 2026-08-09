'use client';

// Scroll-reveal + animated counters for /about.
//
// IntersectionObserver rather than a scroll handler: the callback fires only
// when an element crosses the threshold, so scrolling a long page on a phone
// does not run JS on every frame. Each element unobserves itself once shown —
// this page is a one-way narrative, and re-animating on scroll-back is the
// thing that makes these pages feel cheap.
//
// prefers-reduced-motion is honoured by SHOWING EVERYTHING IMMEDIATELY, not by
// swapping to a subtler animation. Someone who has asked the OS for less motion
// still needs the content.

import { useEffect, useRef, useState } from 'react';

function useReducedMotion() {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    const on = () => setReduced(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return reduced;
}

function useInView<T extends HTMLElement>(rootMargin = '-12% 0px -12% 0px') {
  const ref = useRef<T | null>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const el = ref.current;
    // No IO (old browser, or SSR hydration edge) → show it. Never hide content
    // behind a capability check.
    if (!el || typeof IntersectionObserver === 'undefined') { setSeen(true); return; }
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setSeen(true); io.disconnect(); } },
      { rootMargin, threshold: 0.01 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [rootMargin]);
  return { ref, seen };
}

export function Reveal({
  children, delay = 0, from = 'up', className = '',
}: {
  children: React.ReactNode; delay?: number; from?: 'up' | 'left' | 'right' | 'scale'; className?: string;
}) {
  const reduced = useReducedMotion();
  const { ref, seen } = useInView<HTMLDivElement>();
  const show = seen || reduced;
  const hidden =
    from === 'left'  ? 'opacity-0 -translate-x-6' :
    from === 'right' ? 'opacity-0 translate-x-6'  :
    from === 'scale' ? 'opacity-0 scale-95'       :
                       'opacity-0 translate-y-6';
  return (
    <div
      ref={ref}
      style={{ transitionDelay: show && !reduced ? `${delay}ms` : undefined }}
      className={[
        'transition-all duration-700 ease-out motion-reduce:transition-none',
        show ? 'opacity-100 translate-x-0 translate-y-0 scale-100' : hidden,
        className,
      ].join(' ')}
    >
      {children}
    </div>
  );
}

// Count-up that starts when the number scrolls into view.
//
// Eased rather than linear, and driven by requestAnimationFrame off a
// timestamp — a setInterval counter drifts and stutters on a phone. Reduced
// motion (or no IO) prints the final value with no animation at all.
export function CountUp({
  to, suffix = '', prefix = '', duration = 1400, decimals = 0,
}: { to: number; suffix?: string; prefix?: string; duration?: number; decimals?: number }) {
  const reduced = useReducedMotion();
  const { ref, seen } = useInView<HTMLSpanElement>('-5% 0px -5% 0px');
  const [n, setN] = useState(0);

  useEffect(() => {
    if (!seen) return;
    if (reduced) { setN(to); return; }
    let raf = 0; let t0 = 0;
    const step = (t: number) => {
      if (!t0) t0 = t;
      const p = Math.min(1, (t - t0) / duration);
      // easeOutExpo — fast start, long settle, so big numbers feel like they
      // are landing rather than ticking.
      const e = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      setN(to * e);
      if (p < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [seen, to, duration, reduced]);

  const shown = decimals > 0
    ? n.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Math.round(n).toLocaleString();

  return <span ref={ref} className="tabular-nums">{prefix}{shown}{suffix}</span>;
}
