'use client';

import { useEffect, useState } from 'react';
import { BRANCHES, TINT, STATS } from './platformData';

// Shared platform-map visual + branch data. Rendered on /platform (full page
// with drill-down cards) AND on the signed-out homepage (the "what IS all of
// this?" hero for curious visitors).
// Identity is carried by label + icon + position; color is reinforcement only.
//
// ⚠ TOP-DOWN, not radial (Hitya, 2026-08-28): "Wolfpack.quest up top and all
// the other elements feeding it. vertical columns underneath and when you hover
// over them list each of the elements of that column."
//
// So `web` is no longer one branch among six — it is the ROOT, and the other
// five stand under it in pipeline order: the client you look at, the engine on
// your machine, the hub they all talk to, the store it writes to, and the
// machinery that ships it. The old version was a hand-laid 1200x780 radial SVG
// with labels sized in user units, which is why it needed a 760px floor and a
// sideways scroll on a phone. This is ordinary DOM, so it reflows instead.
//
// ⚠ Hover reveals the element list on a POINTER; on touch the list is simply
// always open. There is no hover on a phone to discover, and a tap-to-toggle
// would fight the card's own link — which is exactly the bug the nav
// disclosure took four attempts to kill. `canHover` decides, nothing else.

// anchorBase: '' on /platform (same-page anchors), '/platform' when the map is
// embedded elsewhere (homepage) so node clicks land on the full page's cards.

// The apex. Everything below feeds it; it is the only thing a member actually
// opens on a Tuesday.
const ROOT_ID = 'web';

function useCanHover() {
  const [can, setCan] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia('(hover: hover) and (pointer: fine)');
    const sync = () => setCan(mq.matches);
    sync();
    mq.addEventListener('change', sync);
    return () => mq.removeEventListener('change', sync);
  }, []);
  return can;
}

function Column({ b, anchorBase, canHover }: {
  b: (typeof BRANCHES)[number]; anchorBase: string; canHover: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const t = TINT[b.tint];
  // No hover to discover on touch, so the list is just open there.
  const open = canHover ? hovered : true;

  return (
    <a
      href={`${anchorBase}#${b.id}`}
      onMouseEnter={() => canHover && setHovered(true)}
      onMouseLeave={() => canHover && setHovered(false)}
      onFocus={() => canHover && setHovered(true)}
      onBlur={() => canHover && setHovered(false)}
      className={`group flex flex-col rounded-lg border bg-panel p-3 no-underline transition-colors
                  hover:no-underline ${t.border} ${t.glow} hover:bg-[#1b2129]`}
    >
      <span className="text-lg leading-none" aria-hidden>{b.icon}</span>
      <span className={`mt-1.5 text-sm font-semibold leading-snug ${t.text}`}>{b.title}</span>
      <span className="mt-0.5 text-[10px] leading-tight text-dim">{b.tag}</span>

      {/* 0fr → 1fr keeps the reveal inside this card. `items-start` on the grid
          means only the hovered column grows; its neighbours stay put. */}
      <span
        className="grid transition-[grid-template-rows] duration-200 ease-out"
        style={{ gridTemplateRows: open ? '1fr' : '0fr' }}
      >
        <span className="overflow-hidden">
          <span className="mt-2 block border-t border-border/60 pt-2">
            {b.details.map(([name]) => (
              <span key={name} className="block py-[3px] text-[11px] leading-tight text-text">
                {name}
              </span>
            ))}
          </span>
        </span>
      </span>
    </a>
  );
}

export function PlatformMap({ anchorBase = '' }: { anchorBase?: string }) {
  const canHover = useCanHover();
  const root = BRANCHES.find(b => b.id === ROOT_ID)!;
  const feeders = BRANCHES.filter(b => b.id !== ROOT_ID);
  const rt = TINT[root.tint];

  return (
    <div className="select-none">
      {/* The apex */}
      <div className="flex justify-center">
        <a href={`${anchorBase}#${root.id}`}
           className={`flex w-full max-w-[26rem] flex-col items-center rounded-lg border-2 bg-panel px-4 py-3
                       text-center no-underline transition-colors hover:no-underline
                       ${rt.border} ${rt.glow} hover:bg-[#1b2129]`}>
          <span className="text-2xl leading-none" aria-hidden>{root.icon}</span>
          <span className={`mt-1 text-base font-bold ${rt.text}`}>{root.title}</span>
          <span className="mt-0.5 text-[11px] text-dim">{root.tag}</span>
          <span className="mt-1.5 text-[11px] leading-snug text-text">{root.summary}</span>
        </a>
      </div>

      {/* Everything below feeds up into it. The rail only spans column centres,
          which are 10% and 90% of a five-column grid — so it is drawn only at
          the width where that grid exists. */}
      <div className="relative h-7" aria-hidden>
        <span className="absolute left-1/2 top-0 h-3.5 w-px -translate-x-1/2 bg-border" />
        <span className="absolute left-[10%] right-[10%] top-3.5 hidden h-px bg-border md:block" />
        <span className="absolute left-1/2 top-3.5 h-px w-px -translate-x-1/2 bg-border md:hidden" />
      </div>

      <div className="grid grid-cols-2 items-start gap-2 sm:grid-cols-3 md:grid-cols-5 md:gap-3">
        {feeders.map(b => (
          <div key={b.id} className="flex flex-col items-stretch">
            <span aria-hidden className="mx-auto h-3.5 w-px bg-border" />
            <Column b={b} anchorBase={anchorBase} canHover={canHover} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function PlatformStats() {
  return (
    <div className="grid grid-cols-4 md:grid-cols-8 gap-y-4 text-center">
      {STATS.map(([n, label]) => (
        <div key={label} className="px-1">
          <div className="text-xl md:text-2xl text-blue font-bold">{n}</div>
          <div className="text-[10px] md:text-[11px] text-dim leading-tight mt-1">{label}</div>
        </div>
      ))}
    </div>
  );
}
