'use client';

// /shortabout's centerpiece: the four pieces of the platform spin out from the
// central Wolf Pack circle as you scroll (Hitya 2026-08-09).
//
// Mechanics: the diagram is position:sticky inside a tall section; four
// invisible sentinels are spaced down that section, and an IntersectionObserver
// counts how many have crossed the viewport. Node i renders "deployed" once
// i < count — from the center (scale 0, rotated) out to its compass position.
// Scrolling back UP retracts them, which makes the mechanism legible: you can
// scrub the animation with your thumb.
//
// prefers-reduced-motion (or no IO) deploys everything immediately — the
// content is the four nodes, not the choreography.

import { useEffect, useRef, useState } from 'react';

type Node = { icon: string; name: string; sub: string; home: string; color: string };

const NODES: Node[] = [
  { icon: '🤖', name: 'The Bot',       sub: 'timers · DKP · Discord',   home: 'lives on Railway',   color: '#d29922' },
  { icon: '🖥️', name: 'Mimic',         sub: 'overlays on the game',     home: 'lives on your screen', color: '#a371f7' },
  { icon: '🌐', name: 'wolfpack.quest', sub: 'the website',             home: 'lives on Vercel',    color: '#58a6ff' },
  { icon: '📜', name: 'The Agent',     sub: 'reads your combat log',    home: 'lives on your PC',   color: '#56d364' },
];

// Compass positions (top, right, bottom, left) as percentage offsets from the
// center of the square stage.
const POS = [
  { x: 0, y: -1 },
  { x: 1, y: 0 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
];

export default function PlatformSpin() {
  const [count, setCount] = useState(0);
  const [reduced, setReduced] = useState(false);
  const sentinels = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(mq.matches);
    if (mq.matches || typeof IntersectionObserver === 'undefined') { setCount(NODES.length); return; }
    const states = new Array(NODES.length).fill(false);
    const io = new IntersectionObserver(entries => {
      for (const e of entries) {
        const idx = Number((e.target as HTMLElement).dataset.idx);
        states[idx] = e.isIntersecting || e.boundingClientRect.top < 0;
      }
      // Count is the highest sentinel reached, so scrolling back retracts.
      let n = 0;
      for (let i = 0; i < states.length; i++) if (states[i]) n = i + 1;
      setCount(n);
    }, { rootMargin: '0px 0px -35% 0px' });
    sentinels.current.forEach(el => el && io.observe(el));
    return () => io.disconnect();
  }, []);

  const shown = reduced ? NODES.length : count;

  return (
    <div className="relative" style={{ height: reduced ? 'auto' : '280vh' }}>
      <div className={reduced ? '' : 'sticky top-14 sm:top-20'}>
        <div className="relative mx-auto aspect-square w-[min(88vw,380px)]">

          {/* Connector spokes — drawn under the nodes, one per deployed node. */}
          {NODES.map((n, i) => (
            <div key={'spoke' + i}
                 className="absolute left-1/2 top-1/2 origin-left h-px transition-all duration-700"
                 style={{
                   width: '34%',
                   background: `linear-gradient(to right, ${n.color}66, ${n.color})`,
                   transform: `rotate(${-90 + i * 90}deg) scaleX(${i < shown ? 1 : 0})`,
                 }} />
          ))}

          {/* Center — the platform itself. */}
          <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10
                          w-[34%] aspect-square rounded-full border-2 border-gold bg-panel
                          flex flex-col items-center justify-center text-center shadow-[0_0_30px_rgba(210,153,34,0.25)]">
            <div className="text-2xl" aria-hidden>🐺</div>
            <div className="text-[10px] sm:text-[11px] font-bold text-text leading-tight px-1">Wolf Pack<br />Platform</div>
          </div>

          {/* The four pieces, spinning out to their compass points. */}
          {NODES.map((n, i) => {
            const deployed = i < shown;
            const { x, y } = POS[i];
            return (
              <div key={n.name}
                   className="absolute left-1/2 top-1/2 z-20 w-[42%] transition-all duration-700 ease-out"
                   style={deployed
                     // Offsets are % of the NODE's own width (42% of the stage),
                     // so ±125% of self ≈ ±52% of the stage — clear of the hub.
                     ? { transform: `translate(calc(-50% + ${x * 125}%), calc(-50% + ${y * 125}%)) rotate(0deg) scale(1)`, opacity: 1 }
                     : { transform: 'translate(-50%, -50%) rotate(-180deg) scale(0.1)', opacity: 0 }}>
                <div className="rounded-lg border bg-bg/90 px-2 py-1.5 text-center"
                     style={{ borderColor: n.color }}>
                  <div className="text-base leading-none" aria-hidden>{n.icon}</div>
                  <div className="text-[11px] font-bold text-text mt-0.5">{n.name}</div>
                  <div className="text-[9px] text-dim leading-tight">{n.sub}</div>
                  <div className="text-[9px] font-semibold mt-0.5" style={{ color: n.color }}>{n.home}</div>
                </div>
              </div>
            );
          })}
        </div>

        {!reduced && shown < NODES.length && (
          <div className="text-center text-[11px] text-dim mt-4 animate-pulse">keep scrolling ↓</div>
        )}
      </div>

      {/* Scroll sentinels — invisible; each one deploys the next node. */}
      {!reduced && NODES.map((_, i) => (
        <div key={'s' + i} ref={el => { sentinels.current[i] = el; }} data-idx={i}
             className="absolute w-px h-px" style={{ top: `${18 + i * 20}%` }} />
      ))}
    </div>
  );
}
